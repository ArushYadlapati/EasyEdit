import { and, asc, desc, eq, gt, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rowsOf, type DB } from "@/db";
import { projectOps, projects } from "@/db/schema";
import { requireRole, type Actor } from "@/lib/actor";
import { LIMITS } from "@/lib/limits";
import { assetIdsToCheck, findMediaProblem, mediaProblemMessage } from "@/lib/media/refs";
import { loadAssetFacts } from "@/lib/media/service";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { dropPinOfDeleted } from "@/lib/projects/pins";
import { copyName, projectFrame, projectName } from "@/lib/projects/schemas";
import { ServiceError } from "@/lib/service-error";
import { getTemplate } from "@/lib/templates/service";
import {
  OpError,
  applyOps,
  createEmptyDoc,
  prepareOps,
  type FormatId,
  type Op,
  type OpInput,
  type TimelineDoc,
} from "@/lib/timeline";

export const MAX_WRITE_ATTEMPTS = 3;

const newId = () => nanoid(12);

export type ProjectRecord = {
  id: string;
  name: string;
  format: FormatId;
  doc: TimelineDoc;
  version: number;
  updatedBy: string;
  updatedAt: Date;
  thumbnailVersion: number | null;
  // The version the last move to another space landed at; edits and undos from before it are refused.
  movedAtVersion: number | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  format: FormatId;
  width: number;
  height: number;
  folderId: string | null;
  version: number;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
  thumbnailVersion: number | null;
};

export type OpLogEntry = {
  version: number;
  ops: Op[];
  inverse: Op[] | null;
  actor: string;
  requestId: string | null;
  createdAt: Date;
};

export type AppliedOps = { version: number; ops: Op[]; inverse: Op[] };

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const REQUEST_ID_INDEX = "project_ops_project_id_request_id_unique";
// The foreign key from projects to folders, as drizzle-kit named it in migration 0007. A rename there must be made
// here too, or a folder deleted mid-write would fail the write instead of leaving the project in no folder.
export const FOLDER_FK = "projects_folder_id_folders_id_fk";

// Deleted projects are hidden from every read and write.
const notDeleted = isNull(projects.deletedAt);
// A project in another space is as good as missing: every read and write names the actor's space.
const inSpace = (actor: Actor) => and(eq(projects.spaceId, actor.spaceId), notDeleted);
const liveProject = (actor: Actor, id: string) => and(eq(projects.id, id), inSpace(actor));

const invalidName = () => new ServiceError("INVALID", 400, `Enter a name up to ${LIMITS.projectNameChars} characters.`);

// The frame size kept in step with the doc. Rows written before the columns existed have them empty, so the doc's
// own size is read instead.
export function storedWidth(): SQL<number> {
  return sql<number>`coalesce(${projects.width}, (${projects.doc}->>'width')::integer)`;
}

export function storedHeight(): SQL<number> {
  return sql<number>`coalesce(${projects.height}, (${projects.doc}->>'height')::integer)`;
}

// True when a write failed with this Postgres error code on this constraint or index. Drivers may wrap the
// database error.
export function failedOn(error: unknown, code: string, name: string): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const { code: found, constraint } = e as { code?: unknown; constraint?: unknown };
    if (found === code && (constraint === name || e.message.includes(name))) return true;
  }
  return false;
}

// True when a write failed because the folder it named was deleted after the write checked it.
export function isFolderGone(error: unknown): boolean {
  return failedOn(error, "23503", FOLDER_FK);
}

