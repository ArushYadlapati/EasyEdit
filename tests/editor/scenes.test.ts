import { describe, expect, it } from "vitest";
import { CUT_DIFFERENCE, createCutFinder, cutsIn, frameLook, frameOfMoment, lookDifference, sceneSplitOps } from "@/lib/editor/scenes";
import { applyOps, prepareOps, type MediaClip } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

const [W, H] = [16, 8];
type Color = [number, number, number];
const picture = (color: (x: number, y: number) => Color) => {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set([...color(x, y), 255], (y * W + x) * 4);
  return out;
};
const flat = (c: Color) => picture(() => c);
const look = (rgba: Uint8ClampedArray) => frameLook(rgba, W, H);

describe("how unlike two frames are", () => {
  it("is nothing for the same picture and everything for one with no colour in common", () => {
    expect(lookDifference(look(flat([200, 30, 30])), look(flat([200, 30, 30])))).toBe(0);
    expect(lookDifference(look(flat([200, 30, 30])), look(flat([30, 30, 200])))).toBe(1);
  });
  it("is little for a small change of light, and for one thing moving", () => {
    expect(lookDifference(look(flat([200, 30, 30])), look(flat([205, 34, 28])))).toBe(0);
    const ball = (at: number) => picture((x, y) => (Math.abs(x - at) < 2 && y > 2 && y < 6 ? [255, 255, 255] : [20, 90, 20]));
    expect(lookDifference(look(ball(4)), look(ball(5)))).toBeLessThan(0.1);
  });
  it("tells apart two shots with the same colours in different places", () => {
    const left = picture((x) => (x < W / 2 ? [200, 30, 30] : [30, 30, 200]));
    const right = picture((x) => (x < W / 2 ? [30, 30, 200] : [200, 30, 30]));
    expect(lookDifference(look(left), look(right))).toBe(1);
    // Half the picture changing is half the difference.
    const half = picture((x) => (x < W / 2 ? [200, 30, 30] : [30, 200, 30]));
    expect(lookDifference(look(left), look(half))).toBe(0.5);
  });
});

describe("which frames start a new shot", () => {
  const quiet = (n: number) => Array.from({ length: n }, () => 0.02);
  it("is a frame unlike the one before it, among frames that are alike", () => {
    expect(cutsIn([0, ...quiet(20), 0.8, ...quiet(20), 0.6, ...quiet(10)], 15)).toEqual([21, 42]);
    expect(cutsIn([0, ...quiet(30)], 15)).toEqual([]);
    expect(cutsIn([], 15)).toEqual([]);
  });
  it("is not every frame of fast motion, a zoom or a shaking camera, though each differs from the last", () => {
    expect(cutsIn([0, ...Array.from({ length: 40 }, (_, i) => 0.35 + (i % 3) * 0.05)], 15)).toEqual([]);
    // A cut in the middle of the motion still stands out.
    const moving = Array.from({ length: 41 }, () => 0.12);
    moving[20] = 0.9;
    expect(cutsIn(moving, 15)).toEqual([20]);
  });
  it("is not a small change, and two close together (a flash) are one, at the stronger", () => {
    expect(cutsIn([0, ...quiet(10), CUT_DIFFERENCE - 0.01, ...quiet(10)], 15)).toEqual([]);
    expect(cutsIn([0, ...quiet(10), 0.7, 0.02, 0.02, 0.9, ...quiet(10)], 15)).toEqual([14]);
    expect(cutsIn([0, ...quiet(10), 0.9, 0.02, 0.02, 0.7, ...quiet(10)], 15)).toEqual([11]);
  });
});

describe("looking through a video", () => {
  it("names the moments its shots start, from the frames in order", () => {
    const finder = createCutFinder();
    const shots: [number, Color][] = [[30, [200, 30, 30]], [45, [30, 30, 200]], [30, [30, 200, 30]]];
    let n = 0;
    for (const [frames, color] of shots) {
      for (let i = 0; i < frames; i++, n++) finder.add(n / 30, flat([color[0] + (i % 3), color[1], color[2]]), W, H);
    }
    expect(finder.frames()).toBe(105);
    expect(finder.cuts().map((s) => Math.round(s * 30))).toEqual([30, 75]);
  });
  it("has nothing to say of one frame, or of one shot", () => {
    const finder = createCutFinder();
    expect(finder.cuts()).toEqual([]);
    finder.add(0, flat([9, 9, 9]), W, H);
    expect(finder.cuts()).toEqual([]);
    for (let i = 1; i < 60; i++) finder.add(i / 30, flat([9, 9, 9]), W, H);
    expect(finder.cuts()).toEqual([]);
  });
});

describe("splitting a clip at its cuts", () => {
  // c1: frames 60–240 of the timeline, playing its file from frame 30.
  const clip = video("c1", 60, 180, { in: 30 }) as MediaClip;
  const doc = () => {
    const d = sampleDoc();
    d.tracks[0].clips = [clip];
    return d;
  };
  it("places a moment of the file on the timeline, at any forward speed", () => {
    expect(frameOfMoment(clip, 1, 30)).toBe(60); // the file's second second is the clip's first frame
    expect(frameOfMoment(clip, 3, 30)).toBe(120);
    expect(frameOfMoment({ ...clip, speed: 2 }, 3, 30)).toBe(90);
    expect(frameOfMoment({ ...clip, speed: 0.5 }, 3, 30)).toBe(180);
  });
  it("splits in order, each split on the piece the one before made, and leaves out frames that are not inside", () => {
    let n = 0;
    const { ops, clipIds } = sceneSplitOps(clip, [200, 120, 120, 60, 240, 10, 999], () => `s${++n}`);
    expect(ops).toEqual([
      { op: "split_clip", clipId: "c1", at: 120, newClipId: "s1" },
      { op: "split_clip", clipId: "s1", at: 200, newClipId: "s2" },
    ]);
    expect(clipIds).toEqual(["c1", "s1", "s2"]);
    const applied = applyOps(doc(), prepareOps(ops));
    expect(applied.doc.tracks[0].clips.map((c) => [c.id, c.start, c.duration, (c as MediaClip).in])).toEqual([["c1", 60, 60, 30], ["s1", 120, 80, 90], ["s2", 200, 40, 170]]);
    expect(applyOps(applied.doc, applied.inverse).doc).toEqual(doc());
    expect(sceneSplitOps(clip, [], () => "x")).toEqual({ ops: [], clipIds: ["c1"] });
  });
});
