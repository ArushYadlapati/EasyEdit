import { describe, expect, it } from "vitest";
import {
  THUMBNAIL_LONG_SIDE,
  THUMBNAIL_QUALITY,
  THUMBNAIL_SOURCE_MAX_SIDE,
  planThumbnail,
  thumbnailSize,
} from "@/lib/editor/thumbnail";
import type { AssetView } from "@/lib/media/types";
import { createEmptyDoc, type TimelineDoc, type Track } from "@/lib/timeline";
import { assetView } from "../helpers/media-services";
import { sampleDoc, text, video } from "./fixtures";

const lib = (assets: Record<string, AssetView>, loaded = true) => ({ assets, loaded });
const track = (id: string, kind: Track["kind"], clips: Track["clips"] = []): Track =>
  ({ id, kind, name: id, muted: false, hidden: false, locked: false, clips });

// A 30 fps project with one video clip of asset "a" on v1: frames 0 to 30, so the thumbnail's frame is 15.
function oneVideo(): TimelineDoc {
  const d = createEmptyDoc("short_9x16");
  d.tracks[0].clips = [video("c1", 0, 30)];
  return d;
}

// Two video clips at 0, frames 0 to 30: one of asset first on v1, and one of asset second on a video track v2 after it.
function twoVideos(first: string, second: string): TimelineDoc {
  const d = createEmptyDoc("short_9x16");
  d.tracks[0].clips = [video("c1", 0, 30, { assetId: first })];
  d.tracks.splice(1, 0, track("v2", "video", [video("c2", 0, 30, { assetId: second })]));
  return d;
}

describe("planThumbnail", () => {
  it("draws the frame thumbnailFrame names, from each picture's playback file", () => {
    expect(planThumbnail(sampleDoc(), lib({ a: assetView() }))).toEqual({
      kind: "draw",
      frame: 15,
      sources: [{ clipId: "c1", kind: "video", fileId: "prev-a", seconds: 0.5, stillId: "post-a" }],
    });
  });

  it("a clip partway into its media asks for its exact second", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("c1", 90, 300, { in: 60, speed: 2 })];
    const plan = planThumbnail(d, lib({ a: assetView() }));
    expect(plan).toMatchObject({ kind: "draw", frame: 120, sources: [{ clipId: "c1", seconds: 4 }] });
  });

  it("an image plays its original", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("i1", 0, 30, { type: "image", assetId: "i" })];
    const image = assetView({ id: "i", kind: "image", originalFileId: "orig-i", previewStatus: "none", previewFileId: null, posterFileId: "post-i" });
    expect(planThumbnail(d, lib({ i: image }))).toEqual({
      kind: "draw",
      frame: 15,
      sources: [{ clipId: "i1", kind: "image", fileId: "orig-i", seconds: 0, stillId: "post-i" }],
    });
  });

  it("a video with no preview copy uses its still, and a small original plays as it is", () => {
    const large = assetView({ previewStatus: "failed", previewFileId: null, sizeBytes: 300 * 1024 * 1024 });
    expect(planThumbnail(oneVideo(), lib({ a: large }))).toMatchObject({
      kind: "draw",
      sources: [{ clipId: "c1", fileId: null, stillId: "post-a" }],
    });
    const small = assetView({ previewStatus: "failed", previewFileId: null, sizeBytes: 1000 });
    expect(planThumbnail(oneVideo(), lib({ a: small }))).toMatchObject({
      kind: "draw",
      sources: [{ clipId: "c1", fileId: "orig-a", stillId: "post-a" }],
    });
  });

  it("waits while media uploads, its preview is being made, or the library has not loaded", () => {
    expect(planThumbnail(oneVideo(), lib({ a: assetView({ status: "uploading" }) }))).toEqual({ kind: "wait" });
    expect(planThumbnail(oneVideo(), lib({ a: assetView({ previewStatus: "pending", previewFileId: null }) }))).toEqual({ kind: "wait" });
    expect(planThumbnail(oneVideo(), lib({}, false))).toEqual({ kind: "wait" });
  });

  it("skips a removed or missing asset, and one with neither a file nor a still", () => {
    expect(planThumbnail(oneVideo(), lib({ a: assetView({ removed: true }) }))).toEqual({ kind: "skip" });
    expect(planThumbnail(oneVideo(), lib({}))).toEqual({ kind: "skip" });
    const noStill = assetView({ previewStatus: "failed", previewFileId: null, sizeBytes: 300 * 1024 * 1024, posterFileId: null });
    expect(planThumbnail(oneVideo(), lib({ a: noStill }))).toEqual({ kind: "skip" });
    const assets = { u: assetView({ id: "u", status: "uploading" }), r: assetView({ id: "r", removed: true }) };
    expect(planThumbnail(twoVideos("u", "r"), lib(assets))).toEqual({ kind: "skip" });
    expect(planThumbnail(twoVideos("r", "u"), lib(assets))).toEqual({ kind: "skip" });
  });

  it("only clips under the frame count", () => {
    const d = sampleDoc();
    d.tracks[0].clips[1] = video("c2", 30, 30, { assetId: "b" });
    const plan = planThumbnail(d, lib({ a: assetView(), b: assetView({ id: "b", removed: true }) }));
    expect(plan).toMatchObject({ kind: "draw" });
  });

  it("text alone needs no file", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[1].clips = [text("x1", 0, 60)];
    expect(planThumbnail(d, lib({}))).toEqual({ kind: "draw", frame: 30, sources: [] });
  });

  it("each picture under the frame is a source, in the order the frame draws them", () => {
    const d = twoVideos("a", "i");
    d.tracks[1].clips = [video("c2", 0, 30, { type: "image", assetId: "i" })];
    const image = assetView({ id: "i", kind: "image", originalFileId: "orig-i", previewStatus: "none", previewFileId: null, posterFileId: "post-i" });
    const plan = planThumbnail(d, lib({ a: assetView(), i: image }));
    expect(plan).toMatchObject({ kind: "draw", sources: [{ clipId: "c1", kind: "video" }, { clipId: "c2", kind: "image" }] });
  });

  it("thumbnailSize keeps the shape at 640 on the long side", () => {
    expect(thumbnailSize({ width: 1080, height: 1920 })).toEqual({ width: 360, height: 640 });
    expect(thumbnailSize({ width: 1920, height: 1080 })).toEqual({ width: 640, height: 360 });
    expect(thumbnailSize({ width: 816, height: 1056 })).toEqual({ width: 495, height: 640 });
    expect(thumbnailSize({ width: 16, height: 16 })).toEqual({ width: 640, height: 640 });
    expect(thumbnailSize({ width: 4096, height: 2024 })).toEqual({ width: 640, height: 316 });
  });

  it("thumbnailSize never rounds a side to nothing", () => {
    expect(thumbnailSize({ width: 2000, height: 1 })).toEqual({ width: 640, height: 1 });
  });

  it("the picture's constants", () => {
    expect(THUMBNAIL_LONG_SIDE).toBe(640);
    expect(THUMBNAIL_QUALITY).toBe(0.8);
    expect(THUMBNAIL_SOURCE_MAX_SIDE).toBe(1280);
  });
});
