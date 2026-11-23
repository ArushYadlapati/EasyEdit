import { describe, expect, it } from "vitest";
import { clipCues } from "@/lib/captions/cues";
import { trimBounds } from "@/lib/editor/media-clips";
import { sourceSeconds } from "@/lib/render/source-time";
import { DEFAULT_TRANSFORM, applyOps, fitsMedia, prepareOps, reversedTiming, sourceRange, type Op, type OpInput, type TimelineDoc } from "@/lib/timeline";
import type { Clip, MediaClip } from "@/lib/timeline/types";
import { docWithCaptions } from "../helpers/docs";

const media = (id: string, type: MediaClip["type"], extra: Record<string, unknown> = {}) =>
  ({ id, type, assetId: "a", start: 0, duration: 60, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, ...extra }) as MediaClip;

// v1 holds a video clip c1, frames 0 to 60 of the timeline.
function start(video: Record<string, unknown> = {}): TimelineDoc {
  return applyOps(docWithCaptions("short_9x16"), [{ op: "add_clip", trackId: "v1", clip: media("c1", "video", video) as Clip }]).doc;
}
const find = (d: TimelineDoc, id: string) => d.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as MediaClip;
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));

describe("the frames a clip uses", () => {
  it("run forward from in, backward down from in, or stay on in", () => {
    expect(sourceRange({ in: 10, duration: 60, speed: 1 })).toEqual({ from: 10, to: 70 });
    expect(sourceRange({ in: 10, duration: 60, speed: 2 })).toEqual({ from: 10, to: 130 });
    expect(sourceRange({ in: 69, duration: 60, speed: -1 })).toEqual({ from: 10, to: 70 });
    expect(sourceRange({ in: 129, duration: 60, speed: -2 })).toEqual({ from: 10, to: 130 });
    expect(sourceRange({ in: 40, duration: 60, speed: 0 })).toEqual({ from: 40, to: 41 });
  });
  it("must all be in the file", () => {
    expect(fitsMedia({ in: 0, duration: 60, speed: 1 }, 60)).toBe(true);
    expect(fitsMedia({ in: 1, duration: 60, speed: 1 }, 60)).toBe(false);
    expect(fitsMedia({ in: 59, duration: 60, speed: -1 }, 60)).toBe(true);
    expect(fitsMedia({ in: 58, duration: 60, speed: -1 }, 60)).toBe(false); // would run back past the first frame
    expect(fitsMedia({ in: 60, duration: 60, speed: -1 }, 60)).toBe(false); // starts past the last frame
    expect(fitsMedia({ in: 59, duration: 600, speed: 0 }, 60)).toBe(true);
    expect(fitsMedia({ in: 60, duration: 1, speed: 0 }, 60)).toBe(false);
  });
  it("turn round and back to the same clip", () => {
    const forward = { in: 10, duration: 60, speed: 1 };
    const backward = reversedTiming(forward)!;
    expect(backward).toEqual({ in: 69, speed: -1 });
    expect(reversedTiming({ ...forward, ...backward })).toEqual({ in: 10, speed: 1 });
    const fast = reversedTiming({ in: 10, duration: 30, speed: 2 })!;
    expect(fast).toEqual({ in: 69, speed: -2 });
    expect(sourceRange({ duration: 30, ...fast })).toEqual({ from: 10, to: 70 });
    expect(reversedTiming({ in: 5, duration: 30, speed: 0 })).toBeNull();
  });
});

describe("the picture a clip shows", () => {
  it("counts down from in when it plays backward", () => {
    const clip = media("c", "video", { start: 100, in: 69, speed: -1 });
    expect([100, 101, 159].map((f) => sourceSeconds(clip, f, 30) * 30)).toEqual([69, 68, 10]);
  });
  it("is the one frame at in when it holds", () => {
    const clip = media("c", "video", { start: 100, in: 45, speed: 0 });
    expect([100, 130, 159].map((f) => sourceSeconds(clip, f, 30) * 30)).toEqual([45, 45, 45]);
  });
});

