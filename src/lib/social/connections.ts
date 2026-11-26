import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rowsOf, type DB } from "@/db";
import { socialConnection, socialPost } from "@/db/schema";
import { ServiceError } from "@/lib/service-error";
import { roleIn } from "@/lib/spaces/service";
import { ConnectionBrokenError, refreshAccess, revokeGrant } from "@/lib/storage/google-oauth";
import { open, SecretBoxError, seal } from "@/lib/storage/secret-box";
import { dropChannelReferences } from "@/lib/style/channel-references";
import type { SocialConfig } from "./config";
import { cancelUpload, type Channel } from "./youtube-api";

// A space's YouTube channel. The refresh token never leaves this file unsealed.
export type SocialConnection = {
  id: string;
  spaceId: string;
  connectedBy: string; // a user id
  email: string; // the Google account's
  channelId: string | null;
  channelTitle: string | null;
  broken: boolean;
};

type Row = typeof socialConnection.$inferSelect;

// Why a row is broken when its sealed token won't open with the server's key. It mends itself once the key is back.
const KEY_REASON = "key";

const toConnection = (row: Row, broken = row.brokenAt !== null): SocialConnection => ({
  id: row.id,
  spaceId: row.spaceId,
  connectedBy: row.connectedBy,
  email: row.email,
  channelId: row.channelId,
  channelTitle: row.channelTitle,
  broken,
});

// Whether any other connection of this app still uses the Google account: another space's channel, or a Drive. A
// revoke at Google ends the account's grant, so it is only sent when nothing else depends on it. A Drive counts even
// when YouTube has a sign-in client of its own: Google may treat two clients of one project as one app, and a revoke
// that takes a space's storage down costs far more than a grant left unused (the token is deleted here either way,
// and the person can remove EasyEdit in their Google account).
async function accountUsedElsewhere(db: DB, googleSub: string, exceptId: string): Promise<boolean> {
  const [row] = rowsOf<{ used: boolean }>(
    await db.execute(sql`
      select (
        exists (select 1 from social_connection where google_sub = ${googleSub} and id <> ${exceptId})
        or exists (select 1 from drive_connection where google_sub = ${googleSub})
      ) as used
    `),
  );
  return row?.used === true;
}

// Best effort: a token the key can't open, or Google refusing, changes nothing here. The person can still remove
// EasyEdit in their Google account.
async function revokeQuietly(cfg: SocialConfig, sealed: string, revoke: (refreshToken: string) => Promise<void>): Promise<void> {
  try {
    await revoke(open(sealed, cfg.tokenKey));
  } catch (error) {
    console.error("Revoking a disconnected YouTube channel failed:", error instanceof Error ? error.name : "unknown");
  }
}

export type ConnectionDeps = { revoke?: (refreshToken: string) => Promise<void>; fetch?: typeof fetch };

// Whether a new connection may be another channel than the one it replaces. Only the same channel id, read both times,
// counts as the same: a reconnect whose channel couldn't be read, or that left out the permission to see it, may be
// any channel (and EasyEdit may no longer see the old one's videos at all).
function isAnotherChannel(before: Row, channel: Channel | null): boolean {
  return before.channelId === null || channel === null || before.channelId !== channel.id;
}

// One channel per space: connecting again replaces the one it had (and mends a broken one). The account it replaces
// is revoked at Google when it is a different one that nothing else uses. Unless it is surely the same channel, what
// the space's style kept from the old one goes.
export async function saveYoutubeConnection(
  db: DB,
  cfg: SocialConfig,
  input: { spaceId: string; connectedBy: string; googleSub: string; email: string; channel: Channel | null; refreshToken: string; scopes: string[] },
  deps: ConnectionDeps = {},
): Promise<SocialConnection> {
  const before = await findConnectionRow(db, input.spaceId);
  const values = {
    connectedBy: input.connectedBy,
    googleSub: input.googleSub,
    email: input.email,
    channelId: input.channel?.id ?? null,
    channelTitle: input.channel?.title ?? null,
    refreshTokenEnc: seal(input.refreshToken, cfg.tokenKey),
    scopes: input.scopes.join(" "),
  };
  const [row] = await db
    .insert(socialConnection)
    .values({ id: `sc_${nanoid(16)}`, spaceId: input.spaceId, platform: "youtube", ...values })
    .onConflictDoUpdate({
      target: [socialConnection.spaceId, socialConnection.platform],
      set: { ...values, brokenAt: null, brokenReason: null, updatedAt: sql`now()` },
    })
    .returning();
  if (before && isAnotherChannel(before, input.channel)) await dropChannelReferences(db, input.spaceId);
  if (before && before.googleSub !== input.googleSub && !(await accountUsedElsewhere(db, before.googleSub, row.id))) {
    await revokeQuietly(cfg, before.refreshTokenEnc, deps.revoke ?? ((token) => revokeGrant(token)));
  }
  return toConnection(row);
}

async function findConnectionRow(db: DB, spaceId: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(socialConnection)
    .where(and(eq(socialConnection.spaceId, spaceId), eq(socialConnection.platform, "youtube")));
  return row ?? null;
}

// A connection broken only because its token wouldn't open (the key was wrong for a while) is whole again once the
// right key is back. True when the row is mended now.
async function healKeyBroken(db: DB, cfg: SocialConfig | null, row: Row): Promise<boolean> {
  if (!cfg || row.brokenAt === null || row.brokenReason !== KEY_REASON) return false;
  try {
    open(row.refreshTokenEnc, cfg.tokenKey);
  } catch {
    return false;
  }
  await db
    .update(socialConnection)
    .set({ brokenAt: null, brokenReason: null })
    .where(and(eq(socialConnection.id, row.id), eq(socialConnection.refreshTokenEnc, row.refreshTokenEnc), eq(socialConnection.brokenReason, KEY_REASON)));
  return true;
}