export async function createProject(
  db: DB,
  actor: Actor,
  input: { name: string; format: string; width?: number; height?: number; folderId?: string | null; templateId?: string },
): Promise<{ id: string; version: 0 }> {
  requireRole(actor, "editor");
  const name = projectName.safeParse(input.name);
  if (!name.success) throw invalidName();
  // A template gives the format, size and doc; the format and size in the input are ignored.
  const template = input.templateId === undefined ? null : await getTemplate(db, actor, input.templateId);
  if (input.templateId !== undefined && !template) throw new ServiceError("NOT_FOUND", 404, "Template not found");
  const frame = template
    ? { format: template.format, width: template.width, height: template.height }
    : projectFrame(input);
  if ("error" in frame) throw new ServiceError("INVALID", 400, frame.error);

  const id = newId();
  const folderId = input.folderId ?? null;
  const insert = (folderId: SQL | null) =>
    db.insert(projects).values({
      id,
      spaceId: actor.spaceId,
      name: name.data,
      format: frame.format,
      width: frame.width,
      height: frame.height,
      doc: template ? structuredClone(template.doc) : createEmptyDoc(frame.format, frame),
      folderId,
      version: 0,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    });
  // A folder that is gone leaves the project in no folder.
  try {
    await insert(
      folderId === null ? null : sql`(select id from folders where id = ${folderId} and space_id = ${actor.spaceId})`,
    );
  } catch (error) {
    if (folderId === null || !isFolderGone(error)) throw error;
    await insert(null);
  }
  return { id, version: 0 };
}

export async function getProject(db: DB, actor: Actor, id: string): Promise<ProjectRecord | null> {
  requireRole(actor, "viewer");
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      format: projects.format,
      doc: projects.doc,
      version: projects.version,
      updatedBy: projects.updatedBy,
      updatedAt: projects.updatedAt,
      thumbnailVersion: projects.thumbnailVersion,
      movedAtVersion: projects.movedAtVersion,
    })
    .from(projects)
    .where(liveProject(actor, id));
  return rows[0] ?? null;
}

export async function listProjects(db: DB, actor: Actor): Promise<ProjectSummary[]> {
  requireRole(actor, "viewer");
  return db
    .select({
      id: projects.id,
      name: projects.name,
      format: projects.format,
      width: storedWidth().mapWith(Number),
      height: storedHeight().mapWith(Number),
      folderId: projects.folderId,
      version: projects.version,
      createdAt: projects.createdAt,
      updatedBy: projects.updatedBy,
      updatedAt: projects.updatedAt,
      thumbnailVersion: projects.thumbnailVersion,
    })
    .from(projects)
    .where(inSpace(actor))
    .orderBy(desc(projects.updatedAt), asc(projects.id));
}

async function readVersion(db: DB, actor: Actor, id: string): Promise<number | null> {
  const rows = await db.select({ version: projects.version }).from(projects).where(liveProject(actor, id));
  return rows[0]?.version ?? null;
}

const notFound = (projectId: string) => new ServiceError("NOT_FOUND", 404, `Project "${projectId}" not found`);

const conflict = (message: string, currentVersion: number) =>
  new ServiceError("CONFLICT", 409, message, { currentVersion });

const rejected = (error: OpError, code: OpError["code"] = error.code) =>
  new ServiceError(code, 400, error.message, { opIndex: error.opIndex });

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

// Updates the doc, and the format and size columns that mirror it, only if its version is still the one read, and logs
// the ops and their inverse from that same update, so the doc and the op log can never disagree. Returns the new
// version, or null if another writer won or the project was deleted since it was read.
async function writeIfUnchanged(
  db: DB,
  input: {
    projectId: string;
    spaceId: string;
    readVersion: number;
    doc: TimelineDoc;
    ops: Op[];
    inverse: Op[];
    actor: string;
    requestId: string | null;
  },
): Promise<number | null> {
  const result = await db.execute(sql`
    with upd as (
      update projects
      set doc = ${JSON.stringify(input.doc)}::jsonb, format = ${input.doc.format}::text,
          width = ${input.doc.width}::integer, height = ${input.doc.height}::integer, version = version + 1,
          updated_by = ${input.actor}::text, updated_at = now()
      where id = ${input.projectId}::text and space_id = ${input.spaceId}::text
        and version = ${input.readVersion}::integer and deleted_at is null
      returning version
    )
    insert into project_ops (project_id, version, ops, inverse, actor, request_id)
    select ${input.projectId}::text, version, ${JSON.stringify(input.ops)}::jsonb, ${JSON.stringify(input.inverse)}::jsonb,
           ${input.actor}::text, ${input.requestId}::text from upd
    returning version
  `);
  const rows = rowsOf<{ version: number }>(result);
  return rows.length > 0 ? Number(rows[0].version) : null;
}

