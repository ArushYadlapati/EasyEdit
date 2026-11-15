import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "@/db";
import { driveConnection } from "@/db/schema";
import { type AccessSource, connectionSource } from "@/lib/drive/token";
import type { StorageConfig } from "./config";
import { ConnectionBrokenError, refreshAccess } from "./google-oauth";
import { open, seal } from "./secret-box";

// A person's Google account, connected for storage. The refresh token never leaves this file unsealed.
export type Connection = { id: string; userId: string; email: string; googleSub: string; broken: boolean };

type Row = typeof driveConnection.$inferSelect;

const toConnection = (row: Row): Connection => ({ id: row.id, userId: row.userId, email: row.email, googleSub: row.googleSub, broken: row.brokenAt !== null });

const BROKEN_REASONS = ["revoked", "expired", "unknown"] as const;
const brokenReason = (reason: string | null): ConnectionBrokenError["reason"] =>
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

// Access tokens for the connection, refreshed from its sealed refresh token. When Google says the connection is gone
// (invalid_grant), the row is marked broken and the ConnectionBrokenError comes out. A connection already marked broken
// is not tried again: its source refuses without asking Google, until the person reconnects.
export async function connectionAccess(db: DB, cfg: StorageConfig, connectionId: string, fetchFn: typeof fetch = fetch): Promise<AccessSource> {
  const [row] = await db.select().from(driveConnection).where(eq(driveConnection.id, connectionId));
  if (!row) throw new Error(`No Drive connection ${connectionId}`);
  const sealed = row.refreshTokenEnc;
  const markedBroken = row.brokenAt === null ? null : brokenReason(row.brokenReason);
  return connectionSource({
    refresh: async () => {
      if (markedBroken) throw new ConnectionBrokenError(markedBroken);
      try {
        return await refreshAccess(cfg, open(sealed, cfg.tokenKey), fetchFn);
      } catch (error) {
        if (error instanceof ConnectionBrokenError) {
          await db.update(driveConnection).set({ brokenAt: sql`now()`, brokenReason: error.reason }).where(eq(driveConnection.id, connectionId));
        }
        throw error;
      }
    },
  });
}
