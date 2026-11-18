import { describe, expect, it } from "vitest";
import { clearKeyframesOps, deleteKeyframeOps, editKeyframeOps, keyframeRows } from "@/lib/editor/keyframe-list";
import type { Clip, Keyframes, MediaClip } from "@/lib/timeline";
import { video } from "./fixtures";

// c2 runs from frame 30 to 60.
const c2 = (keyframes?: Keyframes, transform: Record<string, unknown> = {}) => {
  const base = video("c2", 30, 30) as MediaClip;
  return { ...base, transform: { ...base.transform, ...transform }, ...(keyframes ? { keyframes } : {}) } as Clip;
};

const patchOf = (ops: ReturnType<typeof editKeyframeOps>) => {
  expect(ops).toHaveLength(1);
  const op = ops[0] as { op: string; clipId: string; patch: { keyframes: Record<string, Array<{ at: number }>> } };
  expect(op.op).toBe("update_clip");
  expect(op.clipId).toBe("c2");
  return op.patch;
};

const scale = [{ at: 0, value: 1, ease: "ease_out" as const }, { at: 20, value: 2 }];

describe("keyframeRows", () => {
  it("returns only keyed props in order, each sorted by at", () => {
    const clip = c2({ opacity: [{ at: 5, value: 1 }, { at: 1, value: 0 }], x: [{ at: 3, value: 0.1 }], y: [], scale: [{ at: 9, value: 2 }, { at: 2, value: 1 }] });
    expect(keyframeRows(clip)).toEqual([
      { prop: "x", keyframes: [{ at: 3, value: 0.1 }] },
      { prop: "scale", keyframes: [{ at: 2, value: 1 }, { at: 9, value: 2 }] },
      { prop: "opacity", keyframes: [{ at: 1, value: 0 }, { at: 5, value: 1 }] },
    ]);
  });
  it("is empty for a clip with none", () => {
    expect(keyframeRows(c2())).toEqual([]);
  });
});

describe("editKeyframeOps", () => {
  it("changes a value and keeps the ease", () => {
    expect(patchOf(editKeyframeOps(c2({ scale }), "scale", 0, { value: 1.25 })).keyframes.scale).toEqual([{ at: 0, value: 1.25, ease: "ease_out" }, { at: 20, value: 2 }]);
  });
  it("changes only the ease", () => {
    expect(patchOf(editKeyframeOps(c2({ scale }), "scale", 20, { ease: "ease_in" })).keyframes.scale).toEqual([{ at: 0, value: 1, ease: "ease_out" }, { at: 20, value: 2, ease: "ease_in" }]);
  });
  it("moves one and stays sorted", () => {
    expect(patchOf(editKeyframeOps(c2({ scale }), "scale", 0, { at: 30 })).keyframes.scale).toEqual([{ at: 20, value: 2 }, { at: 30, value: 1, ease: "ease_out" }]);
  });
  it("moving onto an existing at leaves one with the moved value and ease", () => {
    expect(patchOf(editKeyframeOps(c2({ scale }), "scale", 0, { at: 20 })).keyframes.scale).toEqual([{ at: 20, value: 1, ease: "ease_out" }]);
  });
  it("keeps keyframes outside the clip", () => {
    expect(patchOf(editKeyframeOps(c2({ scale }), "scale", 0, { at: -10 })).keyframes.scale[0].at).toBe(-10);
    const clip = c2({ scale });
    expect(patchOf(editKeyframeOps(clip, "scale", 20, { at: clip.duration + 10 })).keyframes.scale[1].at).toBe(clip.duration + 10);
  });
  it("is nothing when no keyframe is there or nothing changes", () => {
    expect(editKeyframeOps(c2({ scale }), "scale", 5, { value: 3 })).toEqual([]);
    expect(editKeyframeOps(c2({ scale }), "scale", 20, { value: 2, at: 20 })).toEqual([]);
    expect(editKeyframeOps(c2({ scale }), "scale", 0, { ease: "ease_out" })).toEqual([]);
    expect(editKeyframeOps(c2(), "x", 0, { value: 1 })).toEqual([]);
  });
});

describe("deleteKeyframeOps", () => {
  it("removes it", () => {
    expect(patchOf(deleteKeyframeOps(c2({ scale }), "scale", 0))).toEqual({ keyframes: { scale: [{ at: 20, value: 2 }] } });
  });
  it("deleting the last keyframe keeps the clip where it was", () => {
    expect(patchOf(deleteKeyframeOps(c2({ scale: [{ at: 4, value: 1.5 }] }, { scale: 1 }), "scale", 4))).toEqual({ keyframes: { scale: [] }, transform: { scale: 1.5 } });
  });
  it("is nothing when no keyframe is there", () => {
    expect(deleteKeyframeOps(c2({ scale }), "scale", 7)).toEqual([]);
  });
});

describe("clearKeyframesOps", () => {
  it("empties the list and keeps the value at the clip's first frame", () => {
    expect(patchOf(clearKeyframesOps(c2({ scale }), "scale"))).toEqual({ keyframes: { scale: [] }, transform: { scale: 1 } });
  });
  it("is nothing when the property is not keyed", () => {
    expect(clearKeyframesOps(c2(), "scale")).toEqual([]);
  });
});
