import { describe, expect, it } from "vitest";
import { applyLook } from "@/lib/editor/actions";
import { ADJUST_RANGE, clipFieldOps, clipFieldValue, fieldContext, type ClipField } from "@/lib/editor/inspector-fields";
import { findClip } from "@/lib/editor/store";
import { BLEND_LABEL, BLEND_MODES, LOOKS, NO_ADJUST, adjustOf, applyOps, describe as describeDoc, isAdjusted, lookMatch, lookOf, lookPatch, prepareOps, type MediaClip, type Op, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, video } from "../editor/fixtures";

const c1 = (d: TimelineDoc) => findClip(d, "c1")!.clip as MediaClip;
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const patch = (clipId: string, p: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId, patch: p }];
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));
const field = (d: TimelineDoc, name: ClipField, raw: string, id = "c1") => {
  const clip = findClip(d, id)!.clip;
  return clipFieldOps(clip, name, raw, fieldContext(d, clip));
};
const shown = (d: TimelineDoc, name: ClipField, id = "c1") => clipFieldValue(findClip(d, id)!.clip, name, fieldContext(d, findClip(d, id)!.clip));

describe("a picture's colours in the ops", () => {
  it("set one at a time and keep the others", () => {
    const one = run(sampleDoc(), patch("c1", { adjust: { brightness: 0.2 } })).doc;
    const two = run(one, patch("c1", { adjust: { contrast: -0.3 } })).doc;
    expect(c1(two).adjust).toEqual({ brightness: 0.2, contrast: -0.3 });
    expect(adjustOf(c1(two).adjust)).toEqual({ ...NO_ADJUST, brightness: 0.2, contrast: -0.3 });
    expect([isAdjusted(undefined), isAdjusted({}), isAdjusted({ blur: 0 }), isAdjusted(c1(two).adjust)]).toEqual([false, false, false, true]);
  });

  it("undo to as recorded and redo", () => {
    const before = sampleDoc();
    const set = run(before, patch("c1", { adjust: { saturation: -1, vignette: 0.4 } }));
    const undone = applyOps(set.doc, roundTrip(set.inverse));
    expect(isAdjusted(c1(undone.doc).adjust)).toBe(false);
    expect(c1(applyOps(undone.doc, roundTrip(undone.inverse)).doc).adjust).toMatchObject({ saturation: -1, vignette: 0.4 });
  });

  it("stay in range, on pictures only", () => {
    const d = sampleDoc();
    d.tracks[3].clips = [video("m1", 0, 30, { type: "audio" })];
    expect(() => run(d, patch("c1", { adjust: { brightness: 2 } }))).toThrow(/brightness/);
    expect(() => run(d, patch("c1", { adjust: { blur: -1 } }))).toThrow(/blur/);
    expect(() => run(d, patch("c1", { adjust: { glow: 1 } }))).toThrow();
    expect(() => run(d, patch("m1", { adjust: { brightness: 0.1 } }))).toThrow(/"adjust" is not allowed on an audio clip/);
    expect(() => run(d, patch("x1", { adjust: { brightness: 0.1 } }))).toThrow(/"adjust" is not allowed on a text clip/);
  });

  it("an expect guards one of them, and one never set counts as 0", () => {
    const guarded: OpInput[] = [{ op: "update_clip", clipId: "c1", patch: { adjust: { hue: 30 } }, expect: { adjust: { hue: 0 } } }];
    const after = run(sampleDoc(), guarded).doc;
    expect(c1(after).adjust?.hue).toBe(30);
    expect(() => run(after, guarded)).toThrow();
  });

  it("blend and flip are set, undone and refused where they mean nothing", () => {
    const d = sampleDoc();
    d.tracks[3].clips = [video("m1", 0, 30, { type: "audio" })];
    const set = run(d, [...patch("c1", { blend: "screen", transform: { flipH: true } }), ...patch("x1", { blend: "multiply" })]);
    expect(c1(set.doc)).toMatchObject({ blend: "screen", transform: { flipH: true } });
    expect(findClip(set.doc, "x1")!.clip).toMatchObject({ blend: "multiply" });
    const undone = applyOps(set.doc, roundTrip(set.inverse)).doc;
    expect(c1(undone)).toMatchObject({ blend: "normal", transform: { flipH: false } });
    expect(() => run(d, patch("m1", { blend: "screen" }))).toThrow(/"blend" is not allowed on an audio clip/);
    expect(() => run(d, patch("c1", { blend: "sparkle" }))).toThrow(/blend/);
  });

  it("are listed for agents where they are set", () => {
    expect(describeDoc(sampleDoc(), { detail: true })).not.toMatch(/adjust|blend|flip/);
    const d = run(sampleDoc(), patch("c1", { adjust: { brightness: 0.2, blur: 0, hue: -10 }, blend: "add", transform: { flipV: true } })).doc;
    const said = describeDoc(d, { detail: true });
    expect(said).toContain('adjust={"brightness":0.2,"hue":-10}');
    expect(said).toContain("blend=add");
    expect(said).toContain("flipV=true");
  });
});

