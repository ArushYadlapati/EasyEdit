import { describe, expect, it } from "vitest";
import { resetCrop } from "@/lib/editor/actions";
import { clipFieldOps, clipFieldValue, fieldContext, type ClipField } from "@/lib/editor/inspector-fields";
import { toggleKeyframeOps, writeTransformOps } from "@/lib/editor/keyframe-edit";
import { deleteKeyframeOps, editKeyframeOps } from "@/lib/editor/keyframe-list";
import { canvasItems } from "@/lib/editor/canvas-geometry";
import { findClip } from "@/lib/editor/store";
import { drawFrame, type ResolvedSource } from "@/lib/render/compositor";
import { CROP_PROPS, KEYFRAME_PROPS, applyOps, basePatch, bezierAt, describe as describeDoc, effectiveTransform, isCropProp, prepareOps, propValue, travel, valueAt, type KeyframeCurve, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx } from "../render/fake-ctx";

const c1 = (d: TimelineDoc) => findClip(d, "c1")!.clip as MediaClip;
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const patch = (clipId: string, p: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId, patch: p }];
const near = (a: number, b: number, by = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(by);

describe("a keyframe's hand-shaped curve", () => {
  it("with straight handles is a straight travel", () => {
    for (const p of [0, 0.2, 0.5, 0.9, 1]) near(bezierAt([0.25, 0.25, 0.75, 0.75], p), p, 1e-5);
  });
  it("matches the curves a browser draws for the same four numbers", () => {
    // cubic-bezier(0.25, 0.1, 0.25, 1), the CSS "ease", and (0.42, 0, 1, 1), "ease-in", at known points.
    near(bezierAt([0.25, 0.1, 0.25, 1], 0.5), 0.8024);
    near(bezierAt([0.25, 0.1, 0.25, 1], 0.25), 0.4085);
    near(bezierAt([0.42, 0, 1, 1], 0.5), 0.3154);
  });
  it("starts and ends where the keyframes are, and may overshoot between", () => {
    const back: KeyframeCurve = [0.3, -0.5, 0.6, 1.6];
    expect([bezierAt(back, 0), bezierAt(back, 1), bezierAt(back, -1), bezierAt(back, 2)]).toEqual([0, 1, 0, 1]);
    expect(Math.min(...[0.05, 0.1, 0.15].map((p) => bezierAt(back, p)))).toBeLessThan(0);
    expect(Math.max(...[0.8, 0.85, 0.9].map((p) => bezierAt(back, p)))).toBeGreaterThan(1);
  });
  it("takes the place of the named ease, except a hold", () => {
    const curve: KeyframeCurve = [0, 0, 0, 1];
    expect(travel({ curve, ease: "ease_in" }, 0.5)).toBeGreaterThan(0.8);
    expect(travel({ curve, ease: "hold" }, 0.5)).toBe(0);
    expect(travel({ ease: "ease_in" }, 0.5)).toBe(0.125);
    near(valueAt([{ at: 0, value: 10, curve: [0.25, 0.1, 0.25, 1] }, { at: 20, value: 20 }], 10), 18.024);
  });
  it("is kept by the ops within its limits, and listed for agents", () => {
    const set = (curve: unknown) => run(sampleDoc(), patch("c1", { keyframes: { scale: [{ at: 0, value: 1, curve }, { at: 20, value: 2 }] } }));
    expect(c1(set([0.4, 0, 0.2, 1]).doc).keyframes!.scale![0].curve).toEqual([0.4, 0, 0.2, 1]);
    expect(() => set([1.2, 0, 0.2, 1])).toThrow(); // time cannot run backward
    expect(() => set([0.4, 0, 0.2, 9])).toThrow();
    expect(() => set([0.4, 0, 0.2])).toThrow();
    expect(describeDoc(set([0.4, 0, 0.2, 1]).doc, { detail: true })).toContain("kf.scale=0:1~curve(0.4 0 0.2 1),20:2");
  });
  it("is set from the list, and a named ease takes it off again", () => {
    const d = run(sampleDoc(), patch("c1", { keyframes: { opacity: [{ at: 0, value: 0, ease: "ease_out" }, { at: 20, value: 1 }] } })).doc;
    const curved = run(d, editKeyframeOps(c1(d), "opacity", 0, { curve: [0.123456, 0, 0.2, 1] })).doc;
    expect(c1(curved).keyframes!.opacity![0]).toEqual({ at: 0, value: 0, ease: "ease_out", curve: [0.123, 0, 0.2, 1] });
    expect(editKeyframeOps(c1(curved), "opacity", 0, { curve: [0.123, 0, 0.2, 1] })).toEqual([]);
    const named = run(curved, editKeyframeOps(c1(curved), "opacity", 0, { ease: "linear" })).doc;
    expect(c1(named).keyframes!.opacity![0]).toEqual({ at: 0, value: 0, ease: "linear" });
    const cleared = run(curved, editKeyframeOps(c1(curved), "opacity", 0, { curve: null })).doc;
    expect(c1(cleared).keyframes!.opacity![0]).toEqual({ at: 0, value: 0, ease: "ease_out" });
    // A value typed on a curved keyframe keeps its curve.
    expect(c1(run(curved, editKeyframeOps(c1(curved), "opacity", 0, { value: 0.5 })).doc).keyframes!.opacity![0].curve).toEqual([0.123, 0, 0.2, 1]);
  });
});

describe("a crop that changes over a clip", () => {
  const keyed = (keyframes: Record<string, unknown>, crop?: Record<string, number>) =>
    run(sampleDoc(), patch("c1", { keyframes, ...(crop && { transform: { crop: { left: 0, top: 0, right: 0, bottom: 0, ...crop } } }) })).doc;

  it("each side is a property a clip can key", () => {
    expect(KEYFRAME_PROPS.slice(-4)).toEqual(["cropLeft", "cropTop", "cropRight", "cropBottom"]);
    expect(CROP_PROPS.map(isCropProp)).toEqual([true, true, true, true]);
    expect(isCropProp("opacity")).toBe(false);
  });
  it("is the transform's crop with its keyed sides at their value there", () => {
    const d = keyed({ cropLeft: [{ at: 0, value: 0 }, { at: 10, value: 0.5 }] }, { top: 0.1 });
    const clip = c1(d);
    expect(effectiveTransform(clip, clip.start + 5).crop).toEqual({ left: 0.25, top: 0.1, right: 0, bottom: 0 });
    expect(effectiveTransform(clip, clip.start + 50).crop).toEqual({ left: 0.5, top: 0.1, right: 0, bottom: 0 });
    expect(propValue(clip, "cropLeft", clip.start + 5)).toBe(0.25);
    expect(propValue(clip, "cropTop", clip.start + 5)).toBe(0.1);
    // A clip with nothing keyed hands back its own transform.
    const plain = c1(sampleDoc());
    expect(effectiveTransform(plain, 5)).toBe(plain.transform);
  });
  it("always leaves a sliver, whatever two opposite sides say at one moment", () => {
    const d = keyed({ cropLeft: [{ at: 0, value: 0.9 }], cropRight: [{ at: 0, value: 0.9 }] });
    const crop = effectiveTransform(c1(d), c1(d).start).crop!;
    near(crop.left + crop.right, 0.98, 1e-9);
    near(crop.left, crop.right, 1e-9);
  });
  it("is refused out of range and on a shape, a sound and an adjustment layer", () => {
    const d = sampleDoc();
    d.tracks[3].clips = [video("m1", 0, 30, { type: "audio" })];
    expect(() => run(d, patch("c1", { keyframes: { cropTop: [{ at: 0, value: 0.96 }] } }))).toThrow(/cropTop keyframes must be between 0 and 0.95/);
    expect(() => run(d, patch("c1", { keyframes: { cropTop: [{ at: 0, value: -0.1 }] } }))).toThrow(/cropTop/);
    expect(() => run(d, patch("m1", { keyframes: { cropTop: [{ at: 0, value: 0.1 }] } }))).toThrow(/an audio clip takes/);
    expect(() => run(d, patch("x1", { keyframes: { cropTop: [{ at: 0, value: 0.1 }] } }))).not.toThrow(); // text can be cropped
  });
  it("the diamond keys the side at what it shows, and taking the last keyframe off keeps the crop", () => {
    const d = run(sampleDoc(), patch("c1", { transform: { crop: { left: 0.2, top: 0, right: 0, bottom: 0 } } })).doc;
    const start = c1(d).start;
    const added = run(d, toggleKeyframeOps(c1(d), "cropLeft", start + 3)).doc;
    expect(c1(added).keyframes).toEqual({ cropLeft: [{ at: 3, value: 0.2 }] });
    const moved = run(added, patch("c1", { keyframes: { cropLeft: [{ at: 3, value: 0.4 }] } })).doc;
    const removed = run(moved, toggleKeyframeOps(c1(moved), "cropLeft", start + 3)).doc;
    expect(c1(removed).keyframes).toEqual({ cropLeft: [] });
    expect(c1(removed).transform.crop).toEqual({ left: 0.4, top: 0, right: 0, bottom: 0 });
    expect(basePatch(c1(d), "cropTop", 0.3)).toEqual({ transform: { crop: { left: 0.2, top: 0.3, right: 0, bottom: 0 } } });
    expect(run(moved, deleteKeyframeOps(c1(moved), "cropLeft", 3)).doc.tracks[0].clips[0].transform.crop).toEqual({ left: 0.4, top: 0, right: 0, bottom: 0 });
  });
  it("a crop set at the playhead keys the keyed sides and sets the others on the clip", () => {
    const d = keyed({ cropLeft: [{ at: 0, value: 0 }, { at: 20, value: 0.5 }] });
    const start = c1(d).start;
    const ops = writeTransformOps(c1(d), start + 10, { crop: { left: 0.1, top: 0.3, right: 0, bottom: 0 } });
    expect(ops).toEqual(patch("c1", { transform: { crop: { left: 0, top: 0.3, right: 0, bottom: 0 } }, keyframes: { cropLeft: [{ at: 0, value: 0 }, { at: 10, value: 0.1 }, { at: 20, value: 0.5 }] } }));
    expect(() => run(d, ops)).not.toThrow();
    // With no side keyed it is the plain crop, as before.
    expect(writeTransformOps(c1(sampleDoc()), 5, { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } })).toEqual(patch("c1", { transform: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } }));
  });
  it("its fields show the side at the playhead and type a keyframe there", () => {
    const d = keyed({ cropRight: [{ at: 0, value: 0 }, { at: 10, value: 0.4 }] });
    const start = c1(d).start;
    const ctx = (playhead: number) => fieldContext(d, c1(d), undefined, null, playhead);
    const shown = (name: ClipField, playhead: number) => clipFieldValue(c1(d), name, ctx(playhead));
    expect([shown("cropRight", start + 5), shown("cropRight", start + 10), shown("cropLeft", start + 5)]).toEqual(["20", "40", "0"]);
    const typed = clipFieldOps(c1(d), "cropRight", "30", ctx(start + 5))!;
    expect(typed).toEqual(patch("c1", { keyframes: { cropRight: [{ at: 0, value: 0 }, { at: 5, value: 0.3 }, { at: 10, value: 0.4 }] } }));
  });
  it("Reset crop takes the keyed sides off with the crop", () => {
    const store = makeStore({ doc: keyed({ cropTop: [{ at: 0, value: 0.2 }] }, { left: 0.1 }) });
    resetCrop(store, "c1");
    expect(c1(store.getState().doc).transform.crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(c1(store.getState().doc).keyframes).toEqual({ cropTop: [] });
    const before = store.getState().queue.length;
    resetCrop(store, "c1");
    expect(store.getState().queue.length).toBe(before);
  });
  it("is drawn, and boxed on the canvas, as it is at the frame", () => {
    const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 1080, height: 1920 };
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [video("c", 0, 30, { keyframes: { cropLeft: [{ at: 0, value: 0 }, { at: 20, value: 0.5 }] } })];
    const drawnAt = (frame: number) => {
      const { ctx, calls } = fakeCtx();
      drawFrame(ctx, d, frame, { resolveSource: () => PICTURE });
      return calls.find(([name]) => name === "drawImage")!;
    };
    expect(drawnAt(0)).toEqual(["drawImage", PICTURE.image, -540, -960, 1080, 1920]); // not cropped yet
    expect(drawnAt(10)).toEqual(["drawImage", PICTURE.image, 270, 0, 810, 1920, -270, -960, 810, 1920]); // a quarter off the left
    const box = canvasItems(d, 10, { source: () => ({ width: 1080, height: 1920 }), measure: () => 0 })[0];
    expect(box.rect).toEqual({ left: -270, top: -960, right: 540, bottom: 960 });
  });
});
