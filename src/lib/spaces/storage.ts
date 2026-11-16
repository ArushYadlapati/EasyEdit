import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { driveConnection, organization, spaceStorage } from "@/db/schema";
import { getDrive, mainServiceAccount } from "@/lib/drive";
import { createDriveClient, type DriveClient } from "@/lib/drive/client";
import { readerSource } from "@/lib/drive/reader";
import type { AccessSource } from "@/lib/drive/token";
import { type StorageConfig, storageConfig } from "@/lib/storage/config";
import { brokenReason, connectionAccess, healKeyBroken } from "@/lib/storage/connections";
import { ConnectionBrokenError } from "@/lib/storage/google-oauth";
import { keptSource } from "@/lib/storage/token-cache";

// Where a space keeps its media comes from its space_storage row: Seattle Solvers' shared folder (the main service
// account's), or a folder in the Drive of a person who connected their Google account. A team's members are handed
// the team reader's read-only token; a personal space's owner, their own connection's.

export type StorageState = { ready: true } | { ready: false; reason: "none" | "broken" | "not_configured" };

// What the server reads its settings with; tests point them at a pretend Google.
export type StorageDeps = {
  config?: () => StorageConfig | null; // the OAuth client and token key, for a person's connection
  mainSa?: () => AccessSource | null; // the app's service account for the Cloud scope, which speaks for team readers
  sharedFolder?: () => DriveClient | null; // Seattle Solvers' shared folder
  fetch?: typeof fetch;
};

type Unready = Extract<StorageState, { ready: false }>["reason"];
type Found =
  | { kind: "unready"; reason: Unready }
  // A team's reader still reads what is in its folder when the connection that writes it is broken (reader).
  | { kind: "broken"; reason: ConnectionBrokenError["reason"]; reader?: { caller: AccessSource; readerEmail: string } }
  | { kind: "shared_folder"; shared: DriveClient }
  | { kind: "personal"; cfg: StorageConfig; connectionId: string; rootFolderId: string }
  | { kind: "team"; cfg: StorageConfig; connectionId: string; rootFolderId: string; caller: AccessSource; readerEmail: string };

const unready = (reason: Unready): Found => ({ kind: "unready", reason });

// A setting that can't be read (a key that isn't base64) counts as not set up, with one line saying only that;
// nothing of the key is logged.
function readSetting<T>(read: () => T | null): T | null {
  try {
    return read();
  } catch {
    console.error("Drive settings could not be read");
    return null;
  }
}

// The space's storage as its rows and the server's settings tell it. No call to Google.
async function find(db: DB, spaceId: string, deps: StorageDeps): Promise<Found> {
  const [row] = await db
    .select({
      kind: spaceStorage.kind,
      connectionId: spaceStorage.connectionId,
      rootFolderId: spaceStorage.rootFolderId,
      readerEmail: spaceStorage.readerEmail,
      spaceKind: organization.kind,
      brokenAt: driveConnection.brokenAt,
      brokenReason: driveConnection.brokenReason,
      refreshTokenEnc: driveConnection.refreshTokenEnc,
    })
    .from(spaceStorage)
    .innerJoin(organization, eq(organization.id, spaceStorage.spaceId))
    .leftJoin(driveConnection, eq(driveConnection.id, spaceStorage.connectionId))
    .where(eq(spaceStorage.spaceId, spaceId));
  if (!row) return unready("none");

  if (row.kind === "shared_folder") {
    // The folder is the one in the settings (the row's own folder id is not used).
    const shared = readSetting(deps.sharedFolder ?? getDrive);
    return shared ? { kind: "shared_folder", shared } : unready("not_configured");
  }

  const { connectionId, rootFolderId } = row;
  if (!connectionId || !rootFolderId) return unready("not_configured"); // the table's check rules this out
  const cfg = (deps.config ?? storageConfig)();
  if (!cfg) return unready("not_configured"); // without the OAuth client a connection's token can't be had, whatever its state
  // A connection broken by a wrong key mends itself once the right key is back.
  const brokenAt = connectionId && row.refreshTokenEnc !== null && (await healKeyBroken(db, cfg, { id: connectionId, refreshTokenEnc: row.refreshTokenEnc, brokenAt: row.brokenAt, brokenReason: row.brokenReason })) ? null : row.brokenAt;
  if (row.spaceKind === "personal") {
    if (brokenAt !== null) return { kind: "broken", reason: brokenReason(row.brokenReason) };
    return { kind: "personal", cfg, connectionId, rootFolderId };
  }

  const caller = readSetting(deps.mainSa ?? mainServiceAccount);
  if (brokenAt !== null) {
    const reader = caller && row.readerEmail ? { caller, readerEmail: row.readerEmail } : undefined;
    return { kind: "broken", reason: brokenReason(row.brokenReason), reader };
  }
  if (!caller || !row.readerEmail) return unready("not_configured");
  return { kind: "team", cfg, connectionId, rootFolderId, caller, readerEmail: row.readerEmail };
}

