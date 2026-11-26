import { describe, expect, it } from "vitest";
import { colorStretchOps, plainStretchOps, stretchLook, toggleStretchOps } from "@/lib/editor/text-spans";
import type { TextClip, TextSpan } from "@/lib/timeline";
import { text } from "./fixtures";

// "the big robot" in Geist at 400, white.
const clip = (spans: TextSpan[] | null = null, style: Record<string, unknown> = {}): TextClip => {
  const base = text("x1", 0, 60, { text: "the big robot" }) as TextClip;
  return { ...base, style: { ...base.style, fontFamily: "Geist", fontWeight: 400, color: "#ffffff", ...style }, spans };
};
const BIG = { from: 4, to: 7 };
const spansOf = (ops: ReturnType<typeof toggleStretchOps>) => (ops[0] as unknown as { patch: { spans: TextSpan[] | null } } | undefined)?.patch.spans;

describe("what a stretch looks like", () => {
  it("is the clip's own look where no span lies over it", () => {
    expect(stretchLook(clip(), BIG)).toEqual({ bold: false, italic: false, underline: false, color: "#ffffff" });
    expect(stretchLook(clip(null, { fontWeight: 700, italic: true }), BIG)).toMatchObject({ bold: true, italic: true });
  });
  it("is bold, italic or underlined only when all of it is, and has a colour only when it has one throughout", () => {
    const partly = clip([{ from: 4, to: 6, fontWeight: 700, color: "#ff0000" }]);
    expect(stretchLook(partly, { from: 4, to: 6 })).toMatchObject({ bold: true, color: "#ff0000" });
    expect(stretchLook(partly, BIG)).toMatchObject({ bold: false, color: null });
  });
});

describe("switching bold, italic and underline for a stretch", () => {
  it("turns it on with a span, and off again leaving no trace", () => {
    const on = toggleStretchOps(clip(), BIG, "bold");
    expect(on).toEqual([{ op: "update_clip", clipId: "x1", patch: { spans: [{ from: 4, to: 7, fontWeight: 700 }] } }]);
    expect(spansOf(toggleStretchOps(clip(spansOf(on)), BIG, "bold"))).toBeNull();
    expect(spansOf(toggleStretchOps(clip(), BIG, "italic"))).toEqual([{ from: 4, to: 7, italic: true }]);
    expect(spansOf(toggleStretchOps(clip(), BIG, "underline"))).toEqual([{ from: 4, to: 7, underline: true }]);
  });
  it("in a bold text makes the stretch lighter, and bold again records nothing", () => {
    const heavy = clip(null, { fontWeight: 700 });
    const lighter = spansOf(toggleStretchOps(heavy, BIG, "bold"));
    expect(lighter).toEqual([{ from: 4, to: 7, fontWeight: 400 }]);
    expect(spansOf(toggleStretchOps(clip(lighter, { fontWeight: 700 }), BIG, "bold"))).toBeNull();
    const slanted = clip(null, { italic: true });
    expect(spansOf(toggleStretchOps(slanted, BIG, "italic"))).toEqual([{ from: 4, to: 7, italic: false }]);
  });
  it("turns the whole stretch on when only part of it is", () => {
    const partly = clip([{ from: 4, to: 5, fontWeight: 700 }]);
    expect(spansOf(toggleStretchOps(partly, BIG, "bold"))).toEqual([{ from: 4, to: 7, fontWeight: 700 }]);
  });
  it("does nothing for an empty stretch", () => {
    expect(toggleStretchOps(clip(), { from: 3, to: 3 }, "bold")).toEqual([]);
    expect(colorStretchOps(clip(), { from: 3, to: 3 }, "#ff0000")).toEqual([]);
  });
});

describe("a stretch's colour, and back to plain", () => {
  it("is recorded unless it is the clip's own", () => {
    expect(spansOf(colorStretchOps(clip(), BIG, "#ff0000"))).toEqual([{ from: 4, to: 7, color: "#ff0000" }]);
    expect(colorStretchOps(clip(), BIG, "#FFFFFF")).toEqual([]);
    expect(spansOf(colorStretchOps(clip([{ from: 4, to: 7, color: "#ff0000", fontWeight: 700 }]), BIG, "#ffffff"))).toEqual([{ from: 4, to: 7, fontWeight: 700 }]);
  });
  it("plain clears the stretch, or every span when nothing is selected", () => {
    const two = clip([{ from: 0, to: 3, italic: true }, { from: 4, to: 7, fontWeight: 700, color: "#ff0000" }]);
    expect(spansOf(plainStretchOps(two, BIG))).toEqual([{ from: 0, to: 3, italic: true }]);
    expect(spansOf(plainStretchOps(two, null))).toBeNull();
    expect(plainStretchOps(clip(), null)).toEqual([]);
  });
});
