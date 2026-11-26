import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { assets } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { createMediaApi } from "@/lib/media/api";
import { createLocalFolder } from "@/lib/media/local-folder";
import { addLocalAsset, isLocalAsset, listAssets, removeAsset, setLocalFile } from "@/lib/media/service";
import type { AssetView, UploadItem } from "@/lib/media/types";
import { createUploadQueue, type UploadQueue } from "@/lib/media/upload-queue";
import { joinSpace } from "../helpers/actor";
import { fakeFolder, type FakeFolder } from "../helpers/fake-folder";
import { AUDIO, IMAGE, VIDEO, handlersFetch, mediaContext, readyAsset, type MediaContext } from "./context";

// A team with no storage at all: nobody has connected a Drive.
async function bareTeam(ctx: MediaContext): Promise<{ spaceId: string; ada: Actor; grace: Actor }> {
  const spaceId = "team_bare";
  await ctx.db.execute(sql`insert into organization (id, name, slug, created_at, kind) values (${spaceId}, 'Bare', 'bare', now(), 'team')`);
  await joinSpace(ctx.db, { id: ctx.ada.userId, email: ctx.ada.email }, "admin", spaceId);
  await joinSpace(ctx.db, { id: ctx.grace.userId, email: ctx.grace.email }, "editor", spaceId);
  return { spaceId, ada: { ...ctx.ada, spaceId, role: "admin" }, grace: { ...ctx.grace, spaceId, role: "editor" } };
}
const driveCalls = (ctx: MediaContext) => ctx.fake.sessions.size;

describe("a file kept on a member's computer, on the server", () => {
  it("is a library entry like any other, ready at once, with no file in Drive", async () => {
    const ctx = await mediaContext();
    const asset = await addLocalAsset({ db: ctx.db }, ctx.ada, { ...VIDEO, event: " Qualifier " });
    expect(asset).toMatchObject({ kind: "video", name: "IMG_4821", fileName: "IMG_4821.MOV", status: "ready", removed: false, durationMs: 12_500, width: 1080, height: 1920, hasAudio: true, event: "Qualifier" });
    expect(asset.originalFileId).toBe(`local:${asset.id}`);
    expect([asset.previewStatus, asset.previewFileId, asset.posterFileId]).toEqual(["pending", null, null]);
    expect(driveCalls(ctx)).toBe(0);
    const [row] = await ctx.db.select().from(assets).where(eq(assets.id, asset.id));
    expect([row.driveFileId, row.uploadUrl, row.readyAt !== null]).toEqual([null, null, true]);
    // A teammate sees it in the library.
    expect((await listAssets(ctx.db, ctx.grace)).map((a) => a.id)).toEqual([asset.id]);
    expect(await isLocalAsset(ctx.db, ctx.ada, asset.id)).toBe(true);
  });
  it("keeps an image and a sound with what was read from them, and no preview to wait for", async () => {
    const ctx = await mediaContext();
    expect(await addLocalAsset({ db: ctx.db }, ctx.ada, IMAGE)).toMatchObject({ kind: "image", durationMs: null, width: 4032, previewStatus: "none" });
    expect(await addLocalAsset({ db: ctx.db }, ctx.ada, AUDIO)).toMatchObject({ kind: "audio", durationMs: 95_000, width: null, previewStatus: "none" });
  });
  it("is checked like an upload: an editor's, of a kind and size the library takes, within the day's count", async () => {
    const ctx = await mediaContext();
    await expect(addLocalAsset({ db: ctx.db }, ctx.vera, VIDEO)).rejects.toMatchObject({ status: 403 });
    await expect(addLocalAsset({ db: ctx.db }, ctx.ada, { ...VIDEO, fileName: "notes.txt" })).rejects.toMatchObject({ status: 400 });
    await expect(addLocalAsset({ db: ctx.db }, ctx.ada, { ...VIDEO, probe: { ...VIDEO.probe, durationMs: null } })).rejects.toMatchObject({ status: 400 });
    const refuse = async () => {
      throw new Error("over the day's count");
    };
    await expect(addLocalAsset({ db: ctx.db, checkNew: refuse }, ctx.ada, VIDEO)).rejects.toThrow("over the day's count");
    expect(await ctx.db.$count(assets)).toBe(0);
  });
  it("notes the copies the browser made, and only for a file that is kept on a computer", async () => {
    const ctx = await mediaContext();
    const asset = await addLocalAsset({ db: ctx.db }, ctx.ada, VIDEO);
    expect(await setLocalFile(ctx.db, ctx.ada, asset.id, "preview")).toMatchObject({ previewStatus: "ready", previewFileId: `local:${asset.id}:preview`, posterFileId: null });
    expect(await setLocalFile(ctx.db, ctx.ada, asset.id, "poster")).toMatchObject({ posterFileId: `local:${asset.id}:poster` });
    // Another editor who did not add it cannot, an admin can.
    await expect(setLocalFile(ctx.db, ctx.grace, asset.id, "poster")).rejects.toMatchObject({ status: 403 });
    const song = await addLocalAsset({ db: ctx.db }, ctx.ada, AUDIO);
    await expect(setLocalFile(ctx.db, ctx.ada, song.id, "preview")).rejects.toMatchObject({ status: 400 });
    const inDrive = await readyAsset(ctx);
    await expect(setLocalFile(ctx.db, ctx.ada, inDrive.id, "poster")).rejects.toMatchObject({ status: 400, message: "That file is kept in Google Drive, not on a computer." });
    expect(await isLocalAsset(ctx.db, ctx.ada, inDrive.id)).toBe(false);
    expect(await isLocalAsset(ctx.db, ctx.ada, "nope")).toBe(false);
  });
  it("is removed without a word to Drive, its copies' ids included", async () => {
    const ctx = await mediaContext();
    const asset = await addLocalAsset({ db: ctx.db }, ctx.ada, VIDEO);
    await setLocalFile(ctx.db, ctx.ada, asset.id, "preview");
    await setLocalFile(ctx.db, ctx.ada, asset.id, "poster");
    const trashed: string[] = [];
    const drive = new Proxy(ctx.deps.drive, { get: (target, key) => (key === "trashFile" ? async (id: string) => void trashed.push(id) : Reflect.get(target, key)) });
    await removeAsset({ ...ctx.deps, drive }, ctx.ada, asset.id);
    expect(trashed).toEqual([]);
    expect(await listAssets(ctx.db, ctx.ada)).toEqual([]);
  });
});

