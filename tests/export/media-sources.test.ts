import { describe, expect, it } from "vitest";
import { exportAssetIds, jobClips, jobSounds, planExportMedia } from "@/lib/export/media-sources";
import type { AssetView } from "@/lib/media/types";
import type { MediaClip } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";
import { assetView } from "../helpers/media-services";
import { SONG, Z, soundDoc } from "./sound-fixtures";

const lib = (assets: AssetView[] = [assetView()], loaded = true) => ({ assets: Object.fromEntries(assets.map((a) => [a.id, a])), loaded });
const image = (over: Partial<AssetView> = {}) =>
  assetView({ id: "b", kind: "image", originalFileId: "orig-b", previewStatus: "none", previewFileId: null, ...over });
const plansOf = (assets: AssetView[], loaded = true) => planExportMedia(sampleDoc(), lib(assets, loaded)).clips.c1;

describe("which file each clip exports from", () => {
  it("uses the file the editor plays: a video's preview copy", () => {
    expect(planExportMedia(sampleDoc(), lib())).toEqual({
      clips: { c1: { kind: "use", fileId: "prev-a", from: "preview" }, c2: { kind: "use", fileId: "prev-a", from: "preview" } },
      sounds: {}, soundClips: 2,
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
    expect(planExportMedia(hidden, lib())).toEqual({ clips: {}, sounds: {}, soundClips: 0, fileIds: [] });
    expect(exportAssetIds(hidden)).toEqual([]);
    const faded = sampleDoc();
    (faded.tracks[0].clips[0] as MediaClip).transform.opacity = 0;
    faded.tracks[3].clips = [video("m1", 0, 30, { type: "audio", assetId: "song" })];
    expect(Object.keys(planExportMedia(faded, lib()).clips)).toEqual(["c2"]);
    expect(exportAssetIds(faded)).toEqual(["a"]);
  });

  it("plans a clip that fades in from opacity 0 with its opacity keyframes", () => {
    const d = sampleDoc();
    const c1 = d.tracks[0].clips[0] as MediaClip;
    c1.transform.opacity = 0;
    c1.keyframes = { opacity: [{ at: 0, value: 0 }, { at: 10, value: 1 }] };
    expect(Object.keys(planExportMedia(d, lib()).clips)).toEqual(["c1", "c2"]);
    expect(exportAssetIds(d)).toEqual(["a"]);
    c1.keyframes = { opacity: [{ at: 0, value: 0 }, { at: 10, value: 0 }] };
    expect(Object.keys(planExportMedia(d, lib()).clips)).toEqual(["c2"]);
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

describe("which file each clip's sound comes from", () => {
  const all = () => lib([assetView(), Z, SONG]);

  it("plans the sound of every clip the preview plays, from the same files, each read once", () => {
    const plan = planExportMedia(soundDoc(), all(), true);
    expect(plan.sounds).toEqual({
      c1: { kind: "use", fileId: "prev-a", from: "preview" }, c2: { kind: "use", fileId: "prev-a", from: "preview" },
      c3: { kind: "use", fileId: "prev-z", from: "preview" }, m1: { kind: "use", fileId: "orig-song", from: "original" },
    });
    expect(Object.keys(plan.clips)).toEqual(["c1", "c2"]);
    expect([plan.fileIds, plan.soundClips]).toEqual([["prev-a", "prev-z", "orig-song"], 4]);
    expect(jobSounds(plan)).toEqual({ c1: "prev-a", c2: "prev-a", c3: "prev-z", m1: "orig-song" });
    expect(exportAssetIds(soundDoc(), true)).toEqual(["a", "z", "song"]);
  });

  it("plans no sound unless asked, and still counts the clips that would sound", () => {
    const plan = planExportMedia(soundDoc(), all());
    expect([plan.sounds, plan.fileIds, plan.soundClips]).toEqual([{}, ["prev-a"], 4]);
    expect(exportAssetIds(soundDoc())).toEqual(["a"]);
    // a clip with no media is silent in the preview, so it is not counted: only c3 would sound
    expect(planExportMedia(soundDoc(), lib([assetView({ removed: true }), Z, assetView({ ...SONG, removed: true })])).soundClips).toBe(1);
  });

  it("sounds an invisible video from the file the preview plays, its small original when it has no copy (D10)", () => {
    const plan = planExportMedia(soundDoc(), lib([assetView(), assetView({ ...Z, previewStatus: "failed", previewFileId: null }), SONG]), true);
    expect(plan.sounds.c3).toEqual({ kind: "use", fileId: "orig-z", from: "original" });
    expect(plan.fileIds).toEqual(["prev-a", "orig-z", "orig-song"]);
  });

  it("follows the preview: a hidden video track and muted tracks are silent, a hidden audio track sounds", () => {
    const d = soundDoc();
    d.tracks[0].hidden = true;
    d.tracks[4].hidden = true;
    expect(Object.keys(planExportMedia(d, all(), true).sounds)).toEqual(["c3", "m1"]);
    d.tracks[1].muted = true;
    d.tracks[4].muted = true;
    const muted = planExportMedia(d, all(), true);
    expect([muted.sounds, muted.soundClips]).toEqual([{}, 0]);
  });

  it("waits for sound media that is uploading, and gives removed sound a placeholder the job leaves out", () => {
    expect(planExportMedia(soundDoc(), lib([assetView(), Z, assetView({ ...SONG, status: "uploading" })]), true).sounds.m1).toEqual({ kind: "wait", why: "uploading" });
    const gone = planExportMedia(soundDoc(), lib([assetView(), Z, assetView({ ...SONG, removed: true })]), true);
    expect(gone.sounds.m1).toEqual({ kind: "placeholder", label: "Media removed" });
    expect(jobSounds(gone)).not.toHaveProperty("m1");
  });

  // Beyond the brief: in soundDoc() the pictures' files come first in document order anyway.
  it("lists the pictures' files and assets first, then the sounds' not yet listed", () => {
    const d = soundDoc();
    d.tracks[0].muted = true; // c1 and c2 draw but are silent; c3 and m1 sound and do not draw
    expect(planExportMedia(d, all(), true).fileIds).toEqual(["prev-a", "prev-z", "orig-song"]);
    expect(exportAssetIds(d, true)).toEqual(["a", "z", "song"]);
  });

  it("leaves out the sound of a file the library says has none, but still draws its picture", () => {
    const plan = planExportMedia(soundDoc(), lib([assetView({ hasAudio: false }), Z, SONG]), true);
    expect(Object.keys(plan.sounds)).toEqual(["c3", "m1"]);
    expect([plan.soundClips, plan.fileIds]).toEqual([2, ["prev-a", "prev-z", "orig-song"]]);
  });
});
