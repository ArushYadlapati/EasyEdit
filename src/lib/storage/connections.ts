import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "@/db";
import { driveConnection } from "@/db/schema";
import { type AccessSource, connectionSource } from "@/lib/drive/token";
import type { StorageConfig } from "./config";
import { ConnectionBrokenError, refreshAccess } from "./google-oauth";
import { open, SecretBoxError, seal } from "./secret-box";
import { forgetSources, keptSource } from "./token-cache";

// A person's Google account, connected for storage. The refresh token never leaves this file unsealed.
export type Connection = { id: string; userId: string; email: string; googleSub: string; broken: boolean };

type Row = typeof driveConnection.$inferSelect;

const toConnection = (row: Row): Connection => ({ id: row.id, userId: row.userId, email: row.email, googleSub: row.googleSub, broken: row.brokenAt !== null });

const BROKEN_REASONS = ["revoked", "expired", "unknown"] as const;
// Why a row was marked broken, as a ConnectionBrokenError says it.
export const brokenReason = (reason: string | null): ConnectionBrokenError["reason"] =>
  BROKEN_REASONS.find((known) => known === reason) ?? "unknown";

// One row per person and Google account: connecting the same account again replaces its token and mends it.
export async function saveConnection(
  db: DB,
  cfg: StorageConfig,
  input: { userId: string; googleSub: string; email: string; refreshToken: string; scopes: string[] },
): Promise<Connection> {
  const refreshTokenEnc = seal(input.refreshToken, cfg.tokenKey);
  const scopes = input.scopes.join(" ");
  const [row] = await db
    .insert(driveConnection)
    .values({ id: `dc_${nanoid(16)}`, userId: input.userId, googleSub: input.googleSub, email: input.email, refreshTokenEnc, scopes })
    .onConflictDoUpdate({
      target: [driveConnection.userId, driveConnection.googleSub],
      set: { email: input.email, refreshTokenEnc, scopes, brokenAt: null, brokenReason: null, updatedAt: sql`now()` },
    })
    .returning();
  return toConnection(row);
}

export async function listConnections(db: DB, userId: string): Promise<Connection[]> {
  const rows = await db.select().from(driveConnection).where(eq(driveConnection.userId, userId)).orderBy(asc(driveConnection.createdAt), asc(driveConnection.id));
  return rows.map(toConnection);
}

// Why a row is broken when its sealed token won't open with the server's key.
const KEY_REASON = "key";
const opens = (sealed: string, cfg: StorageConfig) => {
  try {
    open(sealed, cfg.tokenKey);
    return true;
  } catch {
    return false;
  }
};

// Access tokens for the connection, refreshed from its sealed refresh token. When Google says the connection is gone
// (invalid_grant), the row is marked broken and the ConnectionBrokenError comes out. A connection already marked broken
// is not tried again: its source refuses without asking Google, until the person reconnects.
// The source is kept for the next request (token-cache.ts), under the connection's id and a hash of its sealed token:
// a reconnect seals a new one, so the old source is not used again. The row is read every time, so a connection
// marked broken is never answered from what was kept, and a source that finds it broken is dropped.
export async function connectionAccess(db: DB, cfg: StorageConfig, connectionId: string, fetchFn: typeof fetch = fetch): Promise<AccessSource> {
  const [row] = await db.select().from(driveConnection).where(eq(driveConnection.id, connectionId));
  if (!row) throw new Error(`No Drive connection ${connectionId}`);
  const prefix = `connection:${connectionId}:`;
  // A row broken because its token wouldn't open ("key") heals when the right key is back: tried again here, with no
  // call to Google. One broken by Google (revoked, expired) is never healed this way.
  let brokenAt = row.brokenAt;
  if (brokenAt !== null && row.brokenReason === KEY_REASON && opens(row.refreshTokenEnc, cfg)) {
    await db
      .update(driveConnection)
      .set({ brokenAt: null, brokenReason: null })
      .where(and(eq(driveConnection.id, connectionId), eq(driveConnection.refreshTokenEnc, row.refreshTokenEnc), eq(driveConnection.brokenReason, KEY_REASON)));
    brokenAt = null;
  }
  if (brokenAt !== null) {
    forgetSources(prefix);
    const reason = brokenReason(row.brokenReason);
    return { token: () => Promise.reject(new ConnectionBrokenError(reason)) };
  }
  const sealed = row.refreshTokenEnc;
  const key = `${prefix}${createHash("sha256").update(sealed).digest("base64url")}`;
  forgetSources(prefix, key); // the sources of a token the connection no longer holds
  return keptSource(key, [fetchFn], () =>
    connectionSource({
      refresh: async () => {
        // Only while the row still holds the token this source was built from: a reconnect that saved a new one
        // in the meantime must not be marked broken by the old token's failure.
        const markBroken = async (reason: string) => {
          forgetSources(prefix);
          await db
            .update(driveConnection)
            .set({ brokenAt: sql`now()`, brokenReason: reason })
            .where(and(eq(driveConnection.id, connectionId), eq(driveConnection.refreshTokenEnc, sealed)));
        };
        let refresh: string;
        try {
          refresh = open(sealed, cfg.tokenKey);
        } catch (cause) {
          // The key can't open the token (it was changed): reads as a connection that needs reconnecting, and Google
          // is not asked. Stored as "key" so the right key coming back heals it; shown as "unknown".
          if (!(cause instanceof SecretBoxError)) throw cause;
          await markBroken(KEY_REASON);
          throw new ConnectionBrokenError("unknown");
        }
        try {
          return await refreshAccess(cfg, refresh, fetchFn);
        } catch (error) {
          if (error instanceof ConnectionBrokenError) await markBroken(error.reason);
          throw error;
        }
      },
    }),
  );
}
