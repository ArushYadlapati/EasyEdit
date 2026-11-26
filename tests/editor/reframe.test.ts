import { describe, expect, it } from "vitest";
import { reframeOps, reframePlace, reframePlan } from "@/lib/editor/reframe";
import { LIMITS } from "@/lib/limits";
import { applyOps, prepareOps, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

const WIDE = { width: 1920, height: 1080 };
// The sample project is upright (1080 x 1920); c1 is its first video clip, 30 frames from frame 0.
function doc(change: (clip: MediaClip, d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("c1", 0, 90)];
  change(d.tracks[0].clips[0] as MediaClip, d);
  return d;
}
const planOf = (d: TimelineDoc, source: { width: number; height: number } | null = WIDE) => reframePlan(d, "c1", source);
const good = (d: TimelineDoc, source = WIDE) => {
  const plan = planOf(d, source);
  if (!plan.ok) throw new Error(plan.why);
  return plan;
};

describe("whether there is anything to reframe", () => {
  it("a wide video in an upright project reaches past the frame sideways", () => {
    const plan = good(doc());
    expect(plan.axis).toBe("x");
    expect(plan.shown).toBeCloseTo((1920 / 1080) * (1920 / 1080), 4); // 3.16 frames wide once it fills the height
    expect([plan.first, plan.last]).toEqual([0, 90]);
  });
  it("an upright video in a wide project reaches past it up and down", () => {
    const wide = doc((_, d) => {
      d.format = "long_16x9";
      d.width = 1920;
      d.height = 1080;
    });
    const plan = good(wide, { width: 1080, height: 1920 });
    expect(plan.axis).toBe("y");
    expect(plan.shown).toBeCloseTo(3.1605, 3);
  });
  it("the part of the file it plays follows its start and its speed", () => {
    const plan = good(doc((clip) => Object.assign(clip, { in: 40, speed: 2 })));
    expect([plan.first, plan.last]).toEqual([40, 220]);
  });
  it("is refused when the shapes match, or the clip is turned, flipped, backwards, frozen, locked, too long or of no known size", () => {
    expect(planOf(doc(), { width: 1080, height: 1920 })).toEqual({ ok: false, why: "fits" });
    expect(planOf(doc(), { width: 1090, height: 1920 })).toEqual({ ok: false, why: "fits" }); // within 2%
    expect(planOf(doc((clip) => void (clip.transform.rotation = 5)))).toEqual({ ok: false, why: "turned" });
    expect(planOf(doc((clip) => void (clip.transform.flipH = true)))).toEqual({ ok: false, why: "turned" });
    expect(planOf(doc((clip) => void (clip.speed = -1)))).toEqual({ ok: false, why: "backwards" });
    expect(planOf(doc((clip) => void (clip.speed = 0)))).toEqual({ ok: false, why: "backwards" });
    expect(planOf(doc((_, d) => void (d.tracks[0].locked = true)))).toEqual({ ok: false, why: "locked" });
    expect(planOf(doc((clip) => void (clip.duration = LIMITS.steadyFrames + 5)))).toEqual({ ok: false, why: "too-long" });
    expect(planOf(doc(), null)).toEqual({ ok: false, why: "no-size" });
    expect(reframePlan(doc(), "x1", WIDE)).toEqual({ ok: false, why: "not-a-video" });
    expect(reframePlan(doc(), "nope", WIDE)).toEqual({ ok: false, why: "not-a-video" });
  });
});

describe("where the picture goes", () => {
  it("puts the place asked for in the middle of the frame", () => {
    // A picture three frames wide: its middle third shows when it sits in the middle.
    expect(reframePlace(3, 0.5)).toBe(0.5);
    expect(reframePlace(3, 0.4)).toBeCloseTo(0.8); // the place 0.4 along is 0.3 frames left of its middle: move right 0.3
    expect(reframePlace(3, 0.6)).toBeCloseTo(0.2);
  });
  it("stops where the picture's edge would come into the frame", () => {
    expect(reframePlace(3, 0)).toBe(1.5); // its left edge on the frame's left edge
    expect(reframePlace(3, 1)).toBe(-0.5);
    expect(reframePlace(3, 0.1)).toBe(1.5);
    expect(reframePlace(1, 0.2)).toBe(0.5); // nothing to spare
  });
});

describe("the edit", () => {
  const sweep = (from: number, to: number, frames = 90) => Array.from({ length: frames }, (_, f) => ({ sourceFrame: f, u: from + ((to - from) * f) / (frames - 1), v: 0.5 }));
  const keysOf = (d: TimelineDoc) => (d.tracks[0].clips[0] as MediaClip).keyframes!;
  it("fills the frame and moves the clip so the place found stays in the middle", () => {
    const start = doc((clip) => Object.assign(clip.transform, { scale: 0.5, x: 0.3, y: 0.7 }));
    const plan = good(start);
    const after = applyOps(start, prepareOps(reframeOps(plan, sweep(0.3, 0.7)))).doc;
    const clip = after.tracks[0].clips[0] as MediaClip;
    expect(clip.transform).toMatchObject({ fit: "cover", scale: 1, y: 0.5 });
    const x = keysOf(after).x!;
    expect(x[0]).toEqual({ at: 0, value: +reframePlace(plan.shown, 0.3).toFixed(4) });
    expect(x.at(-1)).toEqual({ at: 89, value: +reframePlace(plan.shown, 0.7).toFixed(4) });
    expect(x.length).toBeLessThan(6); // a straight move needs few keyframes
    expect(keysOf(after).y ?? []).toEqual([]);
    // The picture always covers the frame.
    const reach = (plan.shown - 1) / 2;
    for (const key of x) expect(Math.abs(key.value - 0.5)).toBeLessThanOrEqual(reach + 1e-9);
  });
  it("undoes whole", () => {
    const start = doc((clip) => Object.assign(clip.transform, { scale: 0.5, x: 0.3 }));
    const applied = applyOps(start, prepareOps(reframeOps(good(start), sweep(0.2, 0.8))));
    // Back as it was: an emptied keyframe list is the same as none (the timeline's own rule for an undo).
    const undone = applyOps(applied.doc, applied.inverse).doc.tracks[0].clips[0] as MediaClip;
    expect(undone.transform).toEqual((start.tracks[0].clips[0] as MediaClip).transform);
    expect(Object.values(undone.keyframes ?? {}).every((keys) => keys.length === 0)).toBe(true);
    expect({ ...undone, keyframes: undefined }).toEqual({ ...start.tracks[0].clips[0], keyframes: undefined });
  });
  it("replaces the position keyframes the clip had, and keeps no more than a clip may hold", () => {
    const start = doc((clip) => void (clip.keyframes = { x: [{ at: 0, value: 0.1 }, { at: 50, value: 0.9 }], y: [{ at: 0, value: 0.2 }, { at: 9, value: 0.3 }] }));
    const wiggly = Array.from({ length: 90 }, (_, f) => ({ sourceFrame: f, u: 0.5 + 0.2 * Math.sin(f * 1.3), v: 0.5 }));
    const after = applyOps(start, prepareOps(reframeOps(good(start), wiggly))).doc;
    expect(keysOf(after).x!.length).toBeLessThanOrEqual(LIMITS.keyframesPerProperty);
    expect(keysOf(after).x![0].at).toBe(0);
    expect(keysOf(after).y ?? []).toEqual([]);
  });
  it("reads the file's frames through the clip's start and speed, and leaves out what it does not play", () => {
    const start = doc((clip) => Object.assign(clip, { in: 100, speed: 2, duration: 30 }));
    const found = [{ sourceFrame: 90, u: 0.1, v: 0.5 }, { sourceFrame: 100, u: 0.4, v: 0.5 }, { sourceFrame: 128, u: 0.5, v: 0.5 }, { sourceFrame: 156, u: 0.6, v: 0.5 }, { sourceFrame: 400, u: 0.9, v: 0.5 }];
    const after = applyOps(start, prepareOps(reframeOps(good(start), found))).doc;
    expect(keysOf(after).x!.map((k) => k.at)).toEqual([0, 28]); // frames 100 and 156 of the file; the one between is on the line between them
  });
  it("is nothing with fewer than two frames to go by", () => {
    expect(reframeOps(good(doc()), [{ sourceFrame: 4, u: 0.5, v: 0.5 }])).toEqual([]);
    expect(reframeOps(good(doc()), [])).toEqual([]);
  });
});