// The result already logged under this request id, or null. A request id belongs to the person who first used it.
export async function getAppliedRequest(db: DB, actor: Actor, projectId: string, requestId: string): Promise<AppliedOps | null> {
  const rows = await db
    .select({ version: projectOps.version, ops: projectOps.ops, inverse: projectOps.inverse, actor: projectOps.actor })
    .from(projectOps)
    .innerJoin(projects, and(eq(projects.id, projectOps.projectId), eq(projects.spaceId, actor.spaceId)))
    .where(and(eq(projectOps.projectId, projectId), eq(projectOps.requestId, requestId)));
  const row = rows[0];
  if (!row) return null;
  if (row.actor !== actor.userId) throw new ServiceError("INVALID", 400, "requestId is already in use");
  return { version: row.version, ops: row.ops, inverse: row.inverse ?? [] };
}

// True when a write failed because its request id was logged first. Drivers may wrap the database error.
function isRequestIdTaken(error: unknown): boolean {
  return failedOn(error, "23505", REQUEST_ID_INDEX);
}

export async function applyProjectOps(
  db: DB,
  actor: Actor,
  input: { projectId: string; baseVersion: number; ops: OpInput[]; strict?: boolean; requestId?: string },
): Promise<AppliedOps> {
  requireRole(actor, "editor");
  const requestId = input.requestId ?? null;
  if (requestId !== null && !REQUEST_ID.test(requestId)) {
    throw new ServiceError("INVALID", 400, "requestId must be 8 to 64 letters, digits, - or _");
  }
  if (!Array.isArray(input.ops) || input.ops.length === 0) {
    throw new ServiceError("INVALID", 400, "ops must be a non-empty array");
  }
  if (input.ops.length > LIMITS.opsPerRequest) {
    throw new ServiceError("LIMIT_EXCEEDED", 400, `At most ${LIMITS.opsPerRequest} ops per request`);
  }
  let ops: Op[];
  try {
    ops = prepareOps(input.ops, newId);
  } catch (error) {
    if (error instanceof OpError) throw rejected(error, "INVALID");
    throw error;
  }

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const rows = await db
      .select({ doc: projects.doc, version: projects.version, movedAtVersion: projects.movedAtVersion })
      .from(projects)
      .where(liveProject(actor, input.projectId));
    const current = rows[0];
    if (!current) throw notFound(input.projectId);
    // A retry of a write that already landed gets the original answer, even after newer edits.
    if (requestId !== null) {
      const prior = await getAppliedRequest(db, actor, input.projectId, requestId);
      if (prior) return prior;
    }
    // A change planned before the project moved to another space may name media of the old space.
    if (current.movedAtVersion !== null && input.baseVersion < current.movedAtVersion) {
      throw new ServiceError("MOVED", 409, MOVE_MESSAGES.moved, { currentVersion: current.version });
    }
    // A strict write is refused unless its base is the current version, so it never lands on edits the caller
    // has not seen. Inverses do not need this: their guards refuse an undo that would overwrite a later change.
    if (input.strict && current.version !== input.baseVersion) {
      throw conflict(`Project is at version ${current.version}, not ${input.baseVersion}`, current.version);
    }
    if (input.baseVersion > current.version) {
      throw conflict(
        `Base version ${input.baseVersion} is ahead of the project's version ${current.version}`,
        current.version,
      );
    }

    // Optimistic rebase: ops address clips and tracks by id, so they are applied to the current doc
    // even when the caller's base is older. They are rejected only if they no longer apply. The inverse is
    // recomputed on every attempt, so it always undoes the write against the doc it actually landed on.
    let doc: TimelineDoc;
    let inverse: Op[];
    try {
      ({ doc, inverse } = applyOps(current.doc, ops));
    } catch (error) {
      if (error instanceof OpError) throw rejected(error);
      throw error;
    }
    // A clip that was added, pointed at another asset, trimmed or re-timed is checked against the library, as
    // it is in the doc this write would produce. A change that touches no media makes no query.
    const assetIds = assetIdsToCheck(doc, ops);
    if (assetIds.length > 0) {
      const problem = findMediaProblem(doc, ops, await loadAssetFacts(db, actor.spaceId, assetIds));
      if (problem) {
        const code = problem.code === "past_end" ? "TRIM_OUT_OF_RANGE" : "INVALID";
        throw new ServiceError(code, 400, mediaProblemMessage(problem, ops), { opIndex: problem.opIndex });
      }
    }
    if (jsonBytes(doc) > LIMITS.docBytes) {
      throw new ServiceError("LIMIT_EXCEEDED", 400, `A project can be at most ${LIMITS.docBytes / 1024 / 1024} MB`);
    }
    // Every accepted change must be undoable with one request.
    if (inverse.length > LIMITS.opsPerRequest) {
      throw new ServiceError("LIMIT_EXCEEDED", 400, "This change is too large to undo in one step. Send it in smaller batches.");
    }
    if (jsonBytes(ops) + jsonBytes(inverse) > LIMITS.opLogRowBytes) {
      throw new ServiceError("LIMIT_EXCEEDED", 400, "This change is too large. Send it in smaller steps.");
    }
    // The undo is itself a write, logged with its own inverse (the redo, which is the same size again).
    // The inverse always applies to the doc it was just computed from, so this dry run cannot fail.
    if (jsonBytes(inverse) + jsonBytes(applyOps(doc, inverse).inverse) > LIMITS.opLogRowBytes) {
      throw new ServiceError("LIMIT_EXCEEDED", 400, "This change is too large to undo in one step. Send it in smaller batches.");
    }

    let version: number | null;
    try {
      version = await writeIfUnchanged(db, {
        projectId: input.projectId,
        spaceId: actor.spaceId,
        readVersion: current.version,
        doc,
        ops,
        inverse,
        actor: actor.userId,
        requestId,
      });
    } catch (error) {
      // The same request id landed first. The whole statement failed, so the doc is unchanged.
      if (requestId !== null && isRequestIdTaken(error)) {
        const prior = await getAppliedRequest(db, actor, input.projectId, requestId);
        if (prior) return prior;
      }
      throw error;
    }
    if (version !== null) return { version, ops, inverse };
  }

  const currentVersion = await readVersion(db, actor, input.projectId);
  if (currentVersion === null) throw notFound(input.projectId);
  throw conflict(
    `Project changed ${MAX_WRITE_ATTEMPTS} times while applying these ops; reload and try again`,
    currentVersion,
  );
}

