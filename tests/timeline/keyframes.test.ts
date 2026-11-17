import { describe, expect, it } from "vitest";
import { DEFAULT_TRANSFORM, MediaClip, effectiveTransform, mayShow, removeKeyframe, setKeyframe, shiftKeyframes, valueAt, type Clip, type Keyframe } from "@/lib/timeline";

const clip = (extra: Record<string, unknown> = {}, start = 30) =>
  ({ id: "c", type: "video", assetId: "a", start, duration: 60, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, ...extra }) as Clip;
const line: Keyframe[] = [{ at: 0, value: 0 }, { at: 10, value: 100 }];

describe("valueAt", () => {
  it("holds the first value before and the last after", () => {
    expect(valueAt(line, -5)).toBe(0);
    expect(valueAt(line, 50)).toBe(100);
  });
  it("is linear by default", () => expect(valueAt(line, 5)).toBe(50));
  it("hold stays until the next keyframe", () => {
    const h: Keyframe[] = [{ at: 0, value: 0, ease: "hold" }, { at: 10, value: 100 }];
    expect(valueAt(h, 9)).toBe(0);
    expect(valueAt(h, 10)).toBe(100);
  });
  it("eases in below and out above the straight line", () => {
    const i = valueAt([{ at: 0, value: 0, ease: "ease_in" }, { at: 10, value: 100 }], 5);
    const o = valueAt([{ at: 0, value: 0, ease: "ease_out" }, { at: 10, value: 100 }], 5);
    expect(i).toBeLessThan(50);
    expect(o).toBeGreaterThan(50);
  });
});

describe("effectiveTransform", () => {
  it("replaces keyframed props using the frame relative to the clip start", () => {
    const c = clip({ transform: { ...DEFAULT_TRANSFORM, y: 0.2, scale: 2 }, keyframes: { x: [{ at: 0, value: 0 }, { at: 10, value: 1 }] } });
    const t = effectiveTransform(c, 35);
    expect(t.x).toBe(0.5);
    expect(t.y).toBe(0.2);
    expect(t.scale).toBe(2);
  });
  it("returns the same object when nothing is keyframed", () => {
    const c = clip();
    expect(effectiveTransform(c, 40)).toBe(c.transform);
    expect(effectiveTransform(clip({ keyframes: { x: [] } }), 40)).toBeDefined();
  });
});

describe("mayShow", () => {
  const hidden = { ...DEFAULT_TRANSFORM, opacity: 0 };
  it("is false at opacity 0 with no keyframes", () => expect(mayShow(clip({ transform: hidden }))).toBe(false));
  it("is true when an opacity keyframe is above 0", () =>
    expect(mayShow(clip({ transform: hidden, keyframes: { opacity: [{ at: 0, value: 0 }, { at: 10, value: 1 }] } }))).toBe(true));
});

describe("editing lists", () => {
  it("inserts in order and replaces in place, keeping the ease", () => {
    const a = setKeyframe([{ at: 0, value: 0 }, { at: 10, value: 1, ease: "hold" }], 5, 0.5);
    expect(a.map((k) => k.at)).toEqual([0, 5, 10]);
    expect(setKeyframe(a, 10, 9)[2]).toEqual({ at: 10, value: 9, ease: "hold" });
  });
  it("removes one", () => expect(removeKeyframe(line, 0)).toEqual([{ at: 10, value: 100 }]));
  it("shifts every keyframe", () => {
    expect(shiftKeyframes({ x: line }, -5)).toEqual({ x: [{ at: -5, value: 0 }, { at: 5, value: 100 }] });
    expect(shiftKeyframes(undefined, -5)).toBeUndefined();
  });
});

describe("schema", () => {
  const base = { id: "c", type: "video", assetId: "a", start: 0, duration: 30, in: 0, speed: 1, volume: 1, transform: DEFAULT_TRANSFORM };
  it("accepts an old clip", () => expect(MediaClip.safeParse(base).success).toBe(true));
  it("refuses keyframes out of order", () => {
    const r = MediaClip.safeParse({ ...base, keyframes: { x: [{ at: 5, value: 0 }, { at: 1, value: 0 }] } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain("time order");
  });
  it("refuses opacity above 1", () => expect(MediaClip.safeParse({ ...base, keyframes: { opacity: [{ at: 0, value: 2 }] } }).success).toBe(false));
  it("refuses a crossfade out", () => expect(MediaClip.safeParse({ ...base, transitionOut: { kind: "crossfade", frames: 10 } }).success).toBe(false));
  it("refuses more than 100 keyframes", () =>
    expect(MediaClip.safeParse({ ...base, keyframes: { x: Array.from({ length: 101 }, (_, i) => ({ at: i, value: 0 })) } }).success).toBe(false));
});
