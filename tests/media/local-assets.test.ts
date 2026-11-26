import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { assets } from "@/db/schema";
import type { Actor } from "@/lib/actor";
import { createMediaApi } from "@/lib/media/api";
import { createLocalFolder } from "@/lib/media/local-folder";
import { addLocalAsset, isLocalAsset, listAssets, removeAsset, setLocalFile } from "@/lib/media/service";
import type { AssetView, UploadItem } from "@/lib/media/types";
import { createUploadQueue, type UploadQueue } from "@/lib/media/upload-queue";
import { personalSpaceId } from "@/lib/spaces/types";
import { joinSpace } from "../helpers/actor";
import { fakeFolder, type FakeFolder } from "../helpers/fake-folder";
import { AUDIO, IMAGE, VIDEO, handlersFetch, insertAsset, mediaContext, personalWithStorage, readyAsset, type MediaContext } from "./context";

// A team with no storage at all: nobody has connected a Drive. A file is never kept on a computer for it.
async function bareTeam(ctx: MediaContext): Promise<{ spaceId: string; ada: Actor; grace: Actor }> {
  const spaceId = "team_bare";
  await ctx.db.execute(sql`insert into organization (id, name, slug, created_at, kind) values (${spaceId}, 'Bare', 'bare', now(), 'team')`);
  await joinSpace(ctx.db, { id: ctx.ada.userId, email: ctx.ada.email }, "admin", spaceId);
  await joinSpace(ctx.db, { id: ctx.grace.userId, email: ctx.grace.email }, "editor", spaceId);
  return { spaceId, ada: { ...ctx.ada, spaceId, role: "admin" }, grace: { ...ctx.grace, spaceId, role: "editor" } };
}
const driveCalls = (ctx: MediaContext) => ctx.fake.sessions.size;

// Ada's Personal space, the only kind of space where a file may be kept on a computer. No Drive is connected to it.
async function personal(ctx: MediaContext): Promise<Actor> {
  const me: Actor = { ...ctx.ada, role: "admin", spaceId: personalSpaceId(ctx.ada.userId) };
  await joinSpace(ctx.db, { id: ctx.ada.userId, email: ctx.ada.email }, "admin", me.spaceId);
  return me;
}
// An entry a team kept on a computer while teams still could: ready, with no file in Drive.
const keptByTeam = (ctx: MediaContext, spaceId: string) => insertAsset(ctx.db, { spaceId, driveFileId: null, uploadedBy: ctx.ada.userId });
const PERSONAL_ONLY = "Media can be kept in a folder on a computer only in your Personal space. In a team, upload it to Google Drive.";

