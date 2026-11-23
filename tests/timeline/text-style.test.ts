import { describe, expect, it } from "vitest";
import { clipFieldOps, clipFieldValue, fieldContext, lookRange, type ClipField } from "@/lib/editor/inspector-fields";
import { BACKGROUND_START, TEXT_STYLE_DEFAULTS, applyOps, describe as describeDoc, hasBackground, hasOutline, hasShadow, outlineStart, prepareOps, shadowStart, textExtras, type Op, type OpInput, type TextClip, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc } from "../editor/fixtures";

// The sample project's x1 is "hi" at 64 px.
const x1 = (d: TimelineDoc) => d.tracks[1].clips[0] as TextClip;
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const style = (patch: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: "x1", patch: { style: patch } }];
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));
const field = (d: TimelineDoc, name: ClipField, raw: string) => clipFieldOps(x1(d), name, raw, fieldContext(d, x1(d)));
const shown = (d: TimelineDoc, name: ClipField) => clipFieldValue(x1(d), name, fieldContext(d, x1(d)));
const after = (d: TimelineDoc, name: ClipField, raw: string) => run(d, field(d, name, raw)!).doc;

describe("a text's optional style", () => {
  it("is all off until it is set", () => {
    const look = textExtras(x1(sampleDoc()).style);
    expect(look).toEqual(TEXT_STYLE_DEFAULTS);
    expect([hasOutline(look), hasShadow(look), hasBackground(look)]).toEqual([false, false, false]);
  });

  it("takes each field alone and keeps the rest of the style", () => {
    const d = run(sampleDoc(), style({ italic: true, letterSpacing: 0.1, outlineColor: "#112233", outlineWidth: 4 })).doc;
    expect(x1(d).style).toMatchObject({ fontFamily: "Geist", fontSize: 64, italic: true, letterSpacing: 0.1, outlineColor: "#112233", outlineWidth: 4 });
    expect(hasOutline(textExtras(x1(d).style))).toBe(true);
  });

  it("an undo takes a first-time field back to its default, and the redo sets it again", () => {
    const before = sampleDoc();
    const set = run(before, style({ shadowColor: "#000000", shadowBlur: 12 }));
    const undone = applyOps(set.doc, roundTrip(set.inverse));
    expect(textExtras(x1(undone.doc).style)).toEqual(TEXT_STYLE_DEFAULTS);
    expect(x1(undone.doc).style).toMatchObject({ shadowColor: null, shadowBlur: 0 });
    const redone = applyOps(undone.doc, roundTrip(undone.inverse));
    expect(x1(redone.doc).style).toMatchObject({ shadowColor: "#000000", shadowBlur: 12 });
  });

  it("refuses values out of range and keys it does not know", () => {
    const d = sampleDoc();
    expect(() => run(d, style({ lineHeight: 0.2 }))).toThrow(/lineHeight/);
    expect(() => run(d, style({ letterSpacing: 5 }))).toThrow(/letterSpacing/);
    expect(() => run(d, style({ outlineColor: "black" }))).toThrow(/outlineColor/);
    expect(() => run(d, style({ shadowOpacity: 2 }))).toThrow(/shadowOpacity/);
    expect(() => run(d, style({ glow: true }))).toThrow();
  });

  it("an expect guards one field of the look", () => {
    const d = run(sampleDoc(), style({ italic: true })).doc;
    const guarded = (expectItalic: boolean): OpInput[] => [{ op: "update_clip", clipId: "x1", patch: { style: { italic: false } }, expect: { style: { italic: expectItalic } } }];
    expect(x1(run(d, guarded(true)).doc).style.italic).toBe(false);
    expect(() => run(d, guarded(false))).toThrow();
    // A field never set holds its default.
    const fresh: OpInput[] = [{ op: "update_clip", clipId: "x1", patch: { style: { underline: true } }, expect: { style: { underline: false } } }];
    expect(x1(run(sampleDoc(), fresh).doc).style.underline).toBe(true);
  });

  it("is listed for agents only where it is set", () => {
    expect(describeDoc(sampleDoc(), { detail: true })).not.toMatch(/italic|outline|shadow|background/);
    const d = run(sampleDoc(), style({ italic: true, outlineColor: "#000000", outlineWidth: 5, shadowColor: null })).doc;
    expect(describeDoc(d, { detail: true })).toContain('italic=true outlineColor="#000000" outlineWidth=5');
  });
});

