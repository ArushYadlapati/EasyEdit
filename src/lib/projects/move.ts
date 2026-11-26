import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rowsOf, type DB } from "@/db";
import { assets, organization, projectMove, projects } from "@/db/schema";
import { meetsRole } from "@/lib/access-rules";
import type { Role } from "@/lib/allowlist/service";
import { FORBIDDEN_BODY } from "@/lib/api-errors";
import { requireRole, type Actor } from "@/lib/actor";
import type { DriveClient } from "@/lib/drive/client";
import { DriveError } from "@/lib/drive/token";
import { LIMITS } from "@/lib/limits";
import { MEDIA_MESSAGES } from "@/lib/media/messages";
import { driveName } from "@/lib/media/rules";
import { ASSET_FILES, cancelQuietly, notRecorded, trashQuietly, valuesOf, type AssetFileRole, type AssetRow, type MediaDeps, type NewAsset } from "@/lib/media/service";
import type { AssetKind } from "@/lib/media/types";
import { ServiceError } from "@/lib/service-error";
import { roleIn } from "@/lib/spaces/service";
import { storageState, type StorageDeps } from "@/lib/spaces/storage";
import { slugFor } from "@/lib/spaces/paths";
import type { SpaceKind } from "@/lib/spaces/types";
import { ConnectionBrokenError } from "@/lib/storage/google-oauth";
import type { Op, TimelineDoc } from "@/lib/timeline";
import { isMediaClip } from "@/lib/timeline";
import { MOVE_MESSAGES } from "./move-messages";
import { MAX_WRITE_ATTEMPTS } from "./service";
import { everyClip, hasNests } from "@/lib/timeline/nest";

export type MoveRow = typeof projectMove.$inferSelect;

export type MoveDeps = { db: DB; driveFor: (spaceId: string) => Promise<DriveClient | null>; origin: string; onDriveError?: (e: DriveError) => void;
  // What storageState reads the server's Drive settings with; tests point it at a pretend Google.
  storage?: StorageDeps;
  // Tests only: runs between finishMove's read and its write, so a test can land another write in between.
  beforeFinishWrite?: () => Promise<void>;
};

export type CopyState = { assetId: string; status: "uploading" | "ready"; hasPreview: boolean; hasPoster: boolean };

export type MoveItem = {
  sourceAssetId: string;
  kind: AssetKind;
  name: string;
  sizeBytes: number;
  originalFileId: string;
  previewFileId: string | null;
  posterFileId: string | null;
  copy: CopyState | null;
};

export type MovePlan = { moveId: string; projectId: string; to: { id: string; name: string; slug: string; kind: SpaceKind }; items: MoveItem[] };

const notFound = () => new ServiceError("NOT_FOUND", 404, "Not found");
const goneMove = () => new ServiceError("NOT_FOUND", 404, MOVE_MESSAGES.gone);

// Every media clip's asset id, each once, in track and clip order, a nest's clips after the nest. Text clips and
// empty slots have none.
export function usedAssetIds(doc: TimelineDoc): string[] {
  const ids = new Set<string>();
  for (const clip of everyClip(doc)) if (isMediaClip(clip)) ids.add(clip.assetId);
  return [...ids];
}

// An unfinished move started by `userId`; anything else is gone.
export async function moveOf(db: DB, userId: string, moveId: string): Promise<MoveRow> {
  const [row] = await db
    .select()
    .from(projectMove)
    .where(and(eq(projectMove.id, moveId), eq(projectMove.startedBy, userId), isNull(projectMove.finishedAt), isNull(projectMove.abandonedAt)));
  if (!row) throw goneMove();
  return row;
}

// Drops the copies a move made: their rows go first, then the Drive sessions and files. A Drive that can't be reached
// is reported, not shown. Storage that is gone leaves nothing to clean.
async function dropCopies(deps: MoveDeps, move: Pick<MoveRow, "id" | "toSpaceId">): Promise<void> {
  const gone = await deps.db
    .delete(assets)
    .where(eq(assets.moveId, move.id))
    .returning({ uploadUrl: assets.uploadUrl, driveFileId: assets.driveFileId, previewFileId: assets.previewFileId, posterFileId: assets.posterFileId, status: assets.status });
  if (gone.length === 0) return;
  let drive: DriveClient | null;
  try {
    drive = await deps.driveFor(move.toSpaceId);
  } catch (error) {
    if (!(error instanceof ConnectionBrokenError)) throw error;
    deps.onDriveError?.(new DriveError("token", 400, "invalid_grant"));
    return;
  }
  if (!drive) return;
  const media: MediaDeps = { db: deps.db, drive, origin: deps.origin, onDriveError: deps.onDriveError };
  for (const copy of gone) {
    if (copy.status === "uploading") await cancelQuietly(media, copy.uploadUrl);
    else await trashQuietly(media, [copy.driveFileId, copy.previewFileId, copy.posterFileId]);
  }
}

