import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assets, projects } from "@/db/schema";
import { sharedFolderClient } from "@/lib/drive/client";
import { abandonMove, completeCopy, completeCopyFile, openCopy, openCopyFile, startMove, type MoveDeps } from "@/lib/projects/move";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { storageFor } from "@/lib/spaces/storage";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { testActor } from "../helpers/actor";
import { piece } from "../helpers/fake-drive";
import { storageWorld } from "../helpers/storage";
import { insertAsset, mediaClip } from "../media/context";

afterEach(() => vi.restoreAllMocks());

const ORIGIN = "https://app.test";

async function world() {
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
  const b = await insertAsset(w.db, { name: "Photo B", kind: "image", driveFileId: "orig-b" });
  const doc = {
    schemaVersion: 1, format: "short_9x16", width: 1080, height: 1920, fps: 30,
    tracks: [
      track("video", [{ id: "c1", ...mediaClip(a) }, { id: "c2", ...mediaClip(a, { start: 100 }) }, { id: "c3", ...mediaClip(b, { type: "image" }) }]),
      track("text", [{ id: "c4", type: "text", start: 0, duration: 30, text: "hi", style: {}, transform: {} }]),
    ],
  };
  await w.db.insert(projects).values({ id: "p1", spaceId: actor.spaceId, name: "P", format: "short_9x16", doc: doc as never, createdBy: "u1", updatedBy: "u1" });
  return { w, deps, actor, a, b, doc: doc as never, connection, storage, setUp };
}



async function started() {
  const x = await world();
  const plan = await startMove(x.deps, x.actor, { projectId: "p1", toSpaceId: x.w.personal });
  const rows = () => x.w.db.select().from(assets).where(eq(assets.moveId, plan.moveId));
  const sendAll = async (uploadUrl: string, size: number) => { await piece(x.w.fake, uploadUrl, 0, size, size); };
  return { ...x, moveId: plan.moveId, rows, sendAll };
}

const fails = (promise: Promise<unknown>, code: string, status: number, message?: string) =>
  expect(promise).rejects.toMatchObject(message === undefined ? { code, status } : { code, status, message });

