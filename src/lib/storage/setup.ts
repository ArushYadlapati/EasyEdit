import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { rowsOf, type DB } from "@/db";
import { assets, driveConnection, organization, spaceStorage } from "@/db/schema";
import { createDriveClient, makeTopFolder } from "@/lib/drive/client";
import { failedOn } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { roleIn } from "@/lib/spaces/service";
import { type StorageConfig, storageConfig } from "./config";
import { connectionAccess } from "./connections";
import { STORAGE_MESSAGES } from "./messages";

// Makes a space's storage in the Drive of a connection its admin just made. What it refuses comes out as a
// ServiceError; a Drive call that fails, as a DriveError; a connection Google no longer honours, as a
// ConnectionBrokenError (and the connection is marked broken).
export type SetUpStorage = (db: DB, input: { spaceId: string; connectionId: string; byUserId: string }) => Promise<void>;

export type SetUpDeps = {
  config: StorageConfig;
  fetch?: typeof fetch;
};

// "EasyEdit – <space name>"; a personal space's is "EasyEdit – Personal".
const storageFolderName = (space: { kind: "personal" | "team"; name: string }) => `EasyEdit – ${space.kind === "personal" ? "Personal" : space.name}`;

// A space that is unknown, or not run by this person, and a connection that isn't theirs, all get the same answer.
const notFound = () => new ServiceError("NOT_FOUND", 404, "Space not found");
const inUse = () => new ServiceError("STORAGE_IN_USE", 409, "This space already keeps files in Google Drive, so it can't move to another account yet.");
// One Google account backs one space: members are handed the connection's own token, which reaches every file EasyEdit
// made in that account, so two spaces in one account would see each other's media. Never names the other space.
const accountInUse = () => new ServiceError("ACCOUNT_IN_USE", 409, STORAGE_MESSAGES.accountInUse);

// Runs the statement that saves a space's storage; another space taking the same Google account meanwhile (the
// unique index) comes out as ACCOUNT_IN_USE.
async function claimingAccount<T>(save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (failedOn(error, "23505", "space_storage_google_sub_unique")) throw accountInUse();
    throw error;
  }
}

// Any upload the space holds, finished or not, that hasn't been removed.
const uploadsIn = (spaceId: string) => sql`exists (select 1 from ${assets} where ${assets.spaceId} = ${spaceId} and ${assets.removedAt} is null)`;

// Whether the space holds any upload that hasn't been removed: then its storage can't move to another account yet.
export async function holdsUploads(db: DB, spaceId: string): Promise<boolean> {
  return rowsOf<{ held: boolean }>(await db.execute(sql`select ${uploadsIn(spaceId)} as held`))[0]?.held === true;
}

// Setting up again with the same connection (a reconnect after it broke) keeps the storage as it is. A space whose
// storage holds uploads keeps it: moving media between accounts comes later. A shared folder (Seattle Solvers' shared
// drive) is never replaced, uploads or not. Refusals are made before any call to Google, so a refused
// setup leaves nothing in the person's Drive (apart from a lost race for the same Google account).
export function makeSetUpStorage(deps: SetUpDeps): SetUpStorage {
  return async (db, { spaceId, connectionId, byUserId }) => {
    const [space] = await db.select({ name: organization.name, kind: organization.kind }).from(organization).where(eq(organization.id, spaceId));
    if (!space || (await roleIn(db, byUserId, spaceId)) !== "admin") throw notFound();
    const [connection] = await db.select({ userId: driveConnection.userId, googleSub: driveConnection.googleSub }).from(driveConnection).where(eq(driveConnection.id, connectionId));
    if (!connection || connection.userId !== byUserId) throw notFound();
    const { googleSub } = connection;

    const [current] = await db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, spaceId));
    if (current?.kind === "google_account" && current.connectionId === connectionId) return;
    if (current?.kind === "shared_folder" || (current && (await holdsUploads(db, spaceId)))) throw inUse();
    // Before any call to Google, so a refused account gets no empty folder; the unique index catches a race.
    const [taken] = await db
      .select({ spaceId: spaceStorage.spaceId })
      .from(spaceStorage)
      .where(and(eq(spaceStorage.googleSub, googleSub), ne(spaceStorage.spaceId, spaceId)))
      .limit(1);
    if (taken) throw accountInUse();

    const fetchFn = deps.fetch;
    const write = await connectionAccess(db, deps.config, connectionId, fetchFn);
    const folderName = storageFolderName(space);
    const rootFolderId = await makeTopFolder({ write, name: folderName, fetch: fetchFn });
    const drive = createDriveClient({ rootFolderId, write, read: write, fetch: fetchFn });
    await Promise.all([drive.folderId("Originals"), drive.folderId("Previews")]);

    // One statement re-checks what may have changed during the Google calls: the caller must still be an admin of the
    // space (an admin removed or demoted meanwhile must not become, or replace, its storage owner), an upload that began
    // since the first look keeps the old storage, and so does a shared folder. The caller's member row is locked for
    // share, so a removal or demotion still in progress is waited for and then seen.
    const saved = await claimingAccount(() => db.execute(sql`
      with caller as (
        select 1 from member where organization_id = ${spaceId} and user_id = ${byUserId} and role = 'admin' for share
      )
      insert into space_storage (space_id, kind, connection_id, root_folder_id, folder_name, google_sub, created_by, created_at)
      select ${spaceId}, 'google_account', ${connectionId}, ${rootFolderId}, ${folderName}, ${googleSub}, ${byUserId}, now()
      where exists (select 1 from caller)
      on conflict (space_id) do update set
        kind = excluded.kind, connection_id = excluded.connection_id, root_folder_id = excluded.root_folder_id,
        folder_name = excluded.folder_name, reader_email = null, google_sub = excluded.google_sub, created_by = excluded.created_by,
        created_at = now()
      where space_storage.kind <> 'shared_folder' and not ${uploadsIn(spaceId)} and exists (select 1 from caller)
      returning space_id
    `));
    if (rowsOf(saved).length > 0) return;
    if ((await roleIn(db, byUserId, spaceId)) !== "admin") throw notFound();
    throw inUse();
  };
}

// What the routes use: the server's own settings and main service account, read when a setup runs.
export async function setUpStorage(...[db, input]: Parameters<SetUpStorage>): Promise<void> {
  const config = storageConfig();
  if (!config) throw new ServiceError("CONFLICT", 409, "Connecting Google Drive isn't set up on this server.");
  await makeSetUpStorage({ config })(db, input);
}