// One statement ends each move that is still open; those it ended have their copies dropped. With `quietly`, a copy
// that can't be dropped is reported, not thrown: its rows stay hidden until the clean-up.
async function abandonWhere(deps: MoveDeps, where: ReturnType<typeof and>, quietly = false): Promise<number> {
  const ended = await deps.db
    .update(projectMove)
    .set({ abandonedAt: sql`now()` })
    .where(and(where, isNull(projectMove.abandonedAt), isNull(projectMove.finishedAt)))
    .returning({ id: projectMove.id, toSpaceId: projectMove.toSpaceId });
  for (const move of ended) {
    try {
      await dropCopies(deps, move);
    } catch (error) {
      if (!quietly) throw error;
      deps.onDriveError?.(error instanceof DriveError ? error : new DriveError("cleanup", 0, "unknown"));
    }
  }
  return ended.length;
}

// Whether a project that `userId` can't reach was moved away from a space they are in: it is still there (not deleted),
// in a space they are not a member of, and its latest finished move left from one they are. Then the editor can say it
// moved rather than that it was deleted.
export async function movedElsewhere(db: DB, userId: string, projectId: string): Promise<boolean> {
  const [project] = await db.select({ spaceId: projects.spaceId }).from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  if (!project || (await roleIn(db, userId, project.spaceId))) return false;
  const [last] = await db
    .select({ fromSpaceId: projectMove.fromSpaceId })
    .from(projectMove)
    .where(and(eq(projectMove.projectId, projectId), isNotNull(projectMove.finishedAt)))
    .orderBy(desc(projectMove.finishedAt))
    .limit(1);
  return last !== undefined && last.fromSpaceId !== project.spaceId && (await roleIn(db, userId, last.fromSpaceId)) !== null;
}

export async function abandonMove(deps: MoveDeps, userId: string, moveId: string): Promise<void> {
  const ended = await abandonWhere(deps, and(eq(projectMove.id, moveId), eq(projectMove.startedBy, userId)));
  if (ended === 0) throw goneMove();
}

// The space a move goes to, where the person must be an editor or admin. A space they are not in is as good as missing.
async function destination(db: DB, userId: string, spaceId: string): Promise<{ to: MovePlan["to"]; role: Role }> {
  const role = await roleIn(db, userId, spaceId);
  const [space] = role ? await db.select().from(organization).where(eq(organization.id, spaceId)) : [];
  if (!role || !space) throw notFound();
  const kind = space.kind as SpaceKind;
  const to = { id: space.id, name: space.name, slug: slugFor({ id: space.id, name: space.name, slug: space.slug, kind }), kind };
  if (!meetsRole(role, "editor")) throw new ServiceError("FORBIDDEN", 403, MOVE_MESSAGES.cantEditThere(to.name));
  return { to, role };
}

