import { describe, expect, it } from "vitest";
import { clipFrame, kenBurnsOps, keyState, neighbourKeyframe, toggleKeyframeOps, writeTransformOps } from "@/lib/editor/keyframe-edit";
import { findClip } from "@/lib/editor/store";
import { applyOps, prepareOps, type Clip, type Keyframes, type MediaClip, type OpInput } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// c2 runs from frame 30 to 60, so its keyframes' `at` is the timeline frame less 30.
const c2 = (keyframes?: Keyframes, transform: Record<string, unknown> = {}) => {
  const base = video("c2", 30, 30) as MediaClip;
  return { ...base, transform: { ...base.transform, ...transform }, ...(keyframes ? { keyframes } : {}) } as Clip;
};

// The ops applied to the sample document with c2 swapped for the clip given, and the clip as it comes out.
function applied(clip: Clip, ops: OpInput[]): Clip {
  const doc = sampleDoc();
  doc.tracks[0].clips = doc.tracks[0].clips.map((c) => (c.id === clip.id ? clip : c));
  return findClip(applyOps(doc, prepareOps(ops, () => "g")).doc, clip.id)!.clip;
}

describe("keyState", () => {
  it("is none, elsewhere or here", () => {
    expect(keyState(c2(), "x", 40)).toBe("none");
    expect(keyState(c2({ x: [] }), "x", 40)).toBe("none");
    expect(keyState(c2({ x: [{ at: 5, value: 0.2 }] }), "x", 40)).toBe("elsewhere");
    expect(keyState(c2({ x: [{ at: 10, value: 0.2 }] }), "x", 40)).toBe("here");
    expect(keyState(c2({ x: [{ at: 10, value: 0.2 }] }), "y", 40)).toBe("none");
  });
});

describe("toggleKeyframeOps", () => {
  it("on a property not keyframed adds one keyframe at the playhead with the current value", () => {
    const clip = c2(undefined, { x: 0.3 });
    const ops = toggleKeyframeOps(clip, "x", 40);
    expect(ops).toEqual([{ op: "update_clip", clipId: "c2", patch: { keyframes: { x: [{ at: 10, value: 0.3 }] } } }]);
    expect(applied(clip, ops).keyframes).toEqual({ x: [{ at: 10, value: 0.3 }] });
  });

  it("keyframed elsewhere adds one with the value shown at the playhead, in order", () => {
    const clip = c2({ x: [{ at: 0, value: 0 }, { at: 20, value: 1 }] });
    expect(toggleKeyframeOps(clip, "x", 40)).toEqual([
      { op: "update_clip", clipId: "c2", patch: { keyframes: { x: [{ at: 0, value: 0 }, { at: 10, value: 0.5 }, { at: 20, value: 1 }] } } },
    ]);
  });

  it("here removes it, and leaves the others", () => {
    const clip = c2({ x: [{ at: 0, value: 0 }, { at: 10, value: 0.5 }] });
    expect(toggleKeyframeOps(clip, "x", 40)).toEqual([{ op: "update_clip", clipId: "c2", patch: { keyframes: { x: [{ at: 0, value: 0 }] } } }]);
  });

  it("removing the last one sends an empty list and keeps the value it had, so the clip does not jump", () => {
    const clip = c2({ x: [{ at: 10, value: 0.2 }] }, { x: 0.5 });
    const ops = toggleKeyframeOps(clip, "x", 40);
    expect(ops).toEqual([{ op: "update_clip", clipId: "c2", patch: { keyframes: { x: [] }, transform: { x: 0.2 } } }]);
    const out = applied(clip, ops);
    expect(out.keyframes).toEqual({ x: [] });
    expect(out.transform.x).toBe(0.2);
  });
});

