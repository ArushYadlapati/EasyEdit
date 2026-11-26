import { describe, expect, it, vi } from "vitest";
import { cutOutClip, uploadOutcome, type CutoutDeps, type CutoutStep } from "@/lib/editor/cutout";
import { MESSAGES } from "@/lib/editor/messages";
import { CutoutError, type Cutter } from "@/lib/media/cutout/client";
import type { AssetView, UploadItem } from "@/lib/media/types";
import type { Clip, TimelineDoc } from "@/lib/timeline";
import { assetView } from "../helpers/media-services";
import { makeStore, noticesOf, sampleDoc, video } from "./fixtures";

// A project with a photo over its video: the image clip "pic" shows the asset "photo".
function doc(change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [video("pic", 0, 90, { type: "image", assetId: "photo" })] as Clip[] });
  change(d);
  return d;
}
const PHOTO = assetView({ id: "photo", kind: "image", name: "team photo", fileName: "team photo.jpg", originalFileId: "orig-photo", durationMs: null });
const clipOf = (store: ReturnType<typeof makeStore>, id = "pic") => store.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as Clip & { assetId: string };

function setUp(over: Partial<CutoutDeps> & { doc?: TimelineDoc; canEdit?: boolean } = {}) {
  const store = makeStore({ doc: over.doc ?? doc(), canEdit: over.canEdit ?? true });
  const uploadedFiles: File[] = [];
  const steps: CutoutStep[] = [];
  const cutter: Cutter = { cut: vi.fn(async (_file, opts) => (opts?.onProgress?.({ stage: "model", done: 1, total: 2 }), opts?.onProgress?.({ stage: "cutting", done: 0, total: 1 }), { png: new Blob(["png"], { type: "image/png" }), width: 10, height: 10, kept: 0.5 })) };
  const deps: CutoutDeps = {
    store,
    asset: (id) => (id === "photo" ? PHOTO : undefined),
    readFile: vi.fn(async () => new Blob(["jpeg"])),
    cutter,
    upload: (file) => (uploadedFiles.push(file), "row-1"),
    uploaded: vi.fn(async () => "cutout-1"),
    ...over,
  };
  const control = new AbortController();
  const run = () => cutOutClip(deps, "pic", { signal: control.signal, onStep: (step) => steps.push(step) });
  return { store, deps, run, control, uploadedFiles, steps, notices: noticesOf(store) };
}