describe("the routes, in a space with no storage", () => {
  it("add, note, list and remove a file kept on a computer, where an upload to Drive is refused", async () => {
    const ctx = await mediaContext();
    const team = await bareTeam(ctx);
    const api = createMediaApi(team.spaceId, handlersFetch(ctx, team.ada));
    expect(await api.open(VIDEO)).toMatchObject({ ok: false, kind: "not-set-up" });
    const added = await api.addLocal(VIDEO);
    if (!added.ok) throw new Error(added.message);
    expect(added.asset).toMatchObject({ status: "ready", originalFileId: `local:${added.asset.id}` });
    expect(await api.localFile(added.asset.id, "poster")).toMatchObject({ ok: true, asset: { posterFileId: `local:${added.asset.id}:poster` } });
    expect(await api.list()).toMatchObject({ ok: true, setUp: false, assets: [{ id: added.asset.id }] });
    // The other member's browser sees it too.
    expect(await createMediaApi(team.spaceId, handlersFetch(ctx, team.grace)).list()).toMatchObject({ ok: true, assets: [{ id: added.asset.id }] });
    expect(await api.remove(added.asset.id)).toEqual({ ok: true });
    expect(await api.list()).toMatchObject({ ok: true, assets: [] });
    expect(driveCalls(ctx)).toBe(0);
  });
  it("refuse a viewer, a member of another space and a body that is not a file's", async () => {
    const ctx = await mediaContext();
    const team = await bareTeam(ctx);
    expect(await createMediaApi(team.spaceId, handlersFetch(ctx, ctx.vera)).addLocal(VIDEO)).toMatchObject({ ok: false });
    expect(await createMediaApi("team_nowhere", handlersFetch(ctx, team.ada)).addLocal(VIDEO)).toMatchObject({ ok: false });
    expect(await createMediaApi(team.spaceId, handlersFetch(ctx, team.ada)).addLocal({ ...VIDEO, extra: 1 } as never)).toMatchObject({ ok: false, kind: "refused" });
  });
});

