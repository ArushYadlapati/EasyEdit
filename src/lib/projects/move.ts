import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "@/db";
import { assets, organization, projectMove, projects } from "@/db/schema";
import { meetsRole } from "@/lib/access-rules";
import { requireRole, type Actor } from "@/lib/actor";
import type { DriveClient } from "@/lib/drive/client";
import { DriveError } from "@/lib/drive/token";
import { LIMITS } from "@/lib/limits";
import { cancelQuietly, trashQuietly, type MediaDeps } from "@/lib/media/service";
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

  // One open move per project, and a move into a space that sat unfinished for a day is dropped.
  await abandonWhere(deps, and(eq(projectMove.projectId, project.id), or(ne(projectMove.toSpaceId, to.id), ne(projectMove.startedBy, actor.userId))));
  await abandonWhere(deps, and(eq(projectMove.toSpaceId, to.id), lt(projectMove.startedAt, new Date(Date.now() - LIMITS.moveAbandonAfterMs))));

  const [open] = await db
    .select()
    .from(projectMove)
    .where(and(eq(projectMove.projectId, project.id), eq(projectMove.toSpaceId, to.id), eq(projectMove.startedBy, actor.userId), isNull(projectMove.finishedAt), isNull(projectMove.abandonedAt)));
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
