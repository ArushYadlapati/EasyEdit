import { projects } from "@/db/schema";
import { sharedFolderClient } from "@/lib/drive/client";
import { completeCopy, openCopy, usedAssetIds, type MoveDeps } from "@/lib/projects/move";
import { storageFor } from "@/lib/spaces/storage";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { eq } from "drizzle-orm";
import { testActor } from "../helpers/actor";
import { piece } from "../helpers/fake-drive";
import { storageWorld } from "../helpers/storage";
import { insertAsset, mediaClip } from "../media/context";

export const ORIGIN = "https://app.test";

// u1 in Seattle Solvers with project p1 there, using video A (twice) and image B, plus a text clip; u1's personal space
// has storage.
export async function moveWorld() {
  const w = await storageWorld();
  const storage = { config: () => w.cfg, sharedFolder: () => sharedFolderClient(w.fake.config, { fetch: w.fake.fetch, now: w.fake.now }), fetch: w.fake.fetch };
  const deps: MoveDeps = { db: w.db, driveFor: (id) => storageFor(w.db, id, storage), origin: ORIGIN, storage };
  const setUp = async (spaceId: string, userId = "u1") => {
    const connection = await w.connect({ userId });
    await makeSetUpStorage({ config: w.cfg, fetch: w.fake.fetch })(w.db, { spaceId, connectionId: connection.id, byUserId: userId });
    return connection;
  };
  const connection = await setUp(w.personal);
  const actor = testActor();
  const track = (kind: string, clips: unknown[]) => ({ id: `t-${kind}`, kind, name: kind, muted: false, hidden: false, locked: false, clips });
  const a = await insertAsset(w.db, { name: "Clip A", previewFileId: "prev-a", posterFileId: "poster-a", driveFileId: "orig-a" });
  const b = await insertAsset(w.db, { name: "Photo B", kind: "image", fileName: "IMG_4900.JPG", mimeType: "image/jpeg", driveFileId: "orig-b" });
  const doc = {
    schemaVersion: 1, format: "short_9x16", width: 1080, height: 1920, fps: 30,
    tracks: [
      track("video", [{ id: "c1", ...mediaClip(a) }, { id: "c2", ...mediaClip(a, { start: 100 }) }, { id: "c3", ...mediaClip(b, { type: "image", start: 200 }) }]),
      track("text", [{ id: "c4", type: "text", start: 0, duration: 30, text: "hi", style: {}, transform: {} }]),
    ],
  };
  await w.db.insert(projects).values({ id: "p1", spaceId: actor.spaceId, name: "P", format: "short_9x16", doc: doc as never, createdBy: "u1", updatedBy: "u1" });
  return { w, deps, actor, a, b, doc: doc as never, connection, storage, setUp };
}

export type MoveWorld = Awaited<ReturnType<typeof moveWorld>>;

// Copies one source's original all the way through, as the mover's browser would. The copy's id.
export async function copyFully(x: MoveWorld, userId: string, moveId: string, sourceId: string, deps: MoveDeps = x.deps): Promise<string> {
  const opened = await openCopy(deps, userId, moveId, sourceId);
  if (!opened.done) await piece(x.w.fake, opened.uploadUrl!, 0, 20_000_000, 20_000_000);
  await completeCopy(deps, userId, moveId, opened.copyAssetId);
  return opened.copyAssetId;
}

// Copies every source the project uses now. Source id → copy id.
export async function copyAll(x: MoveWorld, userId: string, moveId: string, projectId = "p1"): Promise<Map<string, string>> {
  const [project] = await x.w.db.select({ doc: projects.doc }).from(projects).where(eq(projects.id, projectId));
  const copies = new Map<string, string>();
  for (const id of usedAssetIds(project.doc)) copies.set(id, await copyFully(x, userId, moveId, id));
  return copies;
}