describe("a file kept on a member's computer, on the server", () => {
  it("is a library entry like any other, ready at once, with no file in Drive", async () => {
    const ctx = await mediaContext();
    const me = await personal(ctx);
    const asset = await addLocalAsset({ db: ctx.db }, me, { ...VIDEO, event: " Qualifier " });
    expect(asset).toMatchObject({ kind: "video", name: "IMG_4821", fileName: "IMG_4821.MOV", status: "ready", removed: false, durationMs: 12_500, width: 1080, height: 1920, hasAudio: true, event: "Qualifier" });
    expect(asset.originalFileId).toBe(`local:${asset.id}`);
    expect([asset.previewStatus, asset.previewFileId, asset.posterFileId]).toEqual(["pending", null, null]);
    expect(driveCalls(ctx)).toBe(0);
    const [row] = await ctx.db.select().from(assets).where(eq(assets.id, asset.id));
    expect([row.driveFileId, row.uploadUrl, row.readyAt !== null]).toEqual([null, null, true]);
    expect((await listAssets(ctx.db, me)).map((a) => a.id)).toEqual([asset.id]);
    expect(await isLocalAsset(ctx.db, me, asset.id)).toBe(true);
  });
  it("is kept only in a Personal space: in a team it is refused, whoever asks, and the answer says where it goes", async () => {
    const ctx = await mediaContext();
    const team = await bareTeam(ctx);
    for (const member of [ctx.ada, ctx.root, team.ada, team.grace]) {
      await expect(addLocalAsset({ db: ctx.db }, member, VIDEO)).rejects.toMatchObject({ status: 409, message: PERSONAL_ONLY });
    }
    // Refused before the day's count is asked: it is not an upload that was tried.
    const counted = vi.fn(async () => {});
    await expect(addLocalAsset({ db: ctx.db, checkNew: counted }, ctx.ada, VIDEO)).rejects.toMatchObject({ status: 409 });
    expect(counted).not.toHaveBeenCalled();
    expect(await ctx.db.$count(assets)).toBe(0);
  });
  it("keeps an image and a sound with what was read from them, and no preview to wait for", async () => {
    const ctx = await mediaContext();
    const me = await personal(ctx);
    expect(await addLocalAsset({ db: ctx.db }, me, IMAGE)).toMatchObject({ kind: "image", durationMs: null, width: 4032, previewStatus: "none" });
    expect(await addLocalAsset({ db: ctx.db }, me, AUDIO)).toMatchObject({ kind: "audio", durationMs: 95_000, width: null, previewStatus: "none" });
  });
  it("is checked like an upload: an editor's, of a kind and size the library takes, within the day's count", async () => {
    const ctx = await mediaContext();
    const me = await personal(ctx);
    await expect(addLocalAsset({ db: ctx.db }, { ...me, role: "viewer" }, VIDEO)).rejects.toMatchObject({ status: 403 });
    await expect(addLocalAsset({ db: ctx.db }, me, { ...VIDEO, fileName: "notes.txt" })).rejects.toMatchObject({ status: 400 });
    await expect(addLocalAsset({ db: ctx.db }, me, { ...VIDEO, probe: { ...VIDEO.probe, durationMs: null } })).rejects.toMatchObject({ status: 400 });
    const refuse = async () => {
      throw new Error("over the day's count");
    };
    await expect(addLocalAsset({ db: ctx.db, checkNew: refuse }, me, VIDEO)).rejects.toThrow("over the day's count");
    expect(await ctx.db.$count(assets)).toBe(0);
  });
  it("notes the copies the browser made, and only for a file that is kept on a computer", async () => {
    const ctx = await mediaContext();
    const me = await personal(ctx);
    const asset = await addLocalAsset({ db: ctx.db }, me, VIDEO);
    expect(await setLocalFile(ctx.db, me, asset.id, "preview")).toMatchObject({ previewStatus: "ready", previewFileId: `local:${asset.id}:preview`, posterFileId: null });
    expect(await setLocalFile(ctx.db, me, asset.id, "poster")).toMatchObject({ posterFileId: `local:${asset.id}:poster` });
    const song = await addLocalAsset({ db: ctx.db }, me, AUDIO);
    await expect(setLocalFile(ctx.db, me, song.id, "preview")).rejects.toMatchObject({ status: 400 });
    // An entry a team kept on a computer before teams were stopped: an editor who did not add it cannot, who added it can.
    const old = await keptByTeam(ctx, ctx.ada.spaceId);
    await expect(setLocalFile(ctx.db, ctx.grace, old, "poster")).rejects.toMatchObject({ status: 403 });
    expect(await setLocalFile(ctx.db, ctx.ada, old, "poster")).toMatchObject({ posterFileId: `local:${old}:poster` });
    const inDrive = await readyAsset(ctx);
    await expect(setLocalFile(ctx.db, ctx.ada, inDrive.id, "poster")).rejects.toMatchObject({ status: 400, message: "That file is kept in Google Drive, not on a computer." });
    expect(await isLocalAsset(ctx.db, ctx.ada, inDrive.id)).toBe(false);
    expect(await isLocalAsset(ctx.db, ctx.ada, "nope")).toBe(false);
  });
  it("is removed without a word to Drive, its copies' ids included", async () => {
    const ctx = await mediaContext();
    const me = await personal(ctx);
    const asset = await addLocalAsset({ db: ctx.db }, me, VIDEO);
    await setLocalFile(ctx.db, me, asset.id, "preview");
    await setLocalFile(ctx.db, me, asset.id, "poster");
    const trashed: string[] = [];
    const drive = new Proxy(ctx.deps.drive, { get: (target, key) => (key === "trashFile" ? async (id: string) => void trashed.push(id) : Reflect.get(target, key)) });
    await removeAsset({ ...ctx.deps, drive }, me, asset.id);
    expect(trashed).toEqual([]);
    expect(await listAssets(ctx.db, me)).toEqual([]);
  });
});

