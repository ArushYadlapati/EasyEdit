import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { driveConnection, spaceStorage, user } from "@/db/schema";
import type { AccessSource } from "@/lib/drive/token";
import { slugFor } from "@/lib/spaces/paths";
import type { MySpace, Space } from "@/lib/spaces/types";
import { storageBlock } from "./availability";
import { type StorageConfig, storageConfig } from "./config";
import { connectionAccess, listConnections } from "./connections";
import type { DriveUsage, StorageBlock } from "./messages";
import { holdsUploads } from "./setup";
import { driveUsage } from "./usage";

// What the storage settings page shows: where the space keeps its media, the person's own Google connections to
// choose from, and what (if anything) stops a new connection on this server. Only what the page needs; nothing
// secret, so it can go to the browser.
export type StorageSettingsView = {
  space: Space; // its slug as addresses use it ("personal" for a personal space)
  storage:
    | { kind: "none" }
    | { kind: "shared_folder" }
    | {
        kind: "google_account";
        email: string; // the Google account's
        folderName: string | null;
        broken: boolean;
        hasUploads: boolean;
        usage: DriveUsage | null;
        ownedByViewer: boolean; // only the person who connected it can reconnect it
        ownerEmail: string | null; // that person's EasyEdit address
      };
  connections: { id: string; email: string; broken: boolean }[]; // the viewer's
  blocked: StorageBlock;
};

export type SettingsViewDeps = {
  config?: () => StorageConfig | null;
  mainSa?: () => AccessSource | null;
  fetch?: typeof fetch;
  usageTimeoutMs?: number; // the page never waits longer than this on Google for the usage line
};

const USAGE_TIMEOUT_MS = 2500;

// The usage of the Drive behind a working connection, or null: when this server has no settings, the call fails, or
// Google takes longer than the page waits. Never throws.
async function usageOf(db: DB, cfg: StorageConfig | null, connectionId: string, deps: SettingsViewDeps): Promise<DriveUsage | null> {
  if (!cfg) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deps.usageTimeoutMs ?? USAGE_TIMEOUT_MS);
  });
  const asked = (async () => driveUsage(await connectionAccess(db, cfg, connectionId, deps.fetch), deps.fetch))().catch(() => null);
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}

// Who connected the Google account a space keeps its media in: their user id and EasyEdit address. null for a space
// with none, or in Seattle Solvers' shared drive.
export async function connectionOwner(db: DB, spaceId: string): Promise<{ userId: string; email: string | null } | null> {
  const [row] = await db
    .select({ userId: driveConnection.userId, email: user.email })
    .from(spaceStorage)
    .innerJoin(driveConnection, eq(driveConnection.id, spaceStorage.connectionId))
    .leftJoin(user, eq(user.id, driveConnection.userId))
    .where(eq(spaceStorage.spaceId, spaceId));
  return row ? { userId: row.userId, email: row.email } : null;
}

// The caller has checked that the viewer is the space's admin.
export async function storageSettings(db: DB, space: MySpace, viewerId: string, deps: SettingsViewDeps = {}): Promise<StorageSettingsView> {
  const config = deps.config ?? storageConfig;
  const cfg = config();
  const [row] = await db
    .select({ kind: spaceStorage.kind, connectionId: spaceStorage.connectionId, folderName: spaceStorage.folderName, email: driveConnection.email, brokenAt: driveConnection.brokenAt, ownerId: driveConnection.userId, ownerEmail: user.email })
    .from(spaceStorage)
    .leftJoin(driveConnection, eq(driveConnection.id, spaceStorage.connectionId))
    .leftJoin(user, eq(user.id, driveConnection.userId))
    .where(eq(spaceStorage.spaceId, space.id));

  let storage: StorageSettingsView["storage"] = { kind: "none" };
  if (row?.kind === "shared_folder") storage = { kind: "shared_folder" };
  else if (row?.kind === "google_account" && row.connectionId && row.email !== null) {
    const broken = row.brokenAt !== null;
    const [hasUploads, usage] = await Promise.all([holdsUploads(db, space.id), broken ? null : usageOf(db, cfg, row.connectionId, deps)]);
    storage = { kind: "google_account", email: row.email, folderName: row.folderName, broken, hasUploads, usage, ownedByViewer: row.ownerId === viewerId, ownerEmail: row.ownerEmail };
  }

  const connections = (await listConnections(db, viewerId)).map(({ id, email, broken }) => ({ id, email, broken }));
  return {
    space: { id: space.id, slug: slugFor(space), name: space.name, kind: space.kind },
    storage,
    connections,
    blocked: storageBlock(space.kind, { config: () => cfg, mainSa: deps.mainSa }),
  };
}
