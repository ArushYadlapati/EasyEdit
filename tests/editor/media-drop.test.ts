import { describe, expect, it, vi } from "vitest";
import {
  ASSET_DRAG_TYPE, carriesFiles, createMediaDrop, dragKind, dropTrack, endToEnd, uploadFrames,
} from "@/lib/editor/media-drop";
import { MESSAGES } from "@/lib/editor/messages";
import { createLibraryStore } from "@/lib/media/library-store";
import type { MediaApi } from "@/lib/media/api";
import type { AssetView, UploadItem } from "@/lib/media/types";
import { LIMITS } from "@/lib/limits";
import type { Track } from "@/lib/timeline";
import { assetView } from "../helpers/media-services";
import { entry, makeStore, noticesOf, sampleDoc, video } from "./fixtures";

const never = <T,>() => new Promise<T>(() => {});
const api: MediaApi = {
  list: never, open: never, offset: never, complete: never, openFile: never, completeFile: never, previewFailed: never,
  update: never, remove: never, readToken: never,
};

function setup(canEdit = true) {
  const store = makeStore({ canEdit });
  const drop = createMediaDrop({ store, library: createLibraryStore({ api }), queue: { add: () => [] } });
  return { store, drop };
}

it("dragKind tells files, this page's library items and other tabs' apart", () => {
  expect(dragKind(["Files"], false)).toBe("files");
  expect(dragKind([ASSET_DRAG_TYPE], true)).toBe("asset");
  expect(dragKind([ASSET_DRAG_TYPE], false)).toBe("foreign-asset");
  expect(dragKind(["text/plain"], false)).toBe(null);
  expect(ASSET_DRAG_TYPE).toBe("application/x-easyedit-asset");
});

it("carriesFiles is true only for a drag with files", () => {
  expect(carriesFiles(["Files"])).toBe(true);
  expect(carriesFiles(["text/plain", "Files"])).toBe(true);
  expect(carriesFiles(["text/plain"])).toBe(false);
  expect(carriesFiles([])).toBe(false);
});

it("starts with nothing incoming, and sets the state only when it changes", () => {
  const { drop } = setup();
  expect(drop.state.getState()).toEqual({ incoming: null, asset: null, groups: [] });
  let changes = 0;
  drop.state.subscribe(() => changes++);
  drop.setIncoming("files");
  drop.setIncoming("files");
  expect(drop.state.getState().incoming).toBe("files");
  drop.setIncoming(null);
  drop.endAssetDrag(); // nothing to end
  expect(changes).toBe(2);
});

it("a library item's drag is kept until it ends", () => {
  const { drop } = setup();
  const asset = assetView();
  drop.startAssetDrag(asset);
  expect(drop.state.getState().asset).toBe(asset);
  drop.setIncoming("asset");
  drop.setIncoming(null);
  expect(drop.state.getState().asset).toBe(asset);
  drop.endAssetDrag();
  expect(drop.state.getState().asset).toBe(null);
});

it("once started, losing edit access or the project clears what is dragged in", () => {
  const { store, drop } = setup();
  const stop = drop.start();
  drop.startAssetDrag(assetView());
  drop.setIncoming("asset");
  store.getState().revokeEditing();
  expect(drop.state.getState()).toEqual({ incoming: null, asset: null, groups: [] });

  const other = setup();
  const stopOther = other.drop.start();
  other.drop.setIncoming("files");
  other.store.getState().setStatus("deleted");
  expect(other.drop.state.getState().incoming).toBe(null);
  stop();
  stopOther();
});

it("stopping ends the watch of the editor", () => {
  const { store, drop } = setup();
  const stop = drop.start();
  stop();
  drop.setIncoming("files");
  store.getState().revokeEditing();
  expect(drop.state.getState().incoming).toBe("files");
});

it("dropTrack keeps a clip on the dropped row only when the row takes it", () => {
  const doc = sampleDoc();
  expect(dropTrack(doc, "v1", "video")).toBe("v1");
  expect(dropTrack(doc, "t1", "video")).toBe(null);
  expect(dropTrack(doc, "v1", "audio")).toBe(null);
  expect(dropTrack(doc, null, "video")).toBe(null);
  expect(dropTrack(doc, "gone", "video")).toBe(null);
  expect(dropTrack(doc, "a1", "audio")).toBe("a1");
});