describe("the routes, in a Personal space with no storage", () => {
  it("add, note, list and remove a file kept on a computer, where an upload to Drive is refused", async () => {
    const ctx = await mediaContext();
    const me = await personal(ctx);
    const api = createMediaApi(me.spaceId, handlersFetch(ctx, me));
    expect(await api.open(VIDEO)).toMatchObject({ ok: false, kind: "not-set-up" });
    const added = await api.addLocal(VIDEO);
    if (!added.ok) throw new Error(added.message);
    expect(added.asset).toMatchObject({ status: "ready", originalFileId: `local:${added.asset.id}` });
    expect(await api.localFile(added.asset.id, "poster")).toMatchObject({ ok: true, asset: { posterFileId: `local:${added.asset.id}:poster` } });
    expect(await api.list()).toMatchObject({ ok: true, setUp: false, assets: [{ id: added.asset.id }] });
    expect(await api.remove(added.asset.id)).toEqual({ ok: true });
    expect(await api.list()).toMatchObject({ ok: true, assets: [] });
    expect(driveCalls(ctx)).toBe(0);
  });
  it("refuse someone who is not the space's person, a space that is not there and a body that is not a file's", async () => {
    const ctx = await mediaContext();
    const me = await personal(ctx);
    expect(await createMediaApi(me.spaceId, handlersFetch(ctx, ctx.vera)).addLocal(VIDEO)).toMatchObject({ ok: false });
    expect(await createMediaApi("team_nowhere", handlersFetch(ctx, me)).addLocal(VIDEO)).toMatchObject({ ok: false });
    expect(await createMediaApi(me.spaceId, handlersFetch(ctx, me)).addLocal({ ...VIDEO, extra: 1 } as never)).toMatchObject({ ok: false, kind: "refused" });
  });
});

describe("the routes, in a team", () => {
  it("refuse a new file kept on a computer, with or without storage, in words the upload list can show", async () => {
    const ctx = await mediaContext();
    const team = await bareTeam(ctx);
    for (const [spaceId, member] of [[team.spaceId, team.ada], [team.spaceId, team.grace], [ctx.ada.spaceId, ctx.ada]] as const) {
      expect(await createMediaApi(spaceId, handlersFetch(ctx, member)).addLocal(VIDEO)).toEqual({ ok: false, kind: "refused", message: PERSONAL_ONLY });
    }
    expect(await ctx.db.$count(assets)).toBe(0);
  });
  it("still list, and remove without a word to Drive, an entry that was kept on a computer before", async () => {
    const ctx = await mediaContext();
    const team = await bareTeam(ctx);
    const old = await keptByTeam(ctx, team.spaceId);
    const api = createMediaApi(team.spaceId, handlersFetch(ctx, team.ada));
    expect(await api.list()).toMatchObject({ ok: true, assets: [{ id: old, originalFileId: `local:${old}` }] });
    // The other member's browser sees it too.
    expect(await createMediaApi(team.spaceId, handlersFetch(ctx, team.grace)).list()).toMatchObject({ ok: true, assets: [{ id: old }] });
    expect(await api.remove(old)).toEqual({ ok: true });
    expect(await api.list()).toMatchObject({ ok: true, assets: [] });
    expect(driveCalls(ctx)).toBe(0);
  });
});