describe("looks", () => {
  it("each has a name and sets colours within range", () => {
    expect(LOOKS.map((l) => l.label)).toEqual(["Vivid", "Pop", "Warm", "Golden", "Cool", "Dusk", "Soft", "Fade", "Vintage", "Moody", "Drama", "B&W", "Noir", "Sepia"]);
    for (const look of LOOKS) expect(() => run(sampleDoc(), patch("c1", { adjust: lookPatch(look) }))).not.toThrow();
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
  });

  it("a look sets every colour and leaves the blur", () => {
    const store = makeStore();
    store.getState().edit(patch("c1", { adjust: { blur: 12, hue: 90 } }), "color change");
    applyLook(store, "c1", "mono");
    const now = c1(store.getState().doc).adjust!;
    expect(now).toMatchObject({ saturation: -1, contrast: 0.15, hue: 0, blur: 12 });
    expect(lookOf(now)).toBe("mono");
    applyLook(store, "c1", null);
    expect(lookOf(c1(store.getState().doc).adjust)).toBe("none");
    expect(c1(store.getState().doc).adjust!.blur).toBe(12);
    store.getState().undo();
    expect(lookOf(c1(store.getState().doc).adjust)).toBe("mono");
  });

  it("the look in use is the one the colours match exactly", () => {
    expect(lookOf(undefined)).toBe("none");
    expect(lookOf({ blur: 30 })).toBe("none");
    expect(lookOf(lookPatch(LOOKS[0]))).toBe("vivid");
    expect(lookOf({ ...lookPatch(LOOKS[0]), brightness: 0.01 })).toBeNull();
  });

  it("a look at part strength is still that look, and no look is a part of another", () => {
    for (const look of LOOKS) {
      for (const strength of [1, 0.75, 0.5, 0.2, 0.05]) {
        expect(lookMatch(lookPatch(look, strength))).toEqual({ id: look.id, strength });
      }
      expect(() => run(sampleDoc(), patch("c1", { adjust: lookPatch(look, 0.33) }))).not.toThrow();
    }
    expect(lookMatch(lookPatch(LOOKS[0], 0))).toEqual({ id: "none", strength: 1 });
    // Past the whole look, or one colour off it, it is nobody's.
    expect(lookMatch({ contrast: 0.3, saturation: 0.7 })).toBeNull();
    expect(lookMatch({ ...lookPatch(LOOKS[0], 0.5), vignette: 0.01 })).toBeNull();
  });

  it("the strength field shows a look's share and sets every colour to it", () => {
    const d = run(sampleDoc(), patch("c1", { adjust: { ...lookPatch(LOOKS.find((l) => l.id === "vintage")!), blur: 6 } })).doc;
    expect(shown(d, "lookStrength")).toBe("100");
    expect(shown(sampleDoc(), "lookStrength")).toBe(""); // no look, no strength
    expect(shown(d, "lookStrength", "x1")).toBe("");
    const half = field(d, "lookStrength", "50")!;
    expect(half).toEqual(patch("c1", { adjust: { brightness: 0, contrast: -0.05, saturation: -0.125, temperature: 0.15, hue: 0, vignette: 0.225 } }));
    const halved = run(d, half).doc;
    expect(shown(halved, "lookStrength")).toBe("50");
    expect(lookOf(c1(halved).adjust)).toBe("vintage");
    expect(c1(halved).adjust!.blur).toBe(6);
    expect(field(halved, "lookStrength", "50")).toEqual([]);
    expect(field(halved, "lookStrength", "250")).toEqual(patch("c1", { adjust: lookPatch(LOOKS.find((l) => l.id === "vintage")!) }));
    expect(lookOf(c1(run(halved, field(halved, "lookStrength", "0")!).doc).adjust)).toBe("none");
    expect(field(sampleDoc(), "lookStrength", "50")).toBeNull();
    expect(field(run(sampleDoc(), patch("c1", { adjust: { hue: 33 } })).doc, "lookStrength", "50")).toBeNull();
  });

  it("the same look twice, an unknown look, a clip with no picture or a viewer changes nothing", () => {
    const store = makeStore();
    applyLook(store, "c1", "warm");
    const version = store.getState().queue.length;
    applyLook(store, "c1", "warm");
    applyLook(store, "c1", "nope");
    applyLook(store, "x1", "warm");
    expect(store.getState().queue.length).toBe(version);
    const viewer = makeStore({ canEdit: false });
    applyLook(viewer, "c1", "warm");
    expect(isAdjusted(c1(viewer.getState().doc).adjust)).toBe(false);
  });
});