describe("removing a picture's background", () => {
  it("cuts the picture out, uploads the cut-out and switches the clip to it, as one change that undoes", async () => {
    const { store, deps, run, uploadedFiles, steps, notices } = setUp();
    await run();
    expect(deps.readFile).toHaveBeenCalledWith("orig-photo");
    expect(uploadedFiles.map((f) => [f.name, f.type])).toEqual([["team photo (cut out).png", "image/png"]]);
    expect(deps.uploaded).toHaveBeenCalledWith("row-1", expect.anything());
    expect(clipOf(store).assetId).toBe("cutout-1");
    expect(store.getState().queue.map((e) => e.label)).toEqual(["remove background"]);
    expect(steps.map((s) => s.stage)).toEqual(["reading", "model", "cutting", "uploading"]);
    expect(notices).toEqual([MESSAGES.cutoutDone]);
    store.getState().undo();
    expect(clipOf(store).assetId).toBe("photo");
  });
  it("keeps everything else of the clip: its place, its length and its looks", async () => {
    const start = doc((d) => {
      const pic = d.tracks[1].clips[0];
      pic.transform = { ...pic.transform, x: 0.3, scale: 0.6, rotation: 12 };
    });
    const { store, run } = setUp({ doc: start });
    const before = clipOf(store);
    await run();
    expect(clipOf(store)).toEqual({ ...before, assetId: "cutout-1" });
  });
  it("says what went wrong and changes nothing", async () => {
    const failing = (code: "undecodable" | "model" | "nothing" | "unknown"): Cutter => ({ cut: async () => Promise.reject(new CutoutError(code, "detail")) });
    const cases: [Partial<CutoutDeps>, string][] = [
      [{ readFile: async () => null }, MESSAGES.cutoutUnreadable],
      [{ readFile: async () => Promise.reject(new Error("offline")) }, MESSAGES.cutoutUnreadable],
      [{ asset: () => undefined }, MESSAGES.cutoutUnreadable],
      [{ asset: () => ({ ...PHOTO, removed: true }) }, MESSAGES.cutoutUnreadable],
      [{ cutter: failing("undecodable") }, MESSAGES.cutoutUnreadable],
      [{ cutter: failing("model") }, MESSAGES.cutoutModel],
      [{ cutter: failing("nothing") }, MESSAGES.cutoutNothing],
      [{ cutter: failing("unknown") }, MESSAGES.cutoutFailed],
      [{ cutter: { cut: async () => Promise.reject(new Error("boom")) } }, MESSAGES.cutoutFailed],
      [{ upload: () => null }, MESSAGES.cutoutNoStorage],
      [{ uploaded: async () => null }, MESSAGES.cutoutUploadFailed],
    ];
    for (const [over, message] of cases) {
      const { store, run, notices } = setUp(over);
      await run();
      expect([notices, clipOf(store).assetId, store.getState().queue.length], message).toEqual([[message], "photo", 0]);
    }
  });
  it("is for an editor, an image clip, and an unlocked track", async () => {
    const viewer = setUp({ canEdit: false });
    await viewer.run();
    expect(viewer.deps.readFile).not.toHaveBeenCalled();
    expect(viewer.notices).toEqual([]);
    expect(clipOf(viewer.store).assetId).toBe("photo");
    const locked = setUp({ doc: doc((d) => void (d.tracks[1].locked = true)) });
    await locked.run();
    expect([locked.notices.length, clipOf(locked.store).assetId]).toEqual([1, "photo"]);
    const video = setUp();
    await cutOutClip(video.deps, "c1", { signal: video.control.signal });
    expect(video.deps.readFile).not.toHaveBeenCalled();
  });
  it("a cancel while the model runs changes nothing and says nothing", async () => {
    const shown = setUp({ cutter: { cut: (_file, opts) => new Promise((_resolve, reject) => opts?.signal?.addEventListener("abort", () => reject(new CutoutError("cancelled", "Cancelled.")))) } });
    const running = shown.run();
    await Promise.resolve();
    await Promise.resolve();
    shown.control.abort();
    await running;
    expect([shown.notices, shown.uploadedFiles.length, clipOf(shown.store).assetId]).toEqual([[], 0, "photo"]);
  });
  it("leaves a clip that changed meanwhile as it is: the cut-out is in the library", async () => {
    const shown = setUp();
    shown.deps.uploaded = async () => {
      shown.store.getState().edit([{ op: "update_clip", clipId: "pic", patch: { assetId: "other" } }], "swap");
      return "cutout-1";
    };
    await shown.run();
    expect([clipOf(shown.store).assetId, shown.notices]).toEqual(["other", [MESSAGES.cutoutInLibrary]]);
  });
});

describe("an upload's outcome", () => {
  const row = (over: Partial<UploadItem>): UploadItem => ({ key: "row-1", fileName: "x.png", sizeBytes: 3, durationMs: null, stage: "uploading", sentBytes: 0, previewFraction: 0, assetId: null, message: null, canRetry: false, ...over });
  const ready: AssetView = { ...PHOTO, id: "new" };
  it("is not known while the file is on its way or the library has not got it", () => {
    expect(uploadOutcome({ uploads: [row({})], assets: {} }, "row-1")).toBeUndefined();
    expect(uploadOutcome({ uploads: [row({ assetId: "new", stage: "finishing" })], assets: {} }, "row-1")).toBeUndefined();
    expect(uploadOutcome({ uploads: [row({ assetId: "new", stage: "done" })], assets: { new: { ...ready, status: "uploading", originalFileId: null } as AssetView } }, "row-1")).toBeUndefined();
  });
  it("is the new picture's id once it is ready in the library", () => {
    expect(uploadOutcome({ uploads: [row({ assetId: "new", stage: "done" })], assets: { new: ready } }, "row-1")).toBe("new");
  });
  it("is nothing when the upload failed or its row is gone", () => {
    expect(uploadOutcome({ uploads: [row({ stage: "failed", message: "no" })], assets: {} }, "row-1")).toBeNull();
    expect(uploadOutcome({ uploads: [], assets: {} }, "row-1")).toBeNull();
  });
});