// The queue with a media folder open: files stay on this computer.
async function harness(opts: { folder?: FakeFolder; open?: boolean; team?: boolean } = {}) {
  const ctx = await mediaContext();
  // Ada's Personal space with a Drive of its own; or, to see a team refused, Seattle Solvers.
  const me = opts.team ? ctx.ada : (await personalWithStorage(ctx)).actor;
  const picked = opts.folder ?? fakeFolder();
  const folder = createLocalFolder({ load: async () => null, save: async () => {} });
  if (opts.open !== false) await folder.choose(async () => picked);
  const api = createMediaApi(me.spaceId, handlersFetch(ctx, me));
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
  return { ctx, me, picked, folder, queue, seen, sent, settle, stages, api };
}
const file = (name: string, size = 1000, type = "video/quicktime") => new File([new Uint8Array(size)], name, { type, lastModified: 1_762_800_000_000 });

describe("adding a file with a media folder open", () => {
  it("copies it into the folder with the copies made from it, lists it, and sends nothing to Drive", async () => {
    const { ctx, me, picked, queue, seen, sent, settle, stages } = await harness();
    queue.add([file("IMG_4821.MOV")]);
    await settle();
    expect(stages()).toEqual(["waiting", "reading", "uploading", "preview", "done"]);
    const [asset] = await listAssets(ctx.db, me);
    expect(asset).toMatchObject({ status: "ready", originalFileId: `local:${asset.id}`, previewStatus: "ready", previewFileId: `local:${asset.id}:preview`, posterFileId: `local:${asset.id}:poster` });
    expect(picked.names()).toEqual([`.easyedit/${asset.id}.poster.jpg`, `.easyedit/${asset.id}.preview.mp4`, `IMG_4821 [${asset.id}].MOV`]);
    expect(picked.files.get(`IMG_4821 [${asset.id}].MOV`)!.size).toBe(1000);
    expect(seen.at(-1)).toMatchObject({ id: asset.id, posterFileId: `local:${asset.id}:poster` });
    expect([sent.length, driveCalls(ctx)]).toEqual([0, 0]);
    expect(queue.items()[0]).toMatchObject({ stage: "done", sentBytes: 1000, message: null });
  });
  it("a sound has no copies to make, and an image gets its still picture", async () => {
    const { ctx, me, picked, queue, settle } = await harness();
    queue.add([file("theme.mp3", 500, "audio/mpeg"), file("field.jpg", 700, "image/jpeg")]);
    await settle();
    const listed = await listAssets(ctx.db, me);
    const song = listed.find((a) => a.kind === "audio")!;
    const photo = listed.find((a) => a.kind === "image")!;
    expect(picked.names()).toEqual([`.easyedit/${photo.id}.poster.jpg`, `field [${photo.id}].jpg`, `theme [${song.id}].mp3`]);
    expect([song.previewStatus, photo.posterFileId]).toEqual(["none", `local:${photo.id}:poster`]);
  });
  it("a file the folder will not take leaves no entry behind, and says why", async () => {
    const picked = fakeFolder();
    picked.failWrites = true;
    const { ctx, me, queue, settle } = await harness({ folder: picked });
    queue.add([file("IMG_4821.MOV")]);
    await settle();
    expect(queue.items()[0]).toMatchObject({ stage: "failed", canRetry: false, assetId: null, message: "The file couldn't be saved to your media folder. Check that the folder is still there and has room, then try again." });
    expect(await listAssets(ctx.db, me)).toEqual([]);
    expect(picked.names()).toEqual([]);
  });
  it("in a team, a folder that is somehow open takes nothing: the file stops with the reason and nothing is written", async () => {
    // A tab left open from before teams were stopped, with its folder still open.
    const { ctx, me, picked, queue, sent, settle } = await harness({ team: true });
    queue.add([file("IMG_4821.MOV")]);
    await settle();
    expect(queue.items()[0]).toMatchObject({ stage: "failed", canRetry: false, assetId: null, message: PERSONAL_ONLY });
    expect(await listAssets(ctx.db, me)).toEqual([]);
    expect(picked.names()).toEqual([]);
    expect([sent.length, driveCalls(ctx)]).toEqual([0, 0]);
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
