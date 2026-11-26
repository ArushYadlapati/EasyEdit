import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rowsOf, type DB } from "@/db";
import { projectVersions, projects } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { isFolderGone } from "@/lib/projects/service";
import { getUserNames } from "@/lib/projects/user-names";
import { ServiceError } from "@/lib/service-error";
import { assertProject } from "./comments";
import { REVIEW_LIMITS, REVIEW_MESSAGES, openedName, versionName, type VersionView } from "./rules";

// Named versions: a project's timeline kept under a name ("Rough cut", "Sent to the client"), to go back to. A
// version is never put back over the project: it opens as a new project beside it, so nothing made since is lost
// and nobody's open editor has the timeline change under them.

const gone = () => new ServiceError("NOT_FOUND", 404, REVIEW_MESSAGES.versionGone);

export async function listVersions(db: DB, actor: Actor, projectId: string): Promise<VersionView[]> {
  requireRole(actor, "viewer");
  await assertProject(db, actor, projectId);
  const rows = await db
    .select({ id: projectVersions.id, name: projectVersions.name, version: projectVersions.version, createdBy: projectVersions.createdBy, createdAt: projectVersions.createdAt, movedAt: projects.movedAtVersion })
    .from(projectVersions)
    .innerJoin(projects, eq(projects.id, projectVersions.projectId))
    .where(eq(projectVersions.projectId, projectId))
    .orderBy(desc(projectVersions.createdAt), desc(projectVersions.id));
  const names = await getUserNames(db, rows.map((row) => row.createdBy));
  return rows.map((row) => ({ id: row.id, name: row.name, version: row.version, by: names.get(row.createdBy) ?? "Someone", createdAt: row.createdAt.toISOString(), stale: row.version < (row.movedAt ?? 0) }));
}

// Keeps the project's timeline as it is now under a name. The timeline is copied inside the insert itself, so the
// version is exactly one saved state of the project, and the limit is checked in the same statement.
export async function saveVersion(db: DB, actor: Actor, projectId: string, rawName: unknown): Promise<{ id: string }> {
  requireRole(actor, "editor");
  const name = versionName(rawName);
  if (name === null) throw new ServiceError("INVALID", 400, REVIEW_MESSAGES.nameEmpty);
  await assertProject(db, actor, projectId);
  const id = nanoid(12);
  const result = await db.execute(sql`
    insert into project_versions (id, project_id, name, doc, version, created_by)
    select ${id}::text, id, ${name}::text, doc, version, ${actor.userId}::text
    from projects
    where id = ${projectId}::text and space_id = ${actor.spaceId}::text and deleted_at is null
      and (select count(*) from project_versions where project_id = ${projectId}::text) < ${REVIEW_LIMITS.versionsPerProject}
    returning id
  `);
  if (rowsOf(result).length === 0) throw new ServiceError("CONFLICT", 409, REVIEW_MESSAGES.versionsFull);
  return { id };
}

export async function renameVersion(db: DB, actor: Actor, projectId: string, versionId: string, rawName: unknown): Promise<void> {
  requireRole(actor, "editor");
  const name = versionName(rawName);
  if (name === null) throw new ServiceError("INVALID", 400, REVIEW_MESSAGES.nameEmpty);
  await assertProject(db, actor, projectId);
  const updated = await db.update(projectVersions).set({ name }).where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId))).returning({ id: projectVersions.id });
  if (!updated[0]) throw gone();
}

export async function deleteVersion(db: DB, actor: Actor, projectId: string, versionId: string): Promise<void> {
  requireRole(actor, "editor");
  await assertProject(db, actor, projectId);
  const deleted = await db.delete(projectVersions).where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId))).returning({ id: projectVersions.id });
  if (!deleted[0]) throw gone();
}

// Opens a version as a new project beside the one it was saved from: "Project (version)", in the same folder. A
// version saved before the project moved to this space is refused: its media stayed in the other space.
export async function openVersion(db: DB, actor: Actor, projectId: string, versionId: string): Promise<{ id: string }> {
  requireRole(actor, "editor");
  await assertProject(db, actor, projectId);
  const [found] = await db
    .select({ name: projectVersions.name, version: projectVersions.version, project: projects.name, movedAt: projects.movedAtVersion })
    .from(projectVersions)
    .innerJoin(projects, eq(projects.id, projectVersions.projectId))
    .where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId)));
  if (!found) throw gone();
  if (found.version < (found.movedAt ?? 0)) throw new ServiceError("CONFLICT", 409, REVIEW_MESSAGES.versionStale);
  const copyId = nanoid(12);
  const name = openedName(found.project, found.name, LIMITS.projectNameChars);
  const copy = (folderId: SQL) =>
    db.execute(sql`
      insert into projects (id, space_id, name, format, doc, version, created_by, updated_by, folder_id, width, height)
      select ${copyId}::text, p.space_id, ${name}::text, coalesce(v.doc->>'format', p.format), v.doc, 0, ${actor.userId}::text, ${actor.userId}::text,
             ${folderId}, (v.doc->>'width')::integer, (v.doc->>'height')::integer
      from project_versions v
      join projects p on p.id = v.project_id
      where v.id = ${versionId}::text and p.id = ${projectId}::text and p.space_id = ${actor.spaceId}::text and p.deleted_at is null
      returning id
    `);
  let result: Awaited<ReturnType<typeof copy>>;
  try {
    result = await copy(sql`p.folder_id`);
  } catch (error) {
    // The folder was deleted while the copy was written: the copy goes in no folder.
    if (!isFolderGone(error)) throw error;
    result = await copy(sql`null`);
  }
  if (rowsOf(result).length === 0) throw gone();
  return { id: copyId };
}
