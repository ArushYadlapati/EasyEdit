import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assets, projectMove, projects } from "@/db/schema";
import { abandonMove, completeCopy, completeCopyFile, openCopy, openCopyFile, startMove, type MoveDeps } from "@/lib/projects/move";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { piece } from "../helpers/fake-drive";
import { insertAsset, mediaClip } from "../media/context";
import { moveWorld } from "./move-world";

afterEach(() => vi.restoreAllMocks());

const world = moveWorld;

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

  it("keeps the session address out of the error when the copy cannot be written", async () => {
    const x = await started();
    await x.w.db.execute(sql`alter table assets add constraint refuses_new_rows check (upload_url is null)`);
    const failure: unknown = await openCopy(x.deps, "u1", x.moveId, x.a).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ name: "Error", message: "The upload could not be recorded (database error 23514)." });
    expect(Object.getOwnPropertyNames(failure).sort()).toEqual(["message", "stack"]);
    expect(JSON.stringify([(failure as Error).message, (failure as Error).stack])).not.toContain("upload_id");
    expect(await x.rows()).toHaveLength(0);
  });

  it("leaves no copy and cancels the session when the move ends during the open", async () => {
    const x = await started();
    const drive = (await x.deps.driveFor(x.w.personal))!;
    const deps: MoveDeps = { ...x.deps, driveFor: async () => ({ ...drive, openUploadSession: async (...args: Parameters<typeof drive.openUploadSession>) => {
      const url = await drive.openUploadSession(...args);
      await x.w.db.update(projectMove).set({ abandonedAt: new Date() }).where(eq(projectMove.id, x.moveId));
      return url;
    } }) as never };
    await fails(openCopy(deps, "u1", x.moveId, x.a), "NOT_FOUND", 404, MOVE_MESSAGES.gone);
    expect(await x.rows()).toHaveLength(0);
  });

  it("answers a simultaneous open of one source with a single copy", async () => {
    const x = await started();
    const [one, two] = await Promise.all([openCopy(x.deps, "u1", x.moveId, x.a), openCopy(x.deps, "u1", x.moveId, x.a)]);
    expect(one.copyAssetId).toBe(two.copyAssetId);
    expect(await x.rows()).toHaveLength(1);
  });

  it("answers a finished move as gone", async () => {
    const x = await started();
    const opened = await openCopy(x.deps, "u1", x.moveId, x.a);
    await x.w.db.update(projectMove).set({ finishedAt: new Date() }).where(eq(projectMove.id, x.moveId));
    const gone = MOVE_MESSAGES.gone;
    await fails(openCopy(x.deps, "u1", x.moveId, x.a), "NOT_FOUND", 404, gone);
    await fails(completeCopy(x.deps, "u1", x.moveId, opened.copyAssetId), "NOT_FOUND", 404, gone);
    await fails(openCopyFile(x.deps, "u1", x.moveId, opened.copyAssetId, { role: "poster", sizeBytes: 10 }), "NOT_FOUND", 404, gone);
    await fails(completeCopyFile(x.deps, "u1", x.moveId, opened.copyAssetId, "poster"), "NOT_FOUND", 404, gone);
  });

  it("trashes only the copy's own earlier preview when a preview is sent again, never the source's", async () => {
    const x = await started();
    await x.w.db.update(assets).set({ previewStatus: "ready" }).where(eq(assets.id, x.a));
    const opened = await openCopy(x.deps, "u1", x.moveId, x.a);
    await x.sendAll(opened.uploadUrl!, 20_000_000);
    await completeCopy(x.deps, "u1", x.moveId, opened.copyAssetId);
    const send = async () => {
      const { uploadUrl } = await openCopyFile(x.deps, "u1", x.moveId, opened.copyAssetId, { role: "preview", sizeBytes: 1000 });
      await piece(x.w.fake, uploadUrl, 0, 1000, 1000);
      await completeCopyFile(x.deps, "u1", x.moveId, opened.copyAssetId, "preview");
    };
    await send();
    const [first] = await x.rows();
    const drive = (await x.deps.driveFor(x.w.personal))!;
    const trash = vi.spyOn(drive, "trashFile");
    const deps: MoveDeps = { ...x.deps, driveFor: async () => drive };
    const again = async () => {
      const { uploadUrl } = await openCopyFile(deps, "u1", x.moveId, opened.copyAssetId, { role: "preview", sizeBytes: 1000 });
      await piece(x.w.fake, uploadUrl, 0, 1000, 1000);
      await completeCopyFile(deps, "u1", x.moveId, opened.copyAssetId, "preview");
    };
    await again();
    expect(trash.mock.calls.map((c) => c[0])).toEqual([first.previewFileId]);
    expect(trash).not.toHaveBeenCalledWith("prev-a");
    const [source] = await x.w.db.select().from(assets).where(eq(assets.id, x.a));
    expect(source.previewFileId).toBe("prev-a");
  });
});
