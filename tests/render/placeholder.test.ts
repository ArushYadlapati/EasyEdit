import { describe, expect, it } from "vitest";
import { placeholderBox } from "@/lib/editor/clip-box";
import { canvasItems } from "@/lib/editor/canvas-geometry";
import { mediaWants, upcomingAssetIds } from "@/lib/editor/media-plan";
import { planThumbnail } from "@/lib/editor/thumbnail";
import { thumbnailFrame } from "@/lib/render/thumbnail-frame";
import { mediaSchedule } from "@/lib/export/media-schedule";
import { exportAssetIds, planExportMedia } from "@/lib/export/media-sources";
import { assetIdsToCheck, findMediaProblem } from "@/lib/media/refs";
import { drawFrame } from "@/lib/render/compositor";
import { clipSound, playsInPreview, soundingClips } from "@/lib/render/clip-sound";
import { DEFAULT_TRANSFORM, type Clip, type TimelineDoc } from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";
import { video } from "../editor/fixtures";
import { fakeCtx } from "./fake-ctx";

const slot = (id: string, accepts: "visual" | "audio", start = 0, duration = 60): Clip => ({
  id,
  type: "placeholder",
  start,
  duration,
  transform: { ...DEFAULT_TRANSFORM },
  accepts,
  slot: { name: "hero_clip" },
});

function docWith(...clips: Clip[]): TimelineDoc {
  const d = docWithCaptions("short_9x16");
  d.tracks[0].clips = clips.filter((c) => c.type !== "text" && (c.type !== "placeholder" || c.accepts === "visual"));
  return d;
}
const sizer = { source: () => null, measure: () => 100 };
const library = { assets: {}, loaded: true };

describe("an empty slot is not rendered", () => {
  it("draws nothing: the frame is the same as without it", () => {
    const a = fakeCtx();
    const b = fakeCtx();
    drawFrame(a.ctx, docWith(slot("s", "visual")), 10);
    drawFrame(b.ctx, docWith(), 10);
    expect(a.calls).toEqual(b.calls);
  });

  it("lists no asset and no scheduled file in the export", () => {
    const doc = docWith(slot("s", "visual"));
    expect(exportAssetIds(doc, true)).toEqual([]);
    expect(planExportMedia(doc, library as never, true)).toMatchObject({ clips: {}, sounds: {}, soundClips: 0, fileIds: [] });
    expect(mediaSchedule(doc, {})).toEqual({ clips: [], lastUse: {} });
  });

  it("is silent and never played by the preview", () => {
    const doc = docWith(slot("s", "visual"));
    const track = doc.tracks[0];
    const audio = slot("p", "audio");
    expect(clipSound(track, track.clips[0])).toBeNull();
    expect(clipSound(track, audio)).toBeNull();
    expect(playsInPreview(track, audio)).toBe(false);
    expect(soundingClips(doc)).toEqual([]);
    expect(mediaWants(doc, 5, { playing: true, rate: 1 })).toEqual([]);
    expect(upcomingAssetIds(doc, 5)).toEqual([]);
  });

  it("shows nothing in a thumbnail", () => {
    const doc = docWith(slot("s", "visual"));
    expect(thumbnailFrame(doc)).toBe(0);
    expect(planThumbnail(doc, library as never)).toEqual({ kind: "draw", frame: 0, sources: [] });
  });

  it("names no asset for the media checks", () => {
    const doc = docWith(slot("s", "visual"));
    const add = { op: "add_clip" as const, trackId: doc.tracks[0].id, clip: doc.tracks[0].clips[0] };
    expect(assetIdsToCheck(doc, [add])).toEqual([]);
    expect(findMediaProblem(doc, [add], new Map())).toBeNull();
  });
});

describe("an empty slot in the editor", () => {
  it("is a box on the canvas as large as the frame, scaled and moved by its transform", () => {
    const clip = slot("s", "visual") as Extract<Clip, { type: "placeholder" }>;
    expect(placeholderBox(clip, { width: 1080, height: 1920 })).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    const moved = { ...clip, transform: { ...clip.transform, x: 0.25, y: 0.5, scale: 0.5 } };
    expect(placeholderBox(moved, { width: 1080, height: 1920 })).toEqual({ x: 0, y: 480, w: 540, h: 960 });
  });

  it("is an item on the canvas when visual, and absent when it takes audio", () => {
    const doc = docWith(slot("s", "visual"), video("v", 0, 60));
    expect(canvasItems(doc, 5, sizer).map((i) => [i.clipId, i.type, i.slot])).toEqual([
      ["s", "placeholder", "hero_clip"],
      ["v", "video", undefined],
    ]);
    const audio = docWith();
    audio.tracks[3].clips = [slot("p", "audio")];
    expect(canvasItems(audio, 5, sizer)).toEqual([]);
  });
});