// Changes neither the version nor the op log: the name is not part of the doc.
export async function renameProject(db: DB, actor: Actor, id: string, name: string): Promise<{ id: string; name: string }> {
  requireRole(actor, "editor");
  const parsed = projectName.safeParse(name);
  if (!parsed.success) throw invalidName();
  const rows = await db
    .update(projects)
    .set({ name: parsed.data, updatedBy: actor.userId, updatedAt: sql`now()` })
    .where(liveProject(actor, id))
    .returning({ name: projects.name });
  if (!rows[0]) throw notFound(id);
  return { id, name: rows[0].name };
}

// A soft delete: the row and its op log are kept, and the row records who deleted it. Its picture and its pin are
// dropped: no path brings a deleted project back.
export async function deleteProject(db: DB, actor: Actor, id: string): Promise<void> {
  requireRole(actor, "editor");
  const rows = await db
    .update(projects)
    .set({ deletedAt: sql`now()`, updatedBy: actor.userId, updatedAt: sql`now()`, thumbnail: null, thumbnailVersion: null })
    .where(liveProject(actor, id))
    .returning({ id: projects.id });
  if (!rows[0]) throw notFound(id);
  await dropPinOfDeleted(db, id);
}

// The doc is copied inside the insert itself, so the copy is always the version current at that moment. The copy
// stays in the source's folder, and its size is read from the doc, since the source's size columns may be empty. A
// picture of the current version is copied as the copy's version 0; an older one is left behind.
export async function duplicateProject(db: DB, actor: Actor, id: string): Promise<{ id: string; version: 0 }> {
  requireRole(actor, "editor");
  const source = await db.select({ name: projects.name }).from(projects).where(liveProject(actor, id));
  if (!source[0]) throw notFound(id);
  const copyId = newId();
  const copy = (folderId: SQL) =>
    db.execute(sql`
      insert into projects (id, space_id, name, format, doc, version, created_by, updated_by, folder_id, width, height,
                            thumbnail, thumbnail_version)
      select ${copyId}::text, space_id, ${copyName(source[0].name)}::text, format, doc, 0, ${actor.userId}::text, ${actor.userId}::text,
             ${folderId}, (doc->>'width')::integer, (doc->>'height')::integer,
             case when thumbnail_version = version then thumbnail end, case when thumbnail_version = version then 0 end
      from projects
      where id = ${id}::text and space_id = ${actor.spaceId}::text and deleted_at is null
      returning id
    `);
  let result: Awaited<ReturnType<typeof copy>>;
  try {
    result = await copy(sql`folder_id`);
  } catch (error) {
    // The folder was deleted while the copy was written: the copy goes in no folder.
    if (!isFolderGone(error)) throw error;
    result = await copy(sql`null`);
  }
  if (rowsOf(result).length === 0) throw notFound(id);
  return { id: copyId, version: 0 };
}