describe("copies", () => {
  it("opens one uploading row in the destination with the source's facts", async () => {
    const x = await started();
    const [src] = await x.w.db.select().from(assets).where(eq(assets.id, x.a));
    await x.w.db.update(assets).set({ previewStatus: "ready" }).where(eq(assets.id, x.a));
    const opened = await openCopy(x.deps, "u1", x.moveId, x.a);
    expect(opened).toMatchObject({ offset: 0, done: false });
    expect(opened.uploadUrl).toEqual(expect.any(String));
    const [copy] = await x.rows();
    expect(copy).toMatchObject({
      id: opened.copyAssetId, spaceId: x.w.personal, moveId: x.moveId, copiedFrom: x.a, uploadedBy: "u1", status: "uploading", previewStatus: "pending", uploadUrl: opened.uploadUrl,
      kind: src.kind, name: src.name, fileName: src.fileName, mimeType: src.mimeType, sizeBytes: src.sizeBytes, lastModifiedMs: src.lastModifiedMs,
      durationMs: src.durationMs, width: src.width, height: src.height, fps: src.fps, hasAudio: src.hasAudio, videoCodec: src.videoCodec, event: src.event,
    });
    const drive = (await x.deps.driveFor(x.w.personal))!;
    const file = await drive.getFile(copy.driveFileId!);
    expect(file).toBeNull(); // no file exists until the last byte
    await x.sendAll(opened.uploadUrl!, copy.sizeBytes);
    expect((await drive.getFile(copy.driveFileId!))!.parents).toContain(await drive.folderId("Originals"));
  });

  it("gives a video copy's preview status from the source and none for an image", async () => {
    const x = await started();
    await openCopy(x.deps, "u1", x.moveId, x.a);
    expect((await x.rows())[0].previewStatus).toBe("failed"); // the source's preview is pending
    const x2 = await started();
    await x2.w.db.update(assets).set({ previewStatus: "failed" }).where(eq(assets.id, x2.a));
    await openCopy(x2.deps, "u1", x2.moveId, x2.a);
    await openCopy(x2.deps, "u1", x2.moveId, x2.b);
    const byFrom = new Map((await x2.rows()).map((r) => [r.copiedFrom, r]));
    expect(byFrom.get(x2.a)!.previewStatus).toBe("failed");
    expect(byFrom.get(x2.b)!.previewStatus).toBe("none");
  });

  it("takes up the same copy where it stopped, and reopens an expired session on the same row", async () => {
    const x = await started();
    const first = await openCopy(x.deps, "u1", x.moveId, x.a);
    await piece(x.w.fake, first.uploadUrl!, 0, 262_144, 20_000_000);
    const again = await openCopy(x.deps, "u1", x.moveId, x.a);
    expect(again).toMatchObject({ copyAssetId: first.copyAssetId, uploadUrl: first.uploadUrl, offset: 262_144, done: false });
    x.w.fake.expireSessions();
    const fresh = await openCopy(x.deps, "u1", x.moveId, x.a);
    expect(fresh).toMatchObject({ copyAssetId: first.copyAssetId, offset: 0, done: false });
    expect(fresh.uploadUrl).not.toBe(first.uploadUrl);
    const rows = await x.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].uploadUrl).toBe(fresh.uploadUrl);
  });

  it("gives identical-looking sources their own copies", async () => {
    const x = await started();
    const twin = await insertAsset(x.w.db, { name: "Twin", driveFileId: "orig-twin", previewFileId: "p", posterFileId: "q" });
    const doc = structuredClone(x.doc) as { tracks: { clips: unknown[] }[] };
    doc.tracks[0].clips.push({ id: "c9", ...mediaClip(twin) });
    await x.w.db.update(projects).set({ doc: doc as never }).where(eq(projects.id, "p1"));
    const one = await openCopy(x.deps, "u1", x.moveId, x.a);
    const two = await openCopy(x.deps, "u1", x.moveId, twin);
    expect(one.copyAssetId).not.toBe(two.copyAssetId);
    expect(await x.rows()).toHaveLength(2);
  });

  it("reports a finished original as done", async () => {
    const x = await started();
    const opened = await openCopy(x.deps, "u1", x.moveId, x.a);
    await x.sendAll(opened.uploadUrl!, 20_000_000);
    await completeCopy(x.deps, "u1", x.moveId, opened.copyAssetId);
    expect(await openCopy(x.deps, "u1", x.moveId, x.a)).toMatchObject({ copyAssetId: opened.copyAssetId, uploadUrl: null, done: true });
  });

  it("runs checkNew only for a new copy, and leaves nothing when it throws", async () => {
    const x = await started();
    const checkNew = vi.fn().mockRejectedValueOnce(new Error("nope"));
    await expect(openCopy({ ...x.deps, checkNew }, "u1", x.moveId, x.a)).rejects.toThrow("nope");
    expect(await x.rows()).toHaveLength(0);
    await openCopy({ ...x.deps, checkNew }, "u1", x.moveId, x.a);
    expect(checkNew).toHaveBeenCalledTimes(2);
    await openCopy({ ...x.deps, checkNew }, "u1", x.moveId, x.a);
    expect(checkNew).toHaveBeenCalledTimes(2);
  });

  it("refuses an asset the project does not use", async () => {
    const x = await started();
    const other = await insertAsset(x.w.db, { name: "Other" });
    await fails(openCopy(x.deps, "u1", x.moveId, other), "INVALID", 400);
  });

  it("completes only once every byte is in, and repeats safely", async () => {
    const x = await started();
    const opened = await openCopy(x.deps, "u1", x.moveId, x.b);
    await fails(completeCopy(x.deps, "u1", x.moveId, opened.copyAssetId), "CONFLICT", 409);
    await x.sendAll(opened.uploadUrl!, 20_000_000);
    const state = await completeCopy(x.deps, "u1", x.moveId, opened.copyAssetId);
    expect(state).toEqual({ assetId: opened.copyAssetId, status: "ready", hasPreview: false, hasPoster: false });
    const [row] = await x.rows();
    expect(row.status).toBe("ready");
    expect(row.readyAt).not.toBeNull();
    expect(row.uploadUrl).toBeNull();
    expect(await completeCopy(x.deps, "u1", x.moveId, opened.copyAssetId)).toEqual(state);
  });

  it("copies a video's preview then poster, and refuses a poster for audio", async () => {
    const x = await started();
    await x.w.db.update(assets).set({ previewStatus: "ready" }).where(eq(assets.id, x.a));
    const opened = await openCopy(x.deps, "u1", x.moveId, x.a);
    await x.sendAll(opened.uploadUrl!, 20_000_000);
    await completeCopy(x.deps, "u1", x.moveId, opened.copyAssetId);
    for (const role of ["preview", "poster"] as const) {
      const { uploadUrl } = await openCopyFile(x.deps, "u1", x.moveId, opened.copyAssetId, { role, sizeBytes: 1000 });
      await piece(x.w.fake, uploadUrl, 0, 1000, 1000);
      await completeCopyFile(x.deps, "u1", x.moveId, opened.copyAssetId, role);
    }
    const [row] = await x.rows();
    expect(row).toMatchObject({ previewStatus: "ready" });
    expect(row.previewFileId).not.toBeNull();
    expect(row.posterFileId).not.toBeNull();
    const [source] = await x.w.db.select().from(assets).where(and(eq(assets.id, x.a)));
    expect(source.previewFileId).toBe("prev-a");

    const audio = await insertAsset(x.w.db, { name: "Song", kind: "audio", fileName: "s.mp3", mimeType: "audio/mpeg", driveFileId: "orig-s", width: null, height: null, fps: null, videoCodec: null });
    const doc = structuredClone(x.doc) as { tracks: { clips: unknown[] }[] };
    doc.tracks[0].clips.push({ id: "c8", ...mediaClip(audio) });
    await x.w.db.update(projects).set({ doc: doc as never }).where(eq(projects.id, "p1"));
    const song = await openCopy(x.deps, "u1", x.moveId, audio);
    await x.sendAll(song.uploadUrl!, 20_000_000);
    await completeCopy(x.deps, "u1", x.moveId, song.copyAssetId);
    await fails(openCopyFile(x.deps, "u1", x.moveId, song.copyAssetId, { role: "poster", sizeBytes: 1000 }), "INVALID", 400);
  });

  it("answers an abandoned move as gone", async () => {
    const x = await started();
    const opened = await openCopy(x.deps, "u1", x.moveId, x.a);
    await abandonMove(x.deps, "u1", x.moveId);
    const gone = MOVE_MESSAGES.gone;
    await fails(openCopy(x.deps, "u1", x.moveId, x.a), "NOT_FOUND", 404, gone);
    await fails(completeCopy(x.deps, "u1", x.moveId, opened.copyAssetId), "NOT_FOUND", 404, gone);
    await fails(openCopyFile(x.deps, "u1", x.moveId, opened.copyAssetId, { role: "poster", sizeBytes: 10 }), "NOT_FOUND", 404, gone);
    await fails(completeCopyFile(x.deps, "u1", x.moveId, opened.copyAssetId, "poster"), "NOT_FOUND", 404, gone);
  });
});