// Whether the space has storage to upload to, and if not, why. No call to Google.
export async function storageState(db: DB, spaceId: string, deps: StorageDeps = {}): Promise<StorageState> {
  const found = await find(db, spaceId, deps);
  if (found.kind === "unready") return { ready: false, reason: found.reason };
  return found.kind === "broken" ? { ready: false, reason: "broken" } : { ready: true };
}

// Storage that can be used, or null when there is none ready; a connection marked broken throws its
// ConnectionBrokenError, so the routes can tell the person it needs reconnecting. No call to Google.
function usable(found: Found): Exclude<Found, { kind: "unready" | "broken" }> | null {
  if (found.kind === "unready") return null;
  if (found.kind === "broken") throw new ConnectionBrokenError(found.reason);
  return found;
}

// A team reader's tokens, kept between requests by the reader's address (token-cache.ts).
const teamReader = (caller: AccessSource, email: string, fetchFn: typeof fetch | undefined) =>
  keptSource(`reader:${email}`, [caller, fetchFn], () => readerSource({ caller, email, fetch: fetchFn }));

// The Drive client for a space's media, or null when its storage isn't ready; throws ConnectionBrokenError for a
// connection marked broken. A person's Drive is written with their connection; what it hands to browsers is the
// space's reader (readerFor).
export async function storageFor(db: DB, spaceId: string, deps: StorageDeps = {}): Promise<DriveClient | null> {
  const found = usable(await find(db, spaceId, deps));
  if (!found) return null;
  if (found.kind === "shared_folder") return found.shared;
  const write = await connectionAccess(db, found.cfg, found.connectionId, deps.fetch);
  const read = found.kind === "personal" ? write : teamReader(found.caller, found.readerEmail, deps.fetch);
  return createDriveClient({ rootFolderId: found.rootFolderId, write, read, fetch: deps.fetch });
}

// What /api/drive/read-token hands out for this space, or null when its storage isn't ready: Seattle Solvers' main
// service account's read-only token, a personal space's own connection, a team's reader (read-only Drive only).
// A team's reader keeps reading when the team's connection is broken (uploads stop, playback goes on); a personal
// space has only its connection, so there a broken one throws ConnectionBrokenError, as storageFor does.
export async function readerFor(db: DB, spaceId: string, deps: StorageDeps = {}): Promise<AccessSource | null> {
  const all = await find(db, spaceId, deps);
  if (all.kind === "broken" && all.reader) return teamReader(all.reader.caller, all.reader.readerEmail, deps.fetch);
  const found = usable(all);
  if (!found) return null;
  if (found.kind === "shared_folder") {
    const { shared } = found;
    return { token: (minSecondsLeft) => shared.readToken(minSecondsLeft) };
  }
  if (found.kind === "personal") return connectionAccess(db, found.cfg, found.connectionId, deps.fetch);
  return teamReader(found.caller, found.readerEmail, deps.fetch);
}
