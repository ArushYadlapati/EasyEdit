import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { driveConnection, spaceStorage } from "@/db/schema";
import { getDrive } from "@/lib/drive";
import { createDriveClient, type DriveClient } from "@/lib/drive/client";
import type { AccessSource } from "@/lib/drive/token";
import { type StorageConfig, storageConfig } from "@/lib/storage/config";
import { brokenReason, connectionAccess, healKeyBroken } from "@/lib/storage/connections";
import { ConnectionBrokenError } from "@/lib/storage/google-oauth";

// Where a space keeps its media comes from its space_storage row: Seattle Solvers' shared folder (the main service
// account's), or a folder in the Drive of a person who connected their Google account. A space in someone's Drive,
// personal or team, reads and writes with that connection; one Google account backs only one space (setup.ts), so
// its token reaches no other space's files, and every member of a team may edit.

export type StorageState = { ready: true } | { ready: false; reason: "none" | "broken" | "not_configured" };

// What the server reads its settings with; tests point them at a pretend Google.
export type StorageDeps = {
  config?: () => StorageConfig | null; // the OAuth client and token key, for a person's connection
  sharedFolder?: () => DriveClient | null; // Seattle Solvers' shared folder
  fetch?: typeof fetch;
};

type Unready = Extract<StorageState, { ready: false }>["reason"];
type Found =
  | { kind: "unready"; reason: Unready }
  | { kind: "broken"; reason: ConnectionBrokenError["reason"] }
  | { kind: "shared_folder"; shared: DriveClient }
  | { kind: "connected"; cfg: StorageConfig; connectionId: string; rootFolderId: string };

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
      brokenAt: driveConnection.brokenAt,
      brokenReason: driveConnection.brokenReason,
      refreshTokenEnc: driveConnection.refreshTokenEnc,
    })
    .from(spaceStorage)
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
  if (brokenAt !== null) return { kind: "broken", reason: brokenReason(row.brokenReason) };
  return { kind: "connected", cfg, connectionId, rootFolderId };
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

// The Drive client for a space's media, or null when its storage isn't ready; throws ConnectionBrokenError for a
// connection marked broken. A person's Drive is written and read with their connection.
export async function storageFor(db: DB, spaceId: string, deps: StorageDeps = {}): Promise<DriveClient | null> {
  const found = usable(await find(db, spaceId, deps));
  if (!found) return null;
  if (found.kind === "shared_folder") return found.shared;
  const access = await connectionAccess(db, found.cfg, found.connectionId, deps.fetch);
  return createDriveClient({ rootFolderId: found.rootFolderId, write: access, read: access, fetch: deps.fetch });
}

// What /api/drive/read-token hands out for this space, or null when its storage isn't ready: Seattle Solvers' main
// service account's read-only token, or the space's own connection (personal or team). A broken connection throws
// ConnectionBrokenError, as storageFor does, so members are asked to reconnect.
export async function readerFor(db: DB, spaceId: string, deps: StorageDeps = {}): Promise<AccessSource | null> {
  const found = usable(await find(db, spaceId, deps));
  if (!found) return null;
  if (found.kind === "shared_folder") {
    const { shared } = found;
    return { token: (minSecondsLeft) => shared.readToken(minSecondsLeft) };
  }
  return connectionAccess(db, found.cfg, found.connectionId, deps.fetch);
}