export async function startMove(deps: MoveDeps, actor: Actor, input: { projectId: string; toSpaceId: string }): Promise<MovePlan> {
  const { db } = deps;
  requireRole(actor, "editor");
  const [project] = await db
    .select({ id: projects.id, doc: projects.doc })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.spaceId, actor.spaceId), isNull(projects.deletedAt)));
  if (!project) throw new ServiceError("NOT_FOUND", 404, `Project "${input.projectId}" not found`);
  if (input.toSpaceId === actor.spaceId) throw new ServiceError("INVALID", 400, MOVE_MESSAGES.sameSpace);

  const { to, role } = await destination(db, actor.userId, input.toSpaceId);

  const state = await storageState(db, to.id, deps.storage);
  if (!state.ready) {
    if (state.reason === "broken") throw new ServiceError("NO_STORAGE", 409, MOVE_MESSAGES.storageBroken(to.name));
    const mayFix = to.kind === "personal" || meetsRole(role, "admin");
    throw new ServiceError("NO_STORAGE", 409, mayFix ? MOVE_MESSAGES.noStorage(to.name) : MOVE_MESSAGES.noStorageAskAdmin(to.name));
  }
  // Google may have dropped the connection since it was last used; asking for a token finds out.
  try {
    await (await deps.driveFor(to.id))?.readToken();
  } catch (error) {
    if (!(error instanceof ConnectionBrokenError)) throw error;
    throw new ServiceError("NO_STORAGE", 409, MOVE_MESSAGES.storageBroken(to.name));
  }

  // A move points each clip at the copy of its file with an edit of that clip, and a nest's clips cannot be edited
  // where they are: a project with a nest is taken apart first.
  if (hasNests(project.doc)) throw new ServiceError("INVALID", 400, MOVE_MESSAGES.hasNests);

  // Every asset the project uses is in this space and finished.
  const ids = usedAssetIds(project.doc);
  const sources = ids.length === 0 ? [] : await db.select().from(assets).where(and(inArray(assets.id, ids), eq(assets.spaceId, actor.spaceId), isNull(assets.moveId)));
  const byId = new Map(sources.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (row && row.status === "ready" && row.driveFileId === null) throw new ServiceError("INVALID", 400, MOVE_MESSAGES.onAComputer(row.name));
    if (!row || row.status !== "ready" || row.driveFileId === null) throw new ServiceError("INVALID", 400, MOVE_MESSAGES.notReady(row?.name ?? id));
  }

  // One open move per person and project (other people's fresh moves are left alone), and a move into a space that sat unfinished for a day is dropped.
  await abandonWhere(deps, and(eq(projectMove.projectId, project.id), eq(projectMove.startedBy, actor.userId), ne(projectMove.toSpaceId, to.id)));
  await abandonWhere(deps, and(eq(projectMove.toSpaceId, to.id), lt(projectMove.startedAt, new Date(Date.now() - LIMITS.moveAbandonAfterMs))));

  const [open] = await db
    .select()
    .from(projectMove)
    .where(and(eq(projectMove.projectId, project.id), eq(projectMove.toSpaceId, to.id), eq(projectMove.startedBy, actor.userId), isNull(projectMove.finishedAt), isNull(projectMove.abandonedAt)))
    .orderBy(desc(projectMove.startedAt))
    .limit(1);
  const move = open ?? (await db.insert(projectMove).values({ id: nanoid(12), projectId: project.id, fromSpaceId: actor.spaceId, toSpaceId: to.id, startedBy: actor.userId }).returning())[0];

  const copies = ids.length === 0 ? [] : await db.select().from(assets).where(and(eq(assets.moveId, move.id), inArray(assets.copiedFrom, ids)));
  const copyOf = new Map(copies.map((row) => [row.copiedFrom, row]));
  const items = ids.map((id): MoveItem => {
    const row = byId.get(id)!;
    const copy = copyOf.get(id);
    return {
      sourceAssetId: id,
      kind: row.kind,
      name: row.name,
      sizeBytes: row.sizeBytes,
      originalFileId: row.driveFileId!,
      previewFileId: row.previewFileId,
      posterFileId: row.posterFileId,
      copy: copy ? { assetId: copy.id, status: copy.status, hasPreview: copy.previewFileId !== null, hasPoster: copy.posterFileId !== null } : null,
    };
  });
  return { moveId: move.id, projectId: project.id, to, items };
}

// ---- Copies: each asset a project uses is copied into the destination's storage, held back from every library until the move finishes.

export type OpenedCopy = { copyAssetId: string; uploadUrl: string | null; offset: number; done: boolean };

const notFinished = () => new ServiceError("CONFLICT", 409, MEDIA_MESSAGES.notFinished);

// The destination's Drive; a space with no storage can't be copied into.
async function destinationDrive(deps: MoveDeps, move: MoveRow): Promise<DriveClient> {
  let drive: DriveClient | null;
  try {
    drive = await deps.driveFor(move.toSpaceId);
  } catch (error) {
    if (!(error instanceof ConnectionBrokenError)) throw error;
    deps.onDriveError?.(new DriveError("token", 400, "invalid_grant"));
    throw new ServiceError("NO_STORAGE", 409, MOVE_MESSAGES.storageBroken(await spaceName(deps.db, move.toSpaceId)));
  }
  if (!drive) throw new ServiceError("NO_STORAGE", 409, MOVE_MESSAGES.noStorage(await spaceName(deps.db, move.toSpaceId)));
  return drive;
}