describe("writeTransformOps", () => {
  it("writes a keyframed property as a keyframe at the playhead and the rest to the transform, in one op", () => {
    const clip = c2({ x: [{ at: 0, value: 0.1 }] });
    const ops = writeTransformOps(clip, 45, { x: 0.4, y: 0.6 });
    expect(ops).toEqual([
      { op: "update_clip", clipId: "c2", patch: { transform: { y: 0.6 }, keyframes: { x: [{ at: 0, value: 0.1 }, { at: 15, value: 0.4 }] } } },
    ]);
    const out = applied(clip, ops);
    expect(out.transform.y).toBe(0.6);
    expect(out.keyframes?.x).toEqual([{ at: 0, value: 0.1 }, { at: 15, value: 0.4 }]);
  });

  it("replaces the value of a keyframe already at the playhead", () => {
    const clip = c2({ scale: [{ at: 15, value: 1 }] });
    expect(writeTransformOps(clip, 45, { scale: 2 })).toEqual([{ op: "update_clip", clipId: "c2", patch: { keyframes: { scale: [{ at: 15, value: 2 }] } } }]);
  });

  it("without keyframes is a plain transform patch, and nothing is no op", () => {
    expect(writeTransformOps(c2(), 45, { rotation: 10 })).toEqual([{ op: "update_clip", clipId: "c2", patch: { transform: { rotation: 10 } } }]);
    expect(writeTransformOps(c2(), 45, {})).toEqual([]);
  });

  it("takes what is never keyframed, such as the crop and stretch, to the transform", () => {
    const clip = c2({ scale: [{ at: 0, value: 1 }] });
    const crop = { left: 0.1, top: 0, right: 0, bottom: 0 };
    expect(writeTransformOps(clip, 30, { scale: 0.5, stretch: 2, crop })).toEqual([
      { op: "update_clip", clipId: "c2", patch: { transform: { stretch: 2, crop }, keyframes: { scale: [{ at: 0, value: 0.5 }] } } },
    ]);
  });
});

describe("neighbourKeyframe", () => {
  const clip = c2({ x: [{ at: -5, value: 0 }, { at: 4, value: 0 }], opacity: [{ at: 12, value: 1 }, { at: 40, value: 1 }] });

  it("finds the nearest keyframe of any property inside the clip, in timeline frames", () => {
    expect(neighbourKeyframe(clip, 40, "prev")).toBe(34);
    expect(neighbourKeyframe(clip, 40, "next")).toBe(42);
    expect(neighbourKeyframe(clip, 34, "prev")).toBeNull(); // the one at −5 is before the clip
    expect(neighbourKeyframe(clip, 42, "next")).toBeNull(); // the one at 40 is past its end
    expect(neighbourKeyframe(c2(), 40, "next")).toBeNull();
  });
});

describe("clipFrame", () => {
  it("keeps the playhead inside the clip", () => {
    const clip = c2();
    expect(clipFrame(clip, 45)).toBe(45);
    expect(clipFrame(clip, 10)).toBe(30);
    expect(clipFrame(clip, 90)).toBe(59);
  });
});

describe("kenBurnsOps", () => {
  it("keys the scale from the clip's scale at its start to 1.15 times that at its last frame", () => {
    const image = { ...(video("c2", 30, 30, { type: "image" }) as MediaClip), transform: { ...video("c2", 0, 1).transform, scale: 0.8 } };
    const ops = kenBurnsOps(image);
    expect(ops).toEqual([{ op: "update_clip", clipId: "c2", patch: { keyframes: { scale: [{ at: 0, value: 0.8 }, { at: 29, value: 0.92 }] } } }]);
    expect(applied(image, ops).keyframes?.scale).toHaveLength(2);
  });

  it("starts from the scale shown at the start when it is keyframed already", () => {
    const image = { ...(video("c2", 30, 30, { type: "image" }) as MediaClip), keyframes: { scale: [{ at: 0, value: 2 }, { at: 10, value: 3 }] } };
    expect(kenBurnsOps(image)).toEqual([{ op: "update_clip", clipId: "c2", patch: { keyframes: { scale: [{ at: 0, value: 2 }, { at: 29, value: 2.3 }] } } }]);
  });
});