export type OpsPage = { version: number; entries: OpLogEntry[]; hasMore: boolean };

export async function getProjectVersion(db: DB, actor: Actor, id: string): Promise<number | null> {
  requireRole(actor, "viewer");
  return readVersion(db, actor, id);
}

export async function getOpsSince(
  db: DB,
  actor: Actor,
  projectId: string,
  since: number,
  limit: number = LIMITS.opsPageDefault,
): Promise<OpsPage | null> {
  requireRole(actor, "viewer");
  const version = await readVersion(db, actor, projectId);
  if (version === null) return null;
  if (version === since) return { version, entries: [], hasMore: false };
  // The next limit + 1 entries, bounded by the version read above, so a write that lands in between is left
  // for the next poll. The extra entry only shows whether more remain.
  const next = db
    .select({
      version: projectOps.version,
      ops: projectOps.ops,
      inverse: projectOps.inverse,
      actor: projectOps.actor,
      requestId: projectOps.requestId,
      createdAt: projectOps.createdAt,
    })
    .from(projectOps)
    .where(and(eq(projectOps.projectId, projectId), gt(projectOps.version, since), lte(projectOps.version, version)))
    .orderBy(asc(projectOps.version))
    .limit(limit + 1)
    .as("next");
  // Sized in the database, so entries past the byte budget are never sent here.
  const sized = db
    .select({
      version: next.version,
      ops: next.ops,
      inverse: next.inverse,
      actor: next.actor,
      requestId: next.requestId,
      createdAt: next.createdAt,
      position: sql<number>`row_number() over (order by ${next.version})`.mapWith(Number).as("position"),
      found: sql<number>`count(*) over ()`.mapWith(Number).as("found"),
      runningBytes: sql<number>`sum(octet_length(${next.ops}::text) + coalesce(octet_length(${next.inverse}::text), 0)) over (order by ${next.version})`
        .mapWith(Number)
        .as("running_bytes"),
    })
    .from(next)
    .as("sized");
  // Entries are added until the next one would pass the byte budget; the first is always sent.
  const rows = await db
    .select()
    .from(sized)
    .where(and(lte(sized.position, limit), or(eq(sized.position, 1), lte(sized.runningBytes, LIMITS.opsPageBytes))))
    .orderBy(asc(sized.version));
  const entries: OpLogEntry[] = rows.map(({ version, ops, inverse, actor, requestId, createdAt }) => ({
    version,
    ops,
    inverse,
    actor,
    requestId,
    createdAt,
  }));
  const hasMore = rows.length > 0 && rows.length < rows[0].found;
  // When more remain, the caller resumes from the last entry it got, so nothing is skipped.
  return { version: hasMore ? entries[entries.length - 1].version : version, entries, hasMore };
}