async function spaceName(db: DB, spaceId: string): Promise<string> {
  const [space] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, spaceId));
  return space?.name ?? "That space";
}

const stateOf = (row: AssetRow): CopyState => ({ assetId: row.id, status: row.status === "ready" ? "ready" : "uploading", hasPreview: row.previewFileId !== null, hasPoster: row.posterFileId !== null });

// A copy row of this move, still there.
async function copyRowOf(db: DB, moveId: string, copyAssetId: string): Promise<AssetRow> {
  const [row] = await db.select().from(assets).where(and(eq(assets.id, copyAssetId), eq(assets.moveId, moveId)));
  if (!row) throw goneMove();
  return row;
}

export async function openCopy(deps: MoveDeps & { checkNew?: () => Promise<void> }, userId: string, moveId: string, sourceAssetId: string): Promise<OpenedCopy> {
  const { db } = deps;
  const move = await moveOf(db, userId, moveId);
  const [project] = await db.select({ doc: projects.doc }).from(projects).where(eq(projects.id, move.projectId));
  if (!project || !usedAssetIds(project.doc).includes(sourceAssetId)) throw new ServiceError("INVALID", 400, MOVE_MESSAGES.notInProject);
  const [source] = await db.select().from(assets).where(and(eq(assets.id, sourceAssetId), eq(assets.spaceId, move.fromSpaceId), isNull(assets.moveId)));
  if (!source || source.status !== "ready") throw new ServiceError("INVALID", 400, MOVE_MESSAGES.notReady(source?.name ?? sourceAssetId));
  const drive = await destinationDrive(deps, move);

  const [existing] = await db.select().from(assets).where(and(eq(assets.moveId, move.id), eq(assets.copiedFrom, source.id)));
  if (existing) return takeUpCopy(deps, drive, move, existing);

  await deps.checkNew?.();
  const id = nanoid(12);
  const { driveFileId, uploadUrl } = await openOriginal(drive, deps.origin, { id, fileName: source.fileName, mimeType: source.mimeType, sizeBytes: source.sizeBytes });
  const row: NewAsset = {
    id,
    spaceId: move.toSpaceId,
    kind: source.kind,
    name: source.name,
    fileName: source.fileName,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    lastModifiedMs: source.lastModifiedMs,
    status: "uploading",
    driveFileId,
    uploadUrl,
    durationMs: source.durationMs,
    width: source.width,
    height: source.height,
    fps: source.fps,
    hasAudio: source.hasAudio,
    videoCodec: source.videoCodec,
    previewStatus: source.kind !== "video" ? "none" : source.previewStatus === "ready" ? "pending" : "failed",
    previewFileId: null,
    posterFileId: null,
    pendingPreviewFileId: null,
    pendingPosterFileId: null,
    event: source.event,
    uploadedBy: userId,
    createdAt: sql`now()`,
    readyAt: null,
    removedAt: null,
    removedBy: null,
    moveId: move.id,
    copiedFrom: source.id,
  };
  // One statement: the move must still be open, and no other request may have made this source's copy first. A copy
  // is an unfinished upload like any other, so it yields to the mover's own unfinished upload of the same file there.
  let inserted: { id: string }[];
  try {
    inserted = await db
      .insert(assets)
      .select(sql`select ${valuesOf(row)} where ${moveIsOpen(move.id)} and not exists (select 1 from assets where move_id = ${move.id}::text and copied_from = ${source.id}::text)`)
      .onConflictDoNothing({ target: [assets.spaceId, assets.uploadedBy, assets.fileName, assets.sizeBytes, assets.lastModifiedMs], where: sql`status = 'uploading'` })
      .returning({ id: assets.id });
  } catch (error) {
    await dropSession(deps, drive, uploadUrl);
    throw notRecorded(error);
  }
  if (inserted.length > 0) return { copyAssetId: id, uploadUrl, offset: 0, done: false };

  // Nothing went in: the move ended meanwhile, a simultaneous request made this copy first, or an unfinished upload of
  // the same file is in the way.
  await dropSession(deps, drive, uploadUrl);
  await moveOf(db, userId, moveId);
  const [winner] = await db.select().from(assets).where(and(eq(assets.moveId, move.id), eq(assets.copiedFrom, source.id)));
  if (!winner) throw new ServiceError("CONFLICT", 409, MOVE_MESSAGES.uploadInTheWay(source.name));
  return takeUpCopy(deps, drive, move, winner);
}

