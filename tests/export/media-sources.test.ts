import { describe, expect, it } from "vitest";
import { exportAssetIds, jobClips, planExportMedia } from "@/lib/export/media-sources";
import type { AssetView } from "@/lib/media/types";
import type { MediaClip } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";
import { assetView } from "../helpers/media-services";

const lib = (assets: AssetView[] = [assetView()], loaded = true) => ({ assets: Object.fromEntries(assets.map((a) => [a.id, a])), loaded });
const image = (over: Partial<AssetView> = {}) =>
  assetView({ id: "b", kind: "image", originalFileId: "orig-b", previewStatus: "none", previewFileId: null, ...over });
const plansOf = (assets: AssetView[], loaded = true) => planExportMedia(sampleDoc(), lib(assets, loaded)).clips.c1;

describe("which file each clip exports from", () => {
  it("uses the file the editor plays: a video's preview copy", () => {
    expect(planExportMedia(sampleDoc(), lib())).toEqual({
      clips: { c1: { kind: "use", fileId: "prev-a", from: "preview" }, c2: { kind: "use", fileId: "prev-a", from: "preview" } },
      fileIds: ["prev-a"],
    });
  });

  it("uses a small original when a video has no preview copy, and an image's original", () => {
    expect(plansOf([assetView({ previewStatus: "failed", previewFileId: null })])).toEqual({ kind: "use", fileId: "orig-a", from: "original" });
    const d = sampleDoc();
    d.tracks[0].clips = [video("i1", 0, 30, { type: "image", assetId: "b" })];
    expect(planExportMedia(d, lib([image()])).clips.i1).toEqual({ kind: "use", fileId: "orig-b", from: "original" });
  });

  it("waits for media that is uploading or being prepared, and for an asset the library has not loaded", () => {
    expect(plansOf([assetView({ status: "uploading" })])).toEqual({ kind: "wait", why: "uploading" });
    expect(plansOf([assetView({ previewStatus: "pending" })])).toEqual({ kind: "wait", why: "preparing" });
    expect(plansOf([], false)).toEqual({ kind: "wait", why: "library" });
    // an asset the library already knows needs no wait, loaded or not
    expect(plansOf([assetView()], false)).toEqual({ kind: "use", fileId: "prev-a", from: "preview" });
  });

  it("draws the preview's placeholder for media that is removed, missing, or too large to play without a preview copy", () => {
    expect(plansOf([assetView({ removed: true })])).toEqual({ kind: "placeholder", label: "Media removed" });
    expect(plansOf([], true)).toEqual({ kind: "placeholder", label: "Media not found" });
    expect(plansOf([assetView({ previewStatus: "failed", previewFileId: null, sizeBytes: 300 * 1024 * 1024 })])).toEqual({ kind: "placeholder", label: "No preview" });
    expect(planExportMedia(sampleDoc(), lib([assetView({ removed: true })])).fileIds).toEqual([]);
  });

  it("looks only at clips that draw: not on a hidden track, not audio, not invisible", () => {
    const hidden = sampleDoc();
    hidden.tracks[0].hidden = true;
    expect(planExportMedia(hidden, lib())).toEqual({ clips: {}, fileIds: [] });
    expect(exportAssetIds(hidden)).toEqual([]);
    const faded = sampleDoc();
    (faded.tracks[0].clips[0] as MediaClip).transform.opacity = 0;
    faded.tracks[3].clips = [video("m1", 0, 30, { type: "audio", assetId: "song" })];
    expect(Object.keys(planExportMedia(faded, lib()).clips)).toEqual(["c2"]);
    expect(exportAssetIds(faded)).toEqual(["a"]);
  });

  it("lists each file and each asset once, in the order the timeline first uses it", () => {
    const d = sampleDoc();
    d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [video("c3", 0, 60)] });
    d.tracks[0].clips[1] = video("c2", 30, 30, { type: "image", assetId: "b" });
    expect(planExportMedia(d, lib([assetView(), image()])).fileIds).toEqual(["prev-a", "orig-b"]);
    expect(exportAssetIds(d)).toEqual(["a", "b"]);
  });

  it("takes the clips in drawing order: tracks in order, then each track's clips in order", () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("c1", 0, 30, { type: "image", assetId: "b" }), video("c2", 30, 30)];
    d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [video("c3", 0, 60, { assetId: "z" })] });
    const plan = planExportMedia(d, lib([assetView(), image(), assetView({ id: "z", originalFileId: "orig-z", previewFileId: "prev-z" })]));
    expect(plan.fileIds).toEqual(["orig-b", "prev-a", "prev-z"]);
    expect(Object.keys(plan.clips)).toEqual(["c1", "c2", "c3"]);
    expect(exportAssetIds(d)).toEqual(["b", "a", "z"]);
  });

  it("tells the worker each clip's file or label, and leaves a waiting clip out", () => {
    const d = sampleDoc();
    d.tracks[0].clips[1] = video("c2", 30, 30, { assetId: "gone" });
    d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [video("c3", 0, 60, { assetId: "up" })] });
    const plan = planExportMedia(d, lib([assetView(), assetView({ id: "up", status: "uploading" })]));
    expect(jobClips(plan)).toEqual({ c1: { fileId: "prev-a" }, c2: { label: "Media not found" } });
  });
});
