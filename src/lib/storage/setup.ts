import "server-only";
import { eq, sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { assets, driveConnection, organization, spaceStorage } from "@/db/schema";
import { mainServiceAccount } from "@/lib/drive";
import { createDriveClient, makeTopFolder } from "@/lib/drive/client";
import { createReader, shareFolderWith } from "@/lib/drive/reader";
import type { AccessSource } from "@/lib/drive/token";
import { ServiceError } from "@/lib/service-error";
import { roleIn } from "@/lib/spaces/service";
import { type StorageConfig, storageConfig } from "./config";
import { connectionAccess } from "./connections";

// Makes a space's storage in the Drive of a connection its admin just made. What it refuses comes out as a
// ServiceError; a Drive call that fails, as a DriveError; a connection Google no longer honours, as a
// ConnectionBrokenError (and the connection is marked broken).
export type SetUpStorage = (db: DB, input: { spaceId: string; connectionId: string; byUserId: string }) => Promise<void>;

export type SetUpDeps = {
  config: StorageConfig;
  mainSa: () => AccessSource | null; // the app's service account for the Cloud scope; null when its key isn't set (and throws when it can't be read)
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>; // between tries while a new reader isn't known to Drive yet
};

// "EasyEdit – <space name>"; a personal space's is "EasyEdit – Personal".
const storageFolderName = (space: { kind: "personal" | "team"; name: string }) => `EasyEdit – ${space.kind === "personal" ? "Personal" : space.name}`;

// A space that is unknown, or not run by this person, and a connection that isn't theirs, all get the same answer.
const notFound = () => new ServiceError("NOT_FOUND", 404, "Space not found");
const inUse = () => new ServiceError("STORAGE_IN_USE", 409, "This space already keeps files in Google Drive, so it can't move to another account yet.");
const teamNotConfigured = () => new ServiceError("TEAM_STORAGE_NOT_CONFIGURED", 409, "Google Drive storage for teams isn't set up on this server yet.");

// The app's service account, or null when its key isn't set or can't be read (one line saying only that, nothing of
// the key): either way teams can't get storage on this server.
function mainSaOf(deps: SetUpDeps): AccessSource | null {
  try {
    return deps.mainSa();
  } catch {
    console.error("Drive settings could not be read");
    return null;
  }
}

// Any upload the space holds, finished or not, that hasn't been removed.
const uploadsIn = (spaceId: string) => sql`exists (select 1 from ${assets} where ${assets.spaceId} = ${spaceId} and ${assets.removedAt} is null)`;

async function holdsUploads(db: DB, spaceId: string): Promise<boolean> {
  return rowsOf<{ held: boolean }>(await db.execute(sql`select ${uploadsIn(spaceId)} as held`))[0]?.held === true;
}

// Setting up again with the same connection (a reconnect after it broke) keeps the storage as it is. A space whose
// storage holds uploads keeps it: moving media between accounts comes later. Everything that can be refused is
// refused before any call to Google, so a refusal leaves nothing behind.
export function makeSetUpStorage(deps: SetUpDeps): SetUpStorage {
  return async (db, { spaceId, connectionId, byUserId }) => {
    const [space] = await db.select({ name: organization.name, kind: organization.kind }).from(organization).where(eq(organization.id, spaceId));
    if (!space || (await roleIn(db, byUserId, spaceId)) !== "admin") throw notFound();
    const [connection] = await db.select({ userId: driveConnection.userId }).from(driveConnection).where(eq(driveConnection.id, connectionId));
    if (!connection || connection.userId !== byUserId) throw notFound();

    const [current] = await db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, spaceId));
    if (current?.kind === "google_account" && current.connectionId === connectionId) return;
    if (current && (await holdsUploads(db, spaceId))) throw inUse();

    const team = space.kind === "team";
    const caller = team ? mainSaOf(deps) : null;
    const projectId = deps.config.projectId;
    if (team && (!caller || !projectId)) throw teamNotConfigured();

    const fetchFn = deps.fetch;
    const write = await connectionAccess(db, deps.config, connectionId, fetchFn);
    const folderName = storageFolderName(space);
    const rootFolderId = await makeTopFolder({ write, name: folderName, fetch: fetchFn });
    const drive = createDriveClient({ rootFolderId, write, read: write, fetch: fetchFn });
    await Promise.all([drive.folderId("Originals"), drive.folderId("Previews")]);

    let readerEmail: string | null = null;
    if (caller && projectId) {
      ({ email: readerEmail } = await createReader({ caller, projectId, spaceId, fetch: fetchFn }));
      await shareFolderWith({ write, fetch: fetchFn, sleep: deps.sleep }, rootFolderId, readerEmail);
    }

    const values = { kind: "google_account" as const, connectionId, rootFolderId, folderName, readerEmail, createdBy: byUserId };
    // The check for uploads again, in the same statement: one that began since the first look keeps the old storage.
    const saved = await db
      .insert(spaceStorage)
      .values({ spaceId, ...values })
      .onConflictDoUpdate({ target: spaceStorage.spaceId, set: { ...values, createdAt: sql`now()` }, setWhere: sql`not ${uploadsIn(spaceId)}` })
      .returning({ spaceId: spaceStorage.spaceId });
    if (saved.length === 0) throw inUse();
  };
}

// What the routes use: the server's own settings and main service account, read when a setup runs.
export async function setUpStorage(...[db, input]: Parameters<SetUpStorage>): Promise<void> {
  const config = storageConfig();
  if (!config) throw new ServiceError("CONFLICT", 409, "Connecting Google Drive isn't set up on this server.");
  await makeSetUpStorage({ config, mainSa: mainServiceAccount })(db, input);
}