const moveIsOpen = (moveId: string) => sql`exists (select 1 from project_move where id = ${moveId}::text and finished_at is null and abandoned_at is null)`;

// A session that is no longer wanted. Whatever goes wrong cancelling it must not hide why it is no longer wanted.
async function dropSession(deps: MoveDeps, drive: DriveClient, uploadUrl: string): Promise<void> {
  try {
    await cancelQuietly({ db: deps.db, drive, origin: deps.origin, onDriveError: deps.onDriveError }, uploadUrl);
  } catch {
    // the session expires on its own
  }
}

// An existing copy as a re-open answers it: done, taken up where it stopped, or given a fresh session on the same row.
async function takeUpCopy(deps: MoveDeps, drive: DriveClient, move: MoveRow, existing: AssetRow): Promise<OpenedCopy> {
  const { db } = deps;
  if (existing.status === "ready") return { copyAssetId: existing.id, uploadUrl: null, offset: existing.sizeBytes, done: true };
  if (existing.uploadUrl !== null) {
    try {
      const { done, offset } = await drive.uploadOffset(existing.uploadUrl, existing.sizeBytes);
      return { copyAssetId: existing.id, uploadUrl: existing.uploadUrl, offset, done };
    } catch (error) {
      if (!(error instanceof DriveError && error.reason === "expired")) throw error;
    }
  }
  // The session expired: a fresh one for the same row, so the copy keeps its id.
  const { driveFileId, uploadUrl } = await openOriginal(drive, deps.origin, existing);
  let updated: { id: string }[];
  try {
    updated = await db
      .update(assets)
      .set({ driveFileId, uploadUrl })
      .where(and(eq(assets.id, existing.id), eq(assets.moveId, move.id), eq(assets.status, "uploading"), moveIsOpen(move.id)))
      .returning({ id: assets.id });
  } catch (error) {
    await dropSession(deps, drive, uploadUrl);
    throw notRecorded(error);
  }
  if (updated.length === 0) {
    await dropSession(deps, drive, uploadUrl);
    const [now] = await db.select().from(assets).where(and(eq(assets.id, existing.id), eq(assets.moveId, move.id)));
    if (now?.status === "ready") return { copyAssetId: now.id, uploadUrl: null, offset: now.sizeBytes, done: true };
    throw goneMove();
  }
  return { copyAssetId: existing.id, uploadUrl, offset: 0, done: false };
}

async function openOriginal(drive: DriveClient, origin: string, row: Pick<AssetRow, "id" | "fileName" | "mimeType" | "sizeBytes">): Promise<{ driveFileId: string; uploadUrl: string }> {
  const driveFileId = await drive.newFileId();
  const uploadUrl = await drive.openUploadSession({
    id: driveFileId,
    name: driveName(row.id, row.fileName),
    parentId: await drive.folderId("Originals"),
    mimeType: row.mimeType === "" ? "application/octet-stream" : row.mimeType,
    sizeBytes: row.sizeBytes,
    origin,
  });
  return { driveFileId, uploadUrl };
}

export async function completeCopy(deps: MoveDeps, userId: string, moveId: string, copyAssetId: string): Promise<CopyState> {
  const { db } = deps;
  const move = await moveOf(db, userId, moveId);
  const row = await copyRowOf(db, move.id, copyAssetId);
  if (row.status === "ready") return stateOf(row);
  const drive = await destinationDrive(deps, move);

  const file = await drive.getFile(row.driveFileId ?? "");
  if (!file || file.trashed || file.sizeBytes !== row.sizeBytes) throw notFinished();
  if (!file.parents.includes(await drive.folderId("Originals"))) throw new ServiceError("INVALID", 400, MEDIA_MESSAGES.wrongFolder);

  const [ready] = await db
    .update(assets)
    .set({ status: "ready", readyAt: sql`now()`, uploadUrl: null, driveFileId: file.id })
    .where(and(eq(assets.id, row.id), eq(assets.moveId, move.id), eq(assets.status, "uploading")))
    .returning();
  return stateOf(ready ?? (await copyRowOf(db, move.id, row.id)));
}

