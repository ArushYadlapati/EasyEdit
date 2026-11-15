import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "@/db";
import { folders, projects } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { folderName } from "@/lib/projects/schemas";
import { failedOn, isFolderGone } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { SEED_TEAM_ID } from "@/lib/spaces/types";

export type FolderSummary = { id: string; name: string; projectCount: number };

export const FOLDER_NAME_MESSAGE = `Enter a folder name up to ${LIMITS.folderNameChars} characters.`;
export const FOLDER_NAME_TAKEN = "There's already a folder with that name.";
export const FOLDER_GONE = "That folder no longer exists.";

const NAME_INDEX = "folders_space_name_lower_unique";

const folderGone = () => new ServiceError("NOT_FOUND", 404, FOLDER_GONE);

function parseName(name: string): string {
  const parsed = folderName.safeParse(name);
  if (!parsed.success) throw new ServiceError("INVALID", 400, FOLDER_NAME_MESSAGE);
  return parsed.data;
}

// True when a write failed because another folder already has this name in some case.
const isNameTaken = (error: unknown) => failedOn(error, "23505", NAME_INDEX);

async function savingName<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (isNameTaken(error)) throw new ServiceError("CONFLICT", 409, FOLDER_NAME_TAKEN);
    throw error;
  }
}

// Each folder with the number of live projects in it, by name regardless of case.
export async function listFolders(db: DB, actor: Actor): Promise<FolderSummary[]> {
  requireRole(actor, "viewer");
  return db
    .select({ id: folders.id, name: folders.name, projectCount: count(projects.id) })
    .from(folders)
    .leftJoin(projects, and(eq(projects.folderId, folders.id), isNull(projects.deletedAt)))
    .groupBy(folders.id)
    .orderBy(sql`lower(${folders.name})`, asc(folders.id));
}

export async function createFolder(db: DB, actor: Actor, name: string): Promise<{ id: string; name: string }> {
  requireRole(actor, "editor");
  const folder = { id: nanoid(12), name: parseName(name) };
  await savingName(db.insert(folders).values({ ...folder, spaceId: SEED_TEAM_ID, createdBy: actor.userId }));
  return folder;
}

export async function renameFolder(db: DB, actor: Actor, id: string, name: string): Promise<{ id: string; name: string }> {
  requireRole(actor, "editor");
  const parsed = parseName(name);
  const rows = await savingName(
    db
      .update(folders)
      .set({ name: parsed, updatedAt: sql`now()` })
      .where(eq(folders.id, id))
      .returning({ name: folders.name }),
  );
  if (!rows[0]) throw folderGone();
  return { id, name: rows[0].name };
}

// The foreign key's on delete set null takes the folder's projects out of it; no project is deleted.
export async function deleteFolder(db: DB, actor: Actor, id: string): Promise<void> {
  requireRole(actor, "editor");
  const rows = await db.delete(folders).where(eq(folders.id, id)).returning({ id: folders.id });
  if (!rows[0]) throw folderGone();
}

// Puts a project in a folder, or in none with null. A move is not a change to the project, so its version and
// last change stay as they were.
export async function moveProject(db: DB, actor: Actor, projectId: string, folderId: string | null): Promise<void> {
  requireRole(actor, "editor");
  const live = and(eq(projects.id, projectId), isNull(projects.deletedAt));
  let rows: { id: string }[];
  try {
    rows = await db
      .update(projects)
      .set({ folderId })
      .where(and(live, folderId === null ? undefined : sql`exists (select 1 from folders where id = ${folderId})`))
      .returning({ id: projects.id });
  } catch (error) {
    // The folder was deleted after the update checked it.
    if (isFolderGone(error)) throw folderGone();
    throw error;
  }
  if (rows[0]) return;
  const project = await db.select({ id: projects.id }).from(projects).where(live);
  if (!project[0]) throw new ServiceError("NOT_FOUND", 404, `Project "${projectId}" not found`);
  throw folderGone();
}