describe("the inspector's fields for a text's look", () => {
  it("show what the text has, in percents, multiples and pixels", () => {
    const d = run(sampleDoc(), style({ letterSpacing: 0.125, lineHeight: 1.5, outlineColor: "#AA0000", outlineWidth: 3, backgroundColor: "#000000", backgroundOpacity: 0.8 })).doc;
    expect((["italic", "letterSpacing", "lineHeight", "outline", "outlineColor", "outlineWidth", "shadow", "shadowColor", "background", "backgroundOpacity", "backgroundPadding"] as const).map((f) => shown(d, f)))
      .toEqual(["off", "12.5", "1.5", "on", "#aa0000", "3", "off", "", "on", "80", "30"]);
    expect(shown(sampleDoc(), "lineHeight")).toBe("1.2");
  });

  it("Italic and Underline switch on and off", () => {
    const d = after(sampleDoc(), "italic", "on");
    expect(x1(d).style.italic).toBe(true);
    expect(field(d, "italic", "on")).toEqual([]);
    expect(x1(after(d, "italic", "off")).style.italic).toBe(false);
    expect(field(d, "underline", "maybe")).toBeNull();
  });

  it("numbers are kept in range", () => {
    expect(x1(after(sampleDoc(), "letterSpacing", "10")).style.letterSpacing).toBe(0.1);
    expect(x1(after(sampleDoc(), "letterSpacing", "999")).style.letterSpacing).toBe(2);
    expect(x1(after(sampleDoc(), "lineHeight", "0.1")).style.lineHeight).toBe(0.5);
    expect(x1(after(sampleDoc(), "shadowY", "-12.34")).style.shadowY).toBe(-12.3);
    expect(x1(after(sampleDoc(), "backgroundOpacity", "45")).style.backgroundOpacity).toBe(0.45);
    expect(field(sampleDoc(), "outlineWidth", "thick")).toBeNull();
    expect(field(sampleDoc(), "lineHeight", "1.2")).toEqual([]);
    expect(lookRange("shadowOpacity")).toEqual({ min: 0, max: 100 });
    expect(lookRange("fontSize")).toBeNull();
  });

  it("Outline turns on with a width that suits the text, and comes back as it was", () => {
    const on = after(sampleDoc(), "outline", "on");
    expect(x1(on).style).toMatchObject(outlineStart(64));
    expect(outlineStart(64)).toEqual({ outlineColor: "#000000", outlineWidth: 5 });
    const wide = after(after(on, "outlineWidth", "20"), "outlineColor", "#FF0000");
    const off = after(wide, "outline", "off");
    expect(x1(off).style).toMatchObject({ outlineColor: null, outlineWidth: 20 });
    expect(x1(after(off, "outline", "on")).style).toMatchObject({ outlineColor: "#000000", outlineWidth: 20 });
    expect(field(on, "outline", "on")).toEqual([]);
  });

  it("Shadow and Background turn on with a look of their own", () => {
    const shadowed = after(sampleDoc(), "shadow", "on");
    expect(x1(shadowed).style).toMatchObject(shadowStart(64));
    expect(hasShadow(textExtras(x1(shadowed).style))).toBe(true);
    const moved = after(after(shadowed, "shadowY", "30"), "shadow", "off");
    expect(x1(after(moved, "shadow", "on")).style).toMatchObject({ shadowColor: "#000000", shadowY: 30 });
    const boxed = after(sampleDoc(), "background", "on");
    expect(x1(boxed).style).toMatchObject(BACKGROUND_START);
    expect(hasBackground(textExtras(x1(after(boxed, "background", "off")).style))).toBe(false);
  });

  it("a colour must be a hex colour", () => {
    const on = after(sampleDoc(), "background", "on");
    expect(x1(after(on, "backgroundColor", "#00FF88")).style.backgroundColor).toBe("#00ff88");
    expect(field(on, "backgroundColor", "green")).toBeNull();
  });

  it("means nothing on a clip that is not text", () => {
    const d = sampleDoc();
    const c1 = d.tracks[0].clips[0];
    expect(clipFieldOps(c1, "italic", "on", fieldContext(d, c1))).toBeNull();
    expect(clipFieldValue(c1, "outlineColor", fieldContext(d, c1))).toBe("");
  });
});