export async function openCopyFile(deps: MoveDeps, userId: string, moveId: string, copyAssetId: string, input: { role: AssetFileRole; sizeBytes: number }): Promise<{ uploadUrl: string }> {
  const { db } = deps;
  const move = await moveOf(db, userId, moveId);
  const row = await copyRowOf(db, move.id, copyAssetId);
  if (row.status !== "ready") throw notFinished();
  const file = ASSET_FILES[input.role];
  if (!file.kinds.includes(row.kind)) throw new ServiceError("INVALID", 400, MEDIA_MESSAGES.wrongFileRole);
  const { sizeBytes } = input;
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > file.maxBytes) throw new ServiceError("INVALID", 400, MEDIA_MESSAGES.badFileSize);
  const drive = await destinationDrive(deps, move);

  const fileId = await drive.newFileId();
  const uploadUrl = await drive.openUploadSession({
    id: fileId,
    name: `${row.id}.${file.suffix}`,
    parentId: await drive.folderId("Previews"),
    mimeType: file.mimeType,
    sizeBytes,
    origin: deps.origin,
  });
  const recorded = await db.update(assets).set(file.waitFor(fileId)).where(and(eq(assets.id, row.id), eq(assets.moveId, move.id))).returning({ id: assets.id });
  if (recorded.length === 0) throw goneMove();
  return { uploadUrl };
}

export async function completeCopyFile(deps: MoveDeps, userId: string, moveId: string, copyAssetId: string, role: AssetFileRole): Promise<CopyState> {
  const { db } = deps;
  const move = await moveOf(db, userId, moveId);
  const file = ASSET_FILES[role];
  const row = await copyRowOf(db, move.id, copyAssetId);
  const fileId = row[file.pendingColumn];
  if (fileId === null) {
    if (row[file.column] !== null) return stateOf(row);
    throw notFinished();
  }
  const drive = await destinationDrive(deps, move);
  const inDrive = await drive.getFile(fileId);
  const whole = inDrive !== null && !inDrive.trashed && inDrive.sizeBytes > 0;
  if (!whole || !inDrive.parents.includes(await drive.folderId("Previews"))) throw notFinished();

  const [moved] = await db
    .update(assets)
    .set(file.moveOver)
    .where(and(eq(assets.id, row.id), eq(assets.moveId, move.id), eq(assets[file.pendingColumn], fileId)))
    .returning();
  if (!moved) {
    await copyRowOf(db, move.id, row.id);
    throw notFinished();
  }
  await trashQuietly({ db, drive, origin: deps.origin, onDriveError: deps.onDriveError }, [row[file.column]]); // a copy's own earlier file, never the source's
  return stateOf(moved);
}

// ---- Finishing: the project is pointed at its copies and changes space, all in one write.

export type FinishedMove = { projectId: string; spaceId: string; slug: string; version: number };

// The doc with every media clip pointed at its copy, and the update_clip ops that say so, one per clip.
function ontoCopies(doc: TimelineDoc, copyOf: Map<string, string>): { doc: TimelineDoc; ops: Op[] } {
  const moved = structuredClone(doc);
  const ops: Op[] = [];
  for (const track of moved.tracks) {
    for (const clip of track.clips) {
      if (!isMediaClip(clip)) continue;
      clip.assetId = copyOf.get(clip.assetId)!;
      ops.push({ op: "update_clip", clipId: clip.id, patch: { assetId: clip.assetId } });
    }
  }
  // The saved words are kept per file, so they move to the copies' ids too; words of a file with no copy are dropped.
  const transcripts = moved.captions?.transcripts;
  if (moved.captions && transcripts) {
    const kept = Object.fromEntries(Object.entries(transcripts).flatMap(([assetId, words]) => (copyOf.has(assetId) ? [[copyOf.get(assetId)!, words]] : [])));
    if (Object.keys(kept).length > 0) moved.captions.transcripts = kept;
    else delete moved.captions.transcripts;
    if (Object.keys(moved.captions).length === 0) delete moved.captions;
  }
  return { doc: moved, ops };
}