// The queue with a media folder open: files stay on this computer.
async function harness(opts: { folder?: FakeFolder; open?: boolean } = {}) {
  const ctx = await mediaContext();
  const picked = opts.folder ?? fakeFolder();
  const folder = createLocalFolder({ load: async () => null, save: async () => {} });
  if (opts.open !== false) await folder.choose(async () => picked);
  const api = createMediaApi(ctx.ada.spaceId, handlersFetch(ctx, ctx.ada));
  const seen: AssetView[] = [];
  const changes: UploadItem[][] = [];
  const sent: unknown[] = [];
  const queue: UploadQueue = createUploadQueue({
    api,
    ingest: {
      probe: async (_file, fileName) => (/\.mp3$/.test(fileName) ? AUDIO.probe : /\.jpg$/.test(fileName) ? IMAGE.probe : VIDEO.probe),
      derive: async (_file, probe) => ({ preview: probe.kind === "video" ? new Blob(["preview"]) : null, poster: new Blob(["poster"]), previewProblem: null }),
      dispose() {},
    },
    transport: { sendPiece: async (input) => (sent.push(input), { state: "done" as const }) },
    sleep: async () => {},
    onChange: (items) => void changes.push(items),
    onAsset: (asset) => void seen.push(asset),
    onPreviewFile: () => {},
    event: () => undefined,
    local: () => (folder.state() === "ready" ? folder : null),
  });
  const settle = async () => {
    for (let turn = 0; turn < 4000 && queue.active() > 0; turn++) await new Promise((r) => setTimeout(r, 1));
  };
  const stages = () => changes.flatMap((items) => items.slice(0, 1).map((i) => i.stage)).filter((stage, i, all) => stage !== all[i - 1]);
  return { ctx, picked, folder, queue, seen, sent, settle, stages, api };
}
const file = (name: string, size = 1000, type = "video/quicktime") => new File([new Uint8Array(size)], name, { type, lastModified: 1_762_800_000_000 });

describe("adding a file with a media folder open", () => {
  it("copies it into the folder with the copies made from it, lists it, and sends nothing to Drive", async () => {
    const { ctx, picked, queue, seen, sent, settle, stages } = await harness();
    queue.add([file("IMG_4821.MOV")]);
    await settle();
    expect(stages()).toEqual(["waiting", "reading", "uploading", "preview", "done"]);
    const [asset] = await listAssets(ctx.db, ctx.ada);
    expect(asset).toMatchObject({ status: "ready", originalFileId: `local:${asset.id}`, previewStatus: "ready", previewFileId: `local:${asset.id}:preview`, posterFileId: `local:${asset.id}:poster` });
    expect(picked.names()).toEqual([`.easyedit/${asset.id}.poster.jpg`, `.easyedit/${asset.id}.preview.mp4`, `IMG_4821 [${asset.id}].MOV`]);
    expect(picked.files.get(`IMG_4821 [${asset.id}].MOV`)!.size).toBe(1000);
    expect(seen.at(-1)).toMatchObject({ id: asset.id, posterFileId: `local:${asset.id}:poster` });
    expect([sent.length, driveCalls(ctx)]).toEqual([0, 0]);
    expect(queue.items()[0]).toMatchObject({ stage: "done", sentBytes: 1000, message: null });
  });
  it("a sound has no copies to make, and an image gets its still picture", async () => {
    const { ctx, picked, queue, settle } = await harness();
    queue.add([file("theme.mp3", 500, "audio/mpeg"), file("field.jpg", 700, "image/jpeg")]);
    await settle();
    const listed = await listAssets(ctx.db, ctx.ada);
    const song = listed.find((a) => a.kind === "audio")!;
    const photo = listed.find((a) => a.kind === "image")!;
    expect(picked.names()).toEqual([`.easyedit/${photo.id}.poster.jpg`, `field [${photo.id}].jpg`, `theme [${song.id}].mp3`]);
    expect([song.previewStatus, photo.posterFileId]).toEqual(["none", `local:${photo.id}:poster`]);
  });
  it("a file the folder will not take leaves no entry behind, and says why", async () => {
    const picked = fakeFolder();
    picked.failWrites = true;
    const { ctx, queue, settle } = await harness({ folder: picked });
    queue.add([file("IMG_4821.MOV")]);
    await settle();
    expect(queue.items()[0]).toMatchObject({ stage: "failed", canRetry: false, assetId: null, message: "The file couldn't be saved to your media folder. Check that the folder is still there and has room, then try again." });
    expect(await listAssets(ctx.db, ctx.ada)).toEqual([]);
    expect(picked.names()).toEqual([]);
  });
  it("with no folder open goes to Drive as before", async () => {
    const { ctx, picked, queue, sent, settle } = await harness({ open: false });
    queue.add([file("IMG_4821.MOV")]);
    await settle();
    expect(sent.length).toBeGreaterThan(0);
    expect(picked.names()).toEqual([]);
    expect(driveCalls(ctx)).toBeGreaterThan(0);
  });
});
