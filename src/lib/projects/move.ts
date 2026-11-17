import { and, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "@/db";
import { assets, organization, projectMove, projects } from "@/db/schema";
import { meetsRole } from "@/lib/access-rules";
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
import type { TimelineDoc } from "@/lib/timeline";
import { MOVE_MESSAGES } from "./move-messages";

export type MoveRow = typeof projectMove.$inferSelect;

export type MoveDeps = { db: DB; driveFor: (spaceId: string) => Promise<DriveClient | null>; origin: string; onDriveError?: (e: DriveError) => void;
  // What storageState reads the server's Drive settings with; tests point it at a pretend Google.
  storage?: StorageDeps;
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

// Every media clip's asset id, each once, in track and clip order.
export function usedAssetIds(doc: TimelineDoc): string[] {
  const ids = new Set<string>();
  for (const track of doc.tracks) for (const clip of track.clips) if (clip.type !== "text") ids.add(clip.assetId);
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

// One statement ends each move that is still open; those it ended have their copies dropped.
async function abandonWhere(deps: MoveDeps, where: ReturnType<typeof and>): Promise<number> {
  const ended = await deps.db
    .update(projectMove)
    .set({ abandonedAt: sql`now()` })
    .where(and(where, isNull(projectMove.abandonedAt), isNull(projectMove.finishedAt)))
    .returning({ id: projectMove.id, toSpaceId: projectMove.toSpaceId });
  for (const move of ended) await dropCopies(deps, move);
  return ended.length;
}

export async function abandonMove(deps: MoveDeps, userId: string, moveId: string): Promise<void> {
  const ended = await abandonWhere(deps, and(eq(projectMove.id, moveId), eq(projectMove.startedBy, userId)));
  if (ended === 0) throw goneMove();
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

  // The destination: a space the person is not in is as good as missing.
  const role = await roleIn(db, actor.userId, input.toSpaceId);
  const [space] = role ? await db.select().from(organization).where(eq(organization.id, input.toSpaceId)) : [];
  if (!role || !space) throw notFound();
  const to = { id: space.id, name: space.name, slug: slugFor({ id: space.id, name: space.name, slug: space.slug, kind: space.kind as SpaceKind }), kind: space.kind as SpaceKind };
  if (!meetsRole(role, "editor")) throw new ServiceError("FORBIDDEN", 403, MOVE_MESSAGES.cantEditThere(to.name));

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

  // Every asset the project uses is in this space and finished.
  const ids = usedAssetIds(project.doc);
  const sources = ids.length === 0 ? [] : await db.select().from(assets).where(and(inArray(assets.id, ids), eq(assets.spaceId, actor.spaceId), isNull(assets.moveId)));
  const byId = new Map(sources.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
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
  // One statement: the move must still be open, and no other request may have made this source's copy first.
  let inserted: { id: string }[];
  try {
    inserted = await db
      .insert(assets)
      .select(sql`select ${valuesOf(row)} where ${moveIsOpen(move.id)} and not exists (select 1 from assets where move_id = ${move.id}::text and copied_from = ${source.id}::text)`)
      .returning({ id: assets.id });
  } catch (error) {
    await dropSession(deps, drive, uploadUrl);
    throw notRecorded(error);
  }
  if (inserted.length > 0) return { copyAssetId: id, uploadUrl, offset: 0, done: false };

  // Nothing went in: the move ended meanwhile, or a simultaneous request made this copy first.
  await dropSession(deps, drive, uploadUrl);
  await moveOf(db, userId, moveId);
  const [winner] = await db.select().from(assets).where(and(eq(assets.moveId, move.id), eq(assets.copiedFrom, source.id)));
  if (!winner) throw goneMove();
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