export async function finishMove(deps: MoveDeps, userId: string, moveId: string): Promise<FinishedMove> {
  const { db } = deps;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const move = await moveOf(db, userId, moveId);
    const [project] = await db
      .select({ doc: projects.doc, version: projects.version })
      .from(projects)
      .where(and(eq(projects.id, move.projectId), eq(projects.spaceId, move.fromSpaceId), isNull(projects.deletedAt)));
    if (!project) throw new ServiceError("NOT_FOUND", 404, `Project "${move.projectId}" not found`);
    // Roles may have changed since the move started: still an editor where the project is, and where it goes.
    const from = await roleIn(db, userId, move.fromSpaceId);
    if (!from) throw new ServiceError("NOT_FOUND", 404, `Project "${move.projectId}" not found`);
    if (!meetsRole(from, "editor")) throw new ServiceError("FORBIDDEN", 403, FORBIDDEN_BODY.message);
    const { to } = await destination(db, userId, move.toSpaceId);

    // Every asset the doc uses now has a finished copy; of two copies of one source, the first made is used.
    const ids = usedAssetIds(project.doc);
    const copies = ids.length === 0 ? [] : await db
      .select({ id: assets.id, copiedFrom: assets.copiedFrom })
      .from(assets)
      .where(and(eq(assets.moveId, move.id), eq(assets.status, "ready"), inArray(assets.copiedFrom, ids)))
      .orderBy(asc(assets.createdAt), asc(assets.id));
    const copyOf = new Map<string, string>();
    for (const row of copies) if (!copyOf.has(row.copiedFrom!)) copyOf.set(row.copiedFrom!, row.id);
    const missing = ids.filter((id) => !copyOf.has(id));
    if (missing.length > 0) throw new ServiceError("COPIES_MISSING", 409, MOVE_MESSAGES.copiesMissing, { missing });
    const { doc, ops } = ontoCopies(project.doc, copyOf);
    const used = [...new Set(copyOf.values())];
    const usedCopy = used.length === 0 ? sql`false` : sql`id in (${sql.join(used.map((id) => sql`${id}`), sql`, `)})`;

    await deps.beforeFinishWrite?.();
    // One statement. The project moves only if it is unchanged since it was read and still in the space it leaves, the
    // move is still open (its row is locked, so an abandon waits and then finds it finished), and every copy the doc
    // now names is still there. Then: no change from before can be undone, the old space's pin goes, the copies the
    // doc uses join the destination's library (any others stay hidden for the clean-up), a video copy among them whose
    // preview never came across is marked failed, so none waits for one for ever, and the move is finished.
    // The wipe runs on the rows as they were before this statement, so it never touches the move's own log row.
    const result = await db.execute(sql`
      with upd as (
        update projects
        set space_id = ${to.id}::text, folder_id = null, doc = ${JSON.stringify(doc)}::jsonb, version = version + 1,
            moved_at_version = version + 1, updated_by = ${userId}::text, updated_at = now()
        where id = ${move.projectId}::text and space_id = ${move.fromSpaceId}::text and version = ${project.version}::integer
          and deleted_at is null
          and exists (select 1 from project_move where id = ${move.id}::text and finished_at is null and abandoned_at is null for update)
          and (select count(*) from assets where move_id = ${move.id}::text and status = 'ready' and ${usedCopy}) = ${used.length}::integer
        returning version
      ),
      wipe as (update project_ops set inverse = null where project_id = ${move.projectId}::text and inverse is not null and exists (select 1 from upd)),
      unpin as (delete from project_pins where project_id = ${move.projectId}::text and exists (select 1 from upd)),
      adopt as (
        update assets
        set move_id = null,
            preview_status = case when kind = 'video' and preview_file_id is null then 'failed' else preview_status end
        where move_id = ${move.id}::text and ${usedCopy} and exists (select 1 from upd)
      ),
      done as (update project_move set finished_at = now() where id = ${move.id}::text and exists (select 1 from upd))
      insert into project_ops (project_id, version, ops, inverse, actor)
      select ${move.projectId}::text, version, ${JSON.stringify(ops)}::jsonb, null, ${userId}::text from upd
      returning version
    `);
    const rows = rowsOf<{ version: number }>(result);
    if (rows.length === 0) continue; // changed meanwhile: read again, which may find new media or the move gone

    // Anyone else's move of this project from the space it left can no longer land; its copies are dropped. So are this
    // move's own unused copies (after the adopt above, only those still carry its id), or they would hold their files'
    // places for ever. The move has happened, so nothing here may say otherwise: trouble is only reported.
    try {
      await dropCopies(deps, move);
      await abandonWhere(deps, and(eq(projectMove.projectId, move.projectId), eq(projectMove.fromSpaceId, move.fromSpaceId), ne(projectMove.id, move.id)), true);
    } catch (error) {
      console.error("Move clean-up failed", move.id, error instanceof Error ? error.name : typeof error);
    }
    return { projectId: move.projectId, spaceId: to.id, slug: to.slug, version: Number(rows[0].version) };
  }
  throw new ServiceError("CONFLICT", 409, MOVE_MESSAGES.busy);
}