describe("the inspector's colour, flip and blend fields", () => {
  it("show percents, degrees and pixels, and nothing for a clip with no picture", () => {
    const d = run(sampleDoc(), patch("c1", { adjust: { brightness: 0.25, hue: -30, blur: 4.5 }, transform: { flipH: true } })).doc;
    expect((["brightness", "contrast", "hue", "blur", "flipH", "flipV", "blend"] as const).map((f) => shown(d, f))).toEqual(["25", "0", "-30", "4.5", "on", "off", "normal"]);
    expect((["brightness", "flipH", "blend"] as const).map((f) => shown(d, f, "x1"))).toEqual(["", "", "normal"]);
  });

  it("set one colour, kept in range", () => {
    const d = sampleDoc();
    expect(field(d, "saturation", "40")).toEqual(patch("c1", { adjust: { saturation: 0.4 } }));
    expect(field(d, "brightness", "500")).toEqual(patch("c1", { adjust: { brightness: 1 } }));
    expect(field(d, "vignette", "-20")).toEqual([]); // kept at 0, where it is
    expect(field(d, "hue", "200")).toEqual(patch("c1", { adjust: { hue: 180 } }));
    expect(field(d, "blur", "7.25")).toEqual(patch("c1", { adjust: { blur: 7.25 } }));
    expect(field(d, "contrast", "lots")).toBeNull();
    expect(field(d, "contrast", "10", "x1")).toBeNull();
    expect(ADJUST_RANGE.blur).toEqual({ min: 0, max: 200, per: 1 });
    for (const ops of [field(d, "saturation", "40"), field(d, "blur", "7.25")]) expect(() => run(d, ops!)).not.toThrow();
  });

  it("flip a picture and pick a blend", () => {
    const d = sampleDoc();
    expect(field(d, "flipH", "on")).toEqual(patch("c1", { transform: { flipH: true } }));
    expect(field(d, "flipH", "off")).toEqual([]);
    expect(field(d, "flipV", "sideways")).toBeNull();
    expect(field(d, "flipH", "on", "x1")).toBeNull();
    expect(field(d, "blend", "overlay")).toEqual(patch("c1", { blend: "overlay" }));
    expect(field(d, "blend", "overlay", "x1")).toEqual(patch("x1", { blend: "overlay" }));
    expect(field(d, "blend", "normal")).toEqual([]);
    expect(field(d, "blend", "glitter")).toBeNull();
    expect(BLEND_MODES.every((mode) => BLEND_LABEL[mode].length > 0)).toBe(true);
    expect(BLEND_MODES[0]).toBe("normal");
  });
});