describe("dropped files", () => {
  const AT = { frame: 90, trackId: "v1" };
  const fileOf = (name: string) => new File(["x"], name, { lastModified: 1 });
  const flush = () => Promise.resolve();

  // A row of the upload list; its key is its file name, as the fake queue gives it.
  const row = (fileName: string, over: Partial<UploadItem> = {}): UploadItem => ({
    key: fileName, fileName, sizeBytes: 1000, durationMs: null, stage: "uploading", sentBytes: 0, previewFraction: 0,
    assetId: null, message: null, canRetry: false, ...over,
  });
  // The row whose original is in, and its asset, ready.
  const readyVideo = (fileName: string, durationMs: number): [UploadItem, AssetView] => [
    row(fileName, { stage: "preview", durationMs, assetId: `id-${fileName}` }),
    assetView({ id: `id-${fileName}`, fileName, name: fileName, durationMs }),
  ];
  const readyImage = (fileName: string): [UploadItem, AssetView] => [
    row(fileName, { stage: "preview", assetId: `id-${fileName}` }),
    assetView({ id: `id-${fileName}`, kind: "image", fileName, name: fileName, durationMs: null, width: 800, height: 600, fps: null }),
  ];

  function setup(over: Parameters<typeof makeStore>[0] = {}) {
    const store = makeStore(over);
    const library = createLibraryStore({ api });
    const add = vi.fn((files: File[]) => files.map((f) => f.name));
    const drop = createMediaDrop({ store, library, queue: { add } });
    const stop = drop.start();
    const st = () => store.getState();
    const lib = () => library.getState();
    const uploads = (...items: UploadItem[]) => lib().setUploads(items);
    const put = (...assets: AssetView[]) => assets.forEach((a) => lib().put(a));
    // Where each clip of this asset is: its track's name, start and length.
    const clipsOf = (assetId: string) =>
      st().doc.tracks.flatMap((t) =>
        t.clips.flatMap((c) => (c.type !== "text" && c.assetId === assetId ? [{ track: t.name, trackId: t.id, start: c.start, duration: c.duration }] : [])),
      );
    const labels = () => st().queue.map((e) => e.label);
    const groups = () => drop.state.getState().groups;
    return { store, library, add, drop, stop, st, uploads, put, clipsOf, labels, groups };
  }

  it("a dropped file is not on the timeline while it uploads", async () => {
    const { st, drop, add, uploads, put, groups } = setup();
    const before = st().doc;
    const files = [fileOf("climb.mov")];
    drop.dropFiles(files, AT, { stillSeconds: 3 });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(files);
    expect(groups()).toEqual([
      { id: expect.any(String), frame: 90, trackId: "v1", stillSeconds: 3, members: [{ key: "climb.mov", state: "pending" }] },
    ]);
    uploads(row("climb.mov", { durationMs: 2_000, assetId: "id-climb.mov" }));
    put(assetView({ id: "id-climb.mov", status: "uploading", durationMs: 2_000 }));
    await flush();
    expect(st().doc).toBe(before);
    expect(st().queue).toEqual([]);
    expect(groups()[0].members).toEqual([{ key: "climb.mov", state: "pending" }]);
  });

  it("it lands where it was dropped once the original is in", async () => {
    const { st, drop, uploads, put, clipsOf, labels, groups } = setup();
    st().select(["x1"]);
    const selection = st().selection;
    drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    await flush();
    expect(clipsOf(asset.id)).toEqual([]); // the row is in, but the library has not learned its asset yet
    put(asset);
    await flush();
    expect(clipsOf(asset.id)).toEqual([{ track: "Video 1", trackId: "v1", start: 90, duration: 60 }]);
    expect(st().selection).toBe(selection);
    expect(labels()).toEqual(["add media"]);
    expect(groups()).toEqual([]);
  });

  it("a file already in when dropped lands without another change", async () => {
    const { drop, uploads, put, clipsOf } = setup();
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    put(asset);
    await flush();
    drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    await flush();
    expect(clipsOf(asset.id)).toEqual([{ track: "Video 1", trackId: "v1", start: 90, duration: 60 }]);
  });

  it("a spot that filled meanwhile sends it where placement puts it", async () => {
    const { st, drop, uploads, put, clipsOf } = setup();
    drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    uploads(row("climb.mov", { durationMs: 2_000 }));
    await flush();
    expect(st().applyRemote([entry(6, [{ op: "add_clip", trackId: "v1", clip: video("r1", 90, 60) }])])).toBe(true);
    await flush();
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    put(asset);
    await flush();
    expect(clipsOf(asset.id)).toMatchObject([{ track: "Video 2", start: 90, duration: 60 }]);
  });

  it("a video dropped on a text row goes to a video track, not an overlay track", async () => {
    const { st, drop, uploads, put, clipsOf } = setup();
    expect(st().edit([{ op: "add_track", track: { kind: "overlay", name: "Overlay 1" } }], "add track").ok).toBe(true);
    const overlay = st().doc.tracks.find((t) => t.kind === "overlay")!;
    expect(overlay.clips).toEqual([]);
    drop.dropFiles([fileOf("climb.mov")], { frame: 90, trackId: "t1" }, { stillSeconds: 3 });
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    put(asset);
    await flush();
    expect(clipsOf(asset.id)).toMatchObject([{ trackId: "v1", start: 90 }]);
  });

  it("three files are laid end to end in drop order, placed as each comes in", async () => {
    const { drop, uploads, put, clipsOf, groups } = setup();
    drop.dropFiles([fileOf("a.mov"), fileOf("b.mov"), fileOf("pit.png")], AT, { stillSeconds: 3 });
    const [aItem, aAsset] = readyVideo("a.mov", 2_000);
    const [bItem, bAsset] = readyVideo("b.mov", 1_000);
    const [pItem, pAsset] = readyImage("pit.png");
    const aUp = row("a.mov", { durationMs: 2_000 });
    const bUp = row("b.mov", { durationMs: 1_000 });
    uploads(aUp, bUp, row("pit.png"));
    await flush();
    expect(groups()[0].members.map((m) => m.state)).toEqual(["pending", "pending", "pending"]);

    uploads(aUp, bUp, pItem);
    put(pAsset);
    await flush();
    expect(clipsOf(pAsset.id)).toMatchObject([{ trackId: "v1", start: 180, duration: 90 }]);
    expect(clipsOf(aAsset.id)).toEqual([]);
    expect(groups()[0].members).toEqual([
      { key: "a.mov", state: "pending" }, { key: "b.mov", state: "pending" }, { key: "pit.png", state: "placed", placedFrames: 90 },
    ]);

    uploads(aUp, bItem, pItem);
    put(bAsset);
    await flush();
    expect(clipsOf(bAsset.id)).toMatchObject([{ trackId: "v1", start: 150, duration: 30 }]);

    uploads(aItem, bItem, pItem);
    put(aAsset);
    await flush();
    expect(clipsOf(aAsset.id)).toMatchObject([{ trackId: "v1", start: 90, duration: 60 }]);
    expect(groups()).toEqual([]);
  });

  it("a file waits until the lengths before it are known", async () => {
    const { drop, uploads, put, clipsOf } = setup();
    drop.dropFiles([fileOf("a.mov"), fileOf("b.mov")], AT, { stillSeconds: 3 });
    const [bItem, bAsset] = readyVideo("b.mov", 1_000);
    uploads(row("a.mov", { stage: "reading" }), bItem);
    put(bAsset);
    await flush();
    expect(clipsOf(bAsset.id)).toEqual([]);

    uploads(row("a.mov", { durationMs: 2_000 }), bItem);
    await flush();
    expect(clipsOf(bAsset.id)).toMatchObject([{ trackId: "v1", start: 150, duration: 30 }]);
  });

  it("a cancelled file places nothing and the ones after it close up", async () => {
    const { drop, uploads, put, clipsOf, groups } = setup();
    drop.dropFiles([fileOf("a.mov"), fileOf("b.mov")], AT, { stillSeconds: 3 });
    uploads(row("a.mov", { durationMs: 2_000 }), row("b.mov", { durationMs: 1_000 }));
    await flush();
    uploads(row("b.mov", { durationMs: 1_000 })); // a.mov is cancelled: its row goes
    await flush();
    expect(groups()[0].members).toEqual([{ key: "a.mov", state: "out" }, { key: "b.mov", state: "pending" }]);
    const [bItem, bAsset] = readyVideo("b.mov", 1_000);
    uploads(bItem);
    put(bAsset);
    await flush();
    expect(clipsOf(bAsset.id)).toMatchObject([{ trackId: "v1", start: 90, duration: 30 }]);
    expect(clipsOf("id-a.mov")).toEqual([]);
    expect(groups()).toEqual([]);
  });

  it("a file that fails for good places nothing; one that can be retried keeps its slot and lands after the retry", async () => {
    const lost = setup();
    lost.drop.dropFiles([fileOf("a.mov"), fileOf("b.mov")], AT, { stillSeconds: 3 });
    const [bItem, bAsset] = readyVideo("b.mov", 1_000);
    lost.uploads(row("a.mov", { stage: "failed", durationMs: 2_000, message: "Upload failed", canRetry: false }), bItem);
    lost.put(bAsset);
    await flush();
    expect(lost.clipsOf(bAsset.id)).toMatchObject([{ trackId: "v1", start: 90, duration: 30 }]);
    expect(lost.groups()).toEqual([]);

    const kept = setup();
    kept.drop.dropFiles([fileOf("a.mov"), fileOf("b.mov")], AT, { stillSeconds: 3 });
    const failed = row("a.mov", { stage: "failed", durationMs: 2_000, message: "Upload failed", canRetry: true });
    kept.uploads(failed, bItem);
    kept.put(bAsset);
    await flush();
    expect(kept.clipsOf(bAsset.id)).toMatchObject([{ trackId: "v1", start: 150, duration: 30 }]);
    expect(kept.groups()[0].members[0]).toEqual({ key: "a.mov", state: "pending" });

    kept.uploads({ ...failed, stage: "uploading", message: null, canRetry: false }, bItem); // retried
    await flush();
    const [aItem, aAsset] = readyVideo("a.mov", 2_000);
    kept.uploads(aItem, bItem);
    kept.put(aAsset);
    await flush();
    expect(kept.clipsOf(aAsset.id)).toMatchObject([{ trackId: "v1", start: 90, duration: 60 }]);
    expect(kept.groups()).toEqual([]);
  });

  it("a refused file type never gets a place", async () => {
    const { drop, uploads, put, clipsOf, st, groups } = setup();
    drop.dropFiles([fileOf("notes.txt"), fileOf("climb.mov")], AT, { stillSeconds: 3 });
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(row("notes.txt", { stage: "failed", message: "EasyEdit can't use this kind of file.", canRetry: false }), item);
    put(asset);
    await flush();
    expect(clipsOf(asset.id)).toMatchObject([{ trackId: "v1", start: 90, duration: 60 }]);
    expect(st().queue).toHaveLength(1);
    expect(groups()).toEqual([]);
  });

  it("nothing lands under a live gesture; it lands when the gesture ends", async () => {
    const { st, drop, uploads, put, clipsOf } = setup();
    drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    expect(st().setGesture([{ op: "move_clip", clipId: "x2", start: 150 }])).toBe(true);
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    put(asset);
    await flush();
    expect(clipsOf(asset.id)).toEqual([]);
    st().setGesture(null);
    await flush();
    expect(clipsOf(asset.id)).toMatchObject([{ trackId: "v1", start: 90, duration: 60 }]);
  });

  it("the same file dropped twice lands twice", async () => {
    const { drop, uploads, put, clipsOf, groups } = setup();
    drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    drop.dropFiles([fileOf("climb.mov")], { frame: 300, trackId: "v1" }, { stillSeconds: 3 });
    expect(groups().map((g) => g.frame)).toEqual([90, 300]);
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    put(asset);
    await flush();
    expect(clipsOf(asset.id)).toMatchObject([{ trackId: "v1", start: 90 }, { trackId: "v1", start: 300 }]);
  });

  it("a placement refused for room is not tried again", async () => {
    const doc = sampleDoc();
    doc.tracks[0].clips.push(video("r1", 80, 100));
    for (let i = 2; doc.tracks.length < LIMITS.tracksPerProject; i++) {
      const track: Track = { id: `a${i}`, kind: "audio", name: `Audio ${i}`, muted: false, hidden: false, locked: false, clips: [] };
      doc.tracks.push(track);
    }
    const { store, st, drop, uploads, put, clipsOf, groups } = setup({ doc });
    const notices = noticesOf(store);
    drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    put(asset);
    await flush();
    expect(notices).toEqual([MESSAGES.noRoom]);
    expect(groups()).toEqual([]);

    uploads({ ...item }); // three further changes
    await flush();
    put({ ...asset });
    await flush();
    st().edit([{ op: "move_clip", clipId: "x2", start: 150 }], "move");
    await flush();
    expect(notices).toEqual([MESSAGES.noRoom]);
    expect(clipsOf(asset.id)).toEqual([]);
  });

  it("losing edit access and stopping place nothing", async () => {
    const revoked = setup();
    revoked.drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    revoked.st().revokeEditing();
    expect(revoked.groups()).toEqual([]);
    const [item, asset] = readyVideo("climb.mov", 2_000);
    revoked.uploads(item);
    revoked.put(asset);
    await flush();
    expect(revoked.clipsOf(asset.id)).toEqual([]);

    const deleted = setup();
    deleted.drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    deleted.st().setStatus("deleted");
    expect(deleted.groups()).toEqual([]);

    const stopped = setup();
    stopped.drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    stopped.stop();
    expect(stopped.groups()).toEqual([]);
    stopped.uploads(item);
    stopped.put(asset);
    await flush();
    expect(stopped.clipsOf(asset.id)).toEqual([]);
    // A drop after the stop, of a file already in, lands nothing either.
    stopped.drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    await flush();
    expect(stopped.clipsOf(asset.id)).toEqual([]);
    expect(stopped.st().queue).toEqual([]);
  });

  it("an advance does nothing for a viewer or a deleted project", async () => {
    for (const blocked of [setup({ canEdit: false }), setup()]) {
      if (blocked.st().canEdit) blocked.st().setStatus("deleted");
      blocked.drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
      const [item, asset] = readyVideo("climb.mov", 2_000);
      blocked.uploads(item);
      blocked.put(asset);
      await flush();
      expect(blocked.groups()[0].members).toEqual([{ key: "climb.mov", state: "pending" }]);
      expect(blocked.st().queue).toEqual([]);
    }
  });

  it("a file whose asset was removed waits, and does not land", async () => {
    const { drop, uploads, put, clipsOf, groups } = setup();
    drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    put({ ...asset, removed: true });
    await flush();
    expect(clipsOf(asset.id)).toEqual([]);
    expect(groups()[0].members).toEqual([{ key: "climb.mov", state: "pending" }]);
  });

  it("a landed file keeps the length it landed with for the ones after it, once its row is gone", async () => {
    const { drop, uploads, put, clipsOf, groups } = setup();
    drop.dropFiles([fileOf("pit.png"), fileOf("climb.mov")], AT, { stillSeconds: 5 });
    const [pItem, pAsset] = readyImage("pit.png");
    const climbUp = row("climb.mov", { durationMs: 2_000 });
    uploads(pItem, climbUp);
    put(pAsset);
    await flush();
    expect(groups()[0].members[0]).toEqual({ key: "pit.png", state: "placed", placedFrames: 150 });
    uploads(climbUp); // the finished row is dismissed
    await flush();
    const [cItem, cAsset] = readyVideo("climb.mov", 2_000);
    uploads(cItem);
    put(cAsset);
    await flush();
    expect(clipsOf(cAsset.id)).toMatchObject([{ trackId: "v1", start: 240, duration: 60 }]);
  });

  it("endToEnd and uploadFrames", () => {
    expect(endToEnd(90, [60, 30, null, 15])).toEqual([90, 150, 180, null]);
    expect(endToEnd(90, [])).toEqual([]);
    expect(uploadFrames({ fileName: "pit.png", durationMs: null }, 30, 3)).toBe(90);
    expect(uploadFrames({ fileName: "pit.png", durationMs: null }, 30, 5)).toBe(150);
    expect(uploadFrames({ fileName: "climb.mov", durationMs: 2_000 }, 30, 3)).toBe(60);
    expect(uploadFrames({ fileName: "climb.mov", durationMs: null }, 30, 3)).toBe(null);
  });

  it("a file that becomes ready during a clip drag lands after the drag is saved", async () => {
    const { st, drop, uploads, put, clipsOf, labels } = setup();
    drop.dropFiles([fileOf("climb.mov")], AT, { stillSeconds: 3 });
    expect(st().setGesture([{ op: "move_clip", clipId: "c2", start: 90 }])).toBe(true);
    const [item, asset] = readyVideo("climb.mov", 2_000);
    uploads(item);
    put(asset);
    await flush();
    expect(clipsOf(asset.id)).toEqual([]);
    st().commitGesture("move");
    await flush();
    expect(labels()).toEqual(["move", "add media"]);
    expect(clipsOf(asset.id)).toMatchObject([{ track: "Video 2", start: 90, duration: 60 }]);
  });

  it("the still length is the one at the drop", async () => {
    const { drop, uploads, put, clipsOf } = setup();
    drop.dropFiles([fileOf("pit.png")], AT, { stillSeconds: 5 });
    const [item, asset] = readyImage("pit.png");
    uploads(item);
    put(asset);
    await flush();
    expect(clipsOf(asset.id)).toMatchObject([{ trackId: "v1", start: 90, duration: 150 }]);
  });
});
