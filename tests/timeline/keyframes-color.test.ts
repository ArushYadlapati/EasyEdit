import { describe, expect, it } from "vitest";
import { toggleKeyframeOps, writeAdjustOps } from "@/lib/editor/keyframe-edit";
import { clipFieldOps, clipFieldValue, fieldContext, type ClipField } from "@/lib/editor/inspector-fields";
import { findClip } from "@/lib/editor/store";
import { drawFrame, type ResolvedSource } from "@/lib/render/compositor";
import { ADJUST_KEYS, KEYFRAME_PROPS, adjustAt, applyOps, basePatch, describe as describeDoc, isAdjustProp, prepareOps, propValue, type ColorClip, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx } from "../render/fake-ctx";

const c1 = (d: TimelineDoc) => findClip(d, "c1")!.clip as MediaClip;
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const patch = (clipId: string, p: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId, patch: p }];
const keyed = (keyframes: Record<string, unknown>, adjust: Record<string, number> = {}) => run(sampleDoc(), patch("c1", { adjust, keyframes })).doc;

describe("a picture's colours over time", () => {
  it("every colour change and stylised effect can be keyed", () => {
    expect(KEYFRAME_PROPS).toEqual(["x", "y", "scale", "rotation", "opacity", "volume", ...ADJUST_KEYS]);
    expect([isAdjustProp("blur"), isAdjustProp("vhs"), isAdjustProp("opacity"), isAdjustProp("volume")]).toEqual([true, true, false, false]);
  });
  it("travel between their keyframes, and hold the nearest outside them", () => {
    const d = keyed({ brightness: [{ at: 0, value: 0 }, { at: 10, value: 1 }], grain: [{ at: 5, value: 0.5, ease: "hold" }, { at: 8, value: 1 }] }, { contrast: 0.3, brightness: -1 });
    const clip = c1(d);
    const at = (frame: number) => adjustAt(clip, clip.start + frame);
    expect(at(5).brightness).toBeCloseTo(0.5);
    expect(at(-3).brightness).toBe(0);
    expect(at(40).brightness).toBe(1);
    expect([at(0).grain, at(7).grain, at(8).grain]).toEqual([0.5, 0.5, 1]);
    // One not keyed keeps the clip's own value, and the rest stay 0.
    expect(at(5).contrast).toBe(0.3);
    expect(at(5).vhs).toBe(0);
    expect(propValue(clip, "brightness", clip.start + 5)).toBeCloseTo(0.5);
    expect(propValue(clip, "contrast", clip.start + 5)).toBe(0.3);
    expect(basePatch("hue", 20)).toEqual({ adjust: { hue: 20 } });
    expect(adjustAt(findClip(d, "x1")!.clip, 0).brightness).toBe(0);
  });
  it("stay in the colour's own range, on pictures only", () => {
    const d = sampleDoc();
    d.tracks[3].clips = [video("m1", 0, 30, { type: "audio" })];
    expect(() => run(d, patch("c1", { keyframes: { brightness: [{ at: 0, value: 1.5 }] } }))).toThrow(/brightness keyframes must be in brightness's own range/);
    expect(() => run(d, patch("c1", { keyframes: { pixelate: [{ at: 0, value: -1 }] } }))).toThrow(/pixelate/);
    expect(() => run(d, patch("c1", { keyframes: { hue: [{ at: 0, value: 170 }, { at: 9, value: -170 }], pixelate: [{ at: 0, value: 120 }] } }))).not.toThrow();
    expect(() => run(d, patch("x1", { keyframes: { blur: [{ at: 0, value: 3 }] } }))).toThrow(/only a video or image takes blur keyframes/);
    expect(() => run(d, patch("m1", { keyframes: { grain: [{ at: 0, value: 0.3 }] } }))).toThrow(/only a video or image takes grain keyframes/);
  });
  it("undo to not keyed, move with a trim from the start, and are split onto both pieces", () => {
    const set = run(sampleDoc(), patch("c1", { keyframes: { vignette: [{ at: 0, value: 0 }, { at: 20, value: 1 }] } }));
    const undone = applyOps(set.doc, JSON.parse(JSON.stringify(set.inverse))).doc;
    expect(c1(undone).keyframes).toEqual({ vignette: [] });
    const start = c1(set.doc).start;
    const trimmed = run(set.doc, [{ op: "trim_clip", clipId: "c1", edge: "start", to: start + 4 }]).doc;
    expect(c1(trimmed).keyframes!.vignette).toEqual([{ at: -4, value: 0 }, { at: 16, value: 1 }]);
    const split = run(set.doc, [{ op: "split_clip", clipId: "c1", at: start + 10, newClipId: "c1b" }]).doc;
    expect((findClip(split, "c1b")!.clip as MediaClip).keyframes!.vignette).toEqual([{ at: -10, value: 0 }, { at: 10, value: 1 }]);
    expect(adjustAt(findClip(split, "c1b")!.clip, start + 10).vignette).toBeCloseTo(0.5);
  });
  it("are listed for agents", () => {
    const d = keyed({ saturation: [{ at: 0, value: -1 }, { at: 15, value: 0, ease: "ease_out" }] });
    expect(describeDoc(d, { detail: true })).toContain("kf.saturation=0:-1,15:0~ease_out");
    expect(describeDoc(d)).toContain("kf=saturation");
  });
});

describe("keying a colour from the editor", () => {
  const field = (d: TimelineDoc, name: ClipField, raw: string, playhead: number) => clipFieldOps(c1(d), name, raw, fieldContext(d, c1(d), undefined, null, playhead));
  const shown = (d: TimelineDoc, name: ClipField, playhead: number) => clipFieldValue(c1(d), name, fieldContext(d, c1(d), undefined, null, playhead));

  it("the diamond adds a keyframe with the value shown, and taking the last one off keeps that value", () => {
    const d = run(sampleDoc(), patch("c1", { adjust: { blur: 6 } })).doc;
    const start = c1(d).start;
    const added = run(d, toggleKeyframeOps(c1(d), "blur", start + 3)).doc;
    expect(c1(added).keyframes).toEqual({ blur: [{ at: 3, value: 6 }] });
    const changed = run(added, patch("c1", { keyframes: { blur: [{ at: 3, value: 20 }] } })).doc;
    const removed = run(changed, toggleKeyframeOps(c1(changed), "blur", start + 3)).doc;
    expect(c1(removed).keyframes).toEqual({ blur: [] });
    expect(c1(removed).adjust!.blur).toBe(20);
  });
  it("a keyed field shows the value at the playhead and types a keyframe there", () => {
    const d = keyed({ brightness: [{ at: 0, value: 0 }, { at: 10, value: 1 }] });
    const start = c1(d).start;
    expect(shown(d, "brightness", start + 5)).toBe("50");
    expect(shown(d, "brightness", start + 500)).toBe("100"); // past the clip: its last frame
    expect(field(d, "brightness", "50", start + 5)).toEqual([]);
    expect(field(d, "brightness", "20", start + 5)).toEqual(patch("c1", { keyframes: { brightness: [{ at: 0, value: 0 }, { at: 5, value: 0.2 }, { at: 10, value: 1 }] } }));
    // One that is not keyed is set on the clip, as before.
    expect(field(d, "contrast", "20", start + 5)).toEqual(patch("c1", { adjust: { contrast: 0.2 } }));
    expect(writeAdjustOps(c1(d) as ColorClip, start + 10, "brightness", 0.4)).toEqual(patch("c1", { keyframes: { brightness: [{ at: 0, value: 0 }, { at: 10, value: 0.4 }] } }));
  });
});

describe("drawing a keyed colour", () => {
  const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 1080, height: 1920 };
  const filterAt = (frame: number) => {
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [video("c", 0, 30, { adjust: { brightness: -1 }, keyframes: { brightness: [{ at: 0, value: 0 }, { at: 20, value: 1 }] } })];
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, frame, { resolveSource: () => PICTURE });
    return calls.find(([name]) => name === "set filter")?.[1] ?? null;
  };
  it("uses the value at the frame being drawn, not the clip's own", () => {
    expect(filterAt(0)).toBeNull(); // 0 at its first keyframe: as recorded
    expect(filterAt(10)).toBe("brightness(1.5)");
    expect(filterAt(25)).toBe("brightness(2)");
  });
});