describe("speed in the ops", () => {
  it("lets a video run backward or hold, and keeps sound and stills forward", () => {
    expect(find(run(start(), [{ op: "update_clip", clipId: "c1", patch: { speed: -1, in: 59 } }]).doc, "c1")).toMatchObject({ speed: -1, in: 59 });
    expect(find(run(start(), [{ op: "update_clip", clipId: "c1", patch: { speed: 0 } }]).doc, "c1").speed).toBe(0);
    const d = docWithCaptions("short_9x16");
    expect(() => run(d, [{ op: "add_clip", trackId: "a1", clip: media("m1", "audio", { speed: -1 }) }])).toThrow(/an audio clip's speed must be above 0/);
    expect(() => run(d, [{ op: "add_clip", trackId: "a1", clip: media("m1", "audio", { speed: 0 }) }])).toThrow(/above 0/);
    expect(() => run(d, [{ op: "add_clip", trackId: "v1", clip: media("i1", "image", { speed: 0 }) }])).toThrow(/an image clip's speed must be above 0/);
    const withAudio = run(d, [{ op: "add_clip", trackId: "a1", clip: media("m1", "audio") }]).doc;
    expect(() => run(withAudio, [{ op: "update_clip", clipId: "m1", patch: { speed: -2 } }])).toThrow(/above 0/);
  });

  it("an undo puts the speed and in back", () => {
    const before = start();
    const { doc, inverse } = run(before, [{ op: "update_clip", clipId: "c1", patch: { speed: -1, in: 59 } }]);
    expect(applyOps(doc, roundTrip(inverse)).doc).toEqual(before);
  });

  it("a backward clip trimmed at its start keeps the picture it ends on, and at its end the picture it starts on", () => {
    // Frames 59 down to 0 of the file, on timeline frames 0 to 60.
    const d = start({ in: 59, speed: -1 });
    const startTrim = run(d, [{ op: "trim_clip", clipId: "c1", edge: "start", to: 10 }]);
    expect(find(startTrim.doc, "c1")).toMatchObject({ start: 10, duration: 50, in: 49 }); // timeline frame 10 showed 49
    expect(applyOps(startTrim.doc, roundTrip(startTrim.inverse)).doc).toEqual(d);
    const endTrim = run(d, [{ op: "trim_clip", clipId: "c1", edge: "end", to: 40 }]);
    expect(find(endTrim.doc, "c1")).toMatchObject({ start: 0, duration: 40, in: 59 });
    expect(applyOps(endTrim.doc, roundTrip(endTrim.inverse)).doc).toEqual(d);
  });

  it("a backward clip cannot be made longer than the footage behind it", () => {
    const d = start({ in: 59, speed: -1 });
    expect(() => run(d, [{ op: "trim_clip", clipId: "c1", edge: "end", to: 61 }])).toThrow(/cannot run back past the start of its source/);
    const short = start({ in: 59, speed: -1, duration: 30 });
    expect(find(run(short, [{ op: "trim_clip", clipId: "c1", edge: "end", to: 60 }]).doc, "c1").duration).toBe(60);
  });

  it("a split leaves each piece showing what it showed", () => {
    const d = start({ in: 59, speed: -1 });
    const { doc, inverse } = run(d, [{ op: "split_clip", clipId: "c1", at: 20, newClipId: "c2" }]);
    expect(find(doc, "c1")).toMatchObject({ start: 0, duration: 20, in: 59 });
    expect(find(doc, "c2")).toMatchObject({ start: 20, duration: 40, in: 39, speed: -1 });
    expect(applyOps(doc, roundTrip(inverse)).doc).toEqual(d);
    const held = run(start({ in: 30, speed: 0 }), [{ op: "split_clip", clipId: "c1", at: 20, newClipId: "c2" }]).doc;
    expect([find(held, "c1").in, find(held, "c2").in]).toEqual([30, 30]);
  });

  it("a held frame trims freely at both ends", () => {
    const d = start({ in: 30, speed: 0, start: 30 });
    expect(find(run(d, [{ op: "trim_clip", clipId: "c1", edge: "start", to: 0 }]).doc, "c1")).toMatchObject({ start: 0, duration: 90, in: 30 });
    expect(find(run(d, [{ op: "trim_clip", clipId: "c1", edge: "end", to: 900 }]).doc, "c1")).toMatchObject({ duration: 870, in: 30 });
  });
});

describe("how far a clip's edges can go", () => {
  const L = 300; // the file's length in frames
  it("forward, as before", () => {
    expect(trimBounds(media("c", "video", { start: 100, in: 50, duration: 60 }), L)).toEqual({ minStart: 50, maxEnd: 350 });
    expect(trimBounds(media("c", "video", { start: 100, in: 50, duration: 60, speed: 2 }), L)).toEqual({ minStart: 75, maxEnd: 225 });
  });
  it("backward, its end runs to the file's first frame and its start to its last", () => {
    // Shows 109 down to 50: 50 frames of file are left behind it, 190 ahead of it.
    const clip = media("c", "video", { start: 300, in: 109, duration: 60, speed: -1 });
    expect(trimBounds(clip, L)).toEqual({ minStart: 110, maxEnd: 410 });
    const bounds = trimBounds(clip, L)!;
    const longest = { ...clip, duration: bounds.maxEnd - clip.start };
    expect(fitsMedia(longest, L)).toBe(true);
    expect(fitsMedia({ ...longest, duration: longest.duration + 1 }, L)).toBe(false);
  });
  it("agrees with the engine at every speed, both ways", () => {
    for (const speed of [0.3, 0.5, 1, 1.5, 2.5, 7, -0.3, -0.5, -1, -1.5, -2.5, -7]) {
      const clip = media("c", "video", { start: 1000, in: 150, duration: 21, speed });
      const d = applyOps(docWithCaptions("short_9x16"), [{ op: "add_clip", trackId: "v1", clip: clip as Clip }]).doc;
      const { minStart, maxEnd } = trimBounds(clip, L)!;
      const ended = find(run(d, [{ op: "trim_clip", clipId: "c", edge: "end", to: maxEnd }]).doc, "c");
      expect(fitsMedia(ended, L), `end at ${speed}`).toBe(true);
      expect(fitsMedia({ ...ended, duration: ended.duration + 1 }, L), `end + 1 at ${speed}`).toBe(false);
      const started = find(run(d, [{ op: "trim_clip", clipId: "c", edge: "start", to: minStart }]).doc, "c");
      expect(fitsMedia(started, L), `start at ${speed}`).toBe(true);
      if (minStart > 0) {
        const further = () => find(run(d, [{ op: "trim_clip", clipId: "c", edge: "start", to: minStart - 1 }]).doc, "c");
        let fits = false;
        try {
          fits = fitsMedia(further(), L);
        } catch {
          fits = false; // the engine itself refuses a start before the source's
        }
        expect(fits, `start - 1 at ${speed}`).toBe(false);
      }
    }
  });
  it("a held frame has no bounds", () => {
    expect(trimBounds(media("c", "video", { speed: 0 }), L)).toBeUndefined();
  });
});

describe("captions", () => {
  it("show nothing on a clip that plays backward or holds, which has no sound", () => {
    const words = [{ t: "hello", s: 0, e: 500 }, { t: "there", s: 600, e: 1000 }];
    expect(clipCues(media("f", "video"), words, 30, "block")).toHaveLength(1);
    expect(clipCues(media("b", "video", { in: 59, speed: -1 }), words, 30, "block")).toEqual([]);
    expect(clipCues(media("h", "video", { speed: 0 }), words, 30, "block")).toEqual([]);
  });
});