// The space's channel, or null. cfg: the server's settings, so a connection broken by a wrong key reads as whole
// once the key is right again.
export async function findConnection(db: DB, cfg: SocialConfig | null, spaceId: string): Promise<SocialConnection | null> {
  const row = await findConnectionRow(db, spaceId);
  if (!row) return null;
  return toConnection(row, (await healKeyBroken(db, cfg, row)) ? false : row.brokenAt !== null);
}

const BROKEN_REASONS = ["revoked", "expired", "unknown"] as const;
const brokenReason = (reason: string | null): ConnectionBrokenError["reason"] => BROKEN_REASONS.find((known) => known === reason) ?? "unknown";

// An access token for the space's channel, from its sealed refresh token. Throws a ConnectionBrokenError when the
// connection is gone (Google says so, or the key can't open the token), marking the row broken; a connection already
// marked broken is not tried again. NOT_CONNECTED when the space has no channel.
export async function channelAccess(db: DB, cfg: SocialConfig, spaceId: string, fetchFn: typeof fetch = fetch): Promise<{ accessToken: string; connection: SocialConnection }> {
  const row = await findConnectionRow(db, spaceId);
  if (!row) throw new ServiceError("NOT_CONNECTED", 409, "This space has no YouTube channel connected.");
  if (row.brokenAt !== null && !(await healKeyBroken(db, cfg, row))) throw new ConnectionBrokenError(brokenReason(row.brokenReason));
  // Only while the row still holds the token that failed: a reconnect that saved a new one must not be marked broken.
  const markBroken = (reason: string) =>
    db
      .update(socialConnection)
      .set({ brokenAt: sql`now()`, brokenReason: reason })
      .where(and(eq(socialConnection.id, row.id), eq(socialConnection.refreshTokenEnc, row.refreshTokenEnc)));
  let refresh: string;
  try {
    refresh = open(row.refreshTokenEnc, cfg.tokenKey);
  } catch (cause) {
    if (!(cause instanceof SecretBoxError)) throw cause;
    await markBroken(KEY_REASON);
    throw new ConnectionBrokenError("unknown");
  }
  try {
    const { accessToken } = await refreshAccess(cfg, refresh, fetchFn);
    return { accessToken, connection: toConnection(row, false) };
  } catch (error) {
    if (error instanceof ConnectionBrokenError) await markBroken(error.reason);
    throw error;
  }
}

// The space's channel goes: its uploads still open are ended, the row is deleted, what the space's style kept from the
// channel is deleted, and EasyEdit's access to the Google account is revoked unless something else of this app still
// uses that account. `onlyConnectedBy`: only when that person connected it. Returns whether a channel was removed.
// Videos already posted stay on YouTube.
export async function dropChannel(db: DB, cfg: SocialConfig | null, input: { spaceId: string; onlyConnectedBy?: string }, deps: ConnectionDeps = {}): Promise<boolean> {
  const fetchFn = deps.fetch ?? fetch;
  const [gone] = await db
    .delete(socialConnection)
    .where(
      and(
        eq(socialConnection.spaceId, input.spaceId),
        eq(socialConnection.platform, "youtube"),
        ...(input.onlyConnectedBy ? [eq(socialConnection.connectedBy, input.onlyConnectedBy)] : []),
      ),
    )
    .returning();
  if (!gone) return false;
  await dropChannelReferences(db, input.spaceId);
  // Uploads still open are ended: the posts recorded as stopped, and their sessions closed at YouTube (best effort),
  // so nothing started before the channel went lands on it afterwards.
  const stopped = await db
    .update(socialPost)
    .set({ status: "canceled", finishedAt: sql`now()` })
    .where(and(eq(socialPost.spaceId, input.spaceId), eq(socialPost.status, "uploading")))
    .returning({ id: socialPost.id, uploadUrlEnc: socialPost.uploadUrlEnc });
  if (stopped.length > 0) await db.update(socialPost).set({ uploadUrlEnc: null }).where(and(eq(socialPost.spaceId, input.spaceId), eq(socialPost.status, "canceled")));
  if (!cfg) return true;
  for (const post of stopped) {
    if (post.uploadUrlEnc === null) continue;
    try {
      await cancelUpload(open(post.uploadUrlEnc, cfg.tokenKey), fetchFn);
    } catch (error) {
      console.error("Ending a YouTube upload failed:", error instanceof Error ? error.name : "unknown");
    }
  }
  if (!(await accountUsedElsewhere(db, gone.googleSub, gone.id))) {
    await revokeQuietly(cfg, gone.refreshTokenEnc, deps.revoke ?? ((token) => revokeGrant(token)));
  }
  return true;
}

// Disconnect on the Socials settings page. Only an admin of the space.
export async function disconnectYoutube(db: DB, cfg: SocialConfig | null, input: { spaceId: string; byUserId: string }, deps: ConnectionDeps = {}): Promise<void> {
  if ((await roleIn(db, input.byUserId, input.spaceId)) !== "admin") throw new ServiceError("NOT_FOUND", 404, "Space not found");
  if (!(await dropChannel(db, cfg, { spaceId: input.spaceId }, deps))) throw new ServiceError("NOT_CONNECTED", 409, "This space has no YouTube channel connected.");
}

// Whether a channel of this app uses the Google account: asked before a Drive disconnect revokes the account's grant.
export async function channelUsesAccount(db: DB, googleSub: string): Promise<boolean> {
  const [row] = await db.select({ id: socialConnection.id }).from(socialConnection).where(eq(socialConnection.googleSub, googleSub)).limit(1);
  return row !== undefined;
}
