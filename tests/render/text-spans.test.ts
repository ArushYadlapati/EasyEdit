import { describe, expect, it } from "vitest";
import { drawFrame, type Ctx2D } from "@/lib/render/compositor";
import { layoutText, textRect, type StyledMeasure } from "@/lib/render/text-layout";
import type { TextClip, TextSpan } from "@/lib/timeline";
import { text } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx } from "./fake-ctx";

type Call = [string, ...unknown[]];
// A canvas whose letters are half their font size wide, and a fifth wider again when bold: enough to see that each
// stretch is measured in its own font.
function weighedCtx(): { ctx: Ctx2D; calls: Call[] } {
  const calls: Call[] = [];
  const props: Record<string, unknown> = { font: "400 10px sans-serif" };
  const ctx = new Proxy({}, {
    get(_target, key: string) {
      if (key === "measureText") {
        return (s: string) => {
          const font = String(props.font);
          const px = parseFloat(/([\d.]+)px/.exec(font)![1]);
          const weight = Number(/(\d{3}) /.exec(font)?.[1] ?? 400);
          return { width: (s.length * px * (weight >= 600 ? 1.2 : 1)) / 2 };
        };
      }
      if (key === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (key in props) return props[key];
      return (...args: unknown[]) => { calls.push([key, ...args]); };
    },
    set(_target, key: string, value: unknown) {
      props[key] = value;
      calls.push([`set ${key}`, value]);
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx2D, calls };
}

// "the big robot" at 100 px and weight 400, centred: plain letters are 50 wide, bold ones 60.
const titled = (spans: TextSpan[] | null, extra: Record<string, unknown> = {}, style: Record<string, unknown> = {}): TextClip => {
  const base = text("t", 0, 30, { text: "the big robot", ...extra }) as TextClip;
  return { ...base, style: { ...base.style, fontSize: 100, fontWeight: 400, ...style }, spans };
};
const BOLD_BIG: TextSpan[] = [{ from: 4, to: 7, fontWeight: 700 }];
const RED_ROBOT: TextSpan[] = [{ from: 8, to: 13, color: "#ff0000" }];
const styled: StyledMeasure = (s, span) => (s.length * 100 * ((span?.fontWeight ?? 400) >= 600 ? 1.2 : 1)) / 2;
const plain = (s: string) => (s.length * 100) / 2;

function drawn(clip: TextClip, frame = 10, width = 1920) {
  const doc = docWithCaptions("long_16x9");
  doc.width = width;
  doc.tracks[1].clips = [clip];
  const { ctx, calls } = weighedCtx();
  drawFrame(ctx, doc, frame);
  // What was written, with the font and colour it was written in.
  const out: { text: string; x: number; font: string; fill: string }[] = [];
  let font = "";
  let fill = "";
  for (const call of calls) {
    if (call[0] === "set font") font = String(call[1]);
    if (call[0] === "set fillStyle") fill = String(call[1]);
    if (call[0] === "fillText") out.push({ text: String(call[1]), x: Number(call[2]), font: font.replace(/px .*/, "px"), fill });
  }
  return { out, calls };
}

describe("laying out a text with styled spans", () => {
  it("measures each stretch in its own look: a bold word makes its line wider", () => {
    const [line] = layoutText(titled(BOLD_BIG), 1920, plain, styled);
    expect(line.text).toBe("the big robot");
    // 10 plain letters and spaces at 50, 3 bold at 60.
    expect(line.width).toBe(10 * 50 + 3 * 60);
    expect(line.cells!.map((c) => c.g).join("")).toBe("the big robot");
    expect(line.cells!.filter((c) => c.span).map((c) => c.g).join("")).toBe("big");
    expect(line.cells!.map((c) => c.word)).toEqual([0, 0, 0, -1, 1, 1, 1, -1, 2, 2, 2, 2, 2]);
    expect(line.cells![5].at).toBe(5);
  });
  it("wraps where the styled words stop fitting, which is sooner than the plain ones would", () => {
    // A box of 0.9 × 720 = 648: plain, "the big robot" is 650 wide and "the big" fits a line of its own with "robot" under.
    const narrow = (spans: TextSpan[] | null) => layoutText(titled(spans), 720, plain, styled).map((l) => l.text);
    expect(narrow(null)).toEqual(["the big", "robot"]);
    // All bold, "the big" is 420 wide and still fits that box.
    expect(narrow([{ from: 0, to: 13, fontWeight: 700 }])).toEqual(["the big", "robot"]);
    // In a box of 0.9 × 400 = 360, plain "the big" (350) fits a line; with "big" bold it is 380 and does not.
    expect(layoutText(titled(null), 400, plain).map((l) => l.text)).toEqual(["the big", "robot"]);
    expect(layoutText(titled(BOLD_BIG), 400, plain, styled).map((l) => l.text)).toEqual(["the", "big", "robot"]);
  });
  it("keeps line breaks, empty lines and words too long for the box as the plain layout does", () => {
    const broken = titled([{ from: 0, to: 3, italic: true }], { text: "the\n\nbig robot" });
    expect(layoutText(broken, 1920, plain, styled).map((l) => l.text)).toEqual(["the", "", "big robot"]);
    const long = titled([{ from: 0, to: 2, color: "#ff0000" }], { text: "abcdefghij" });
    const cut = layoutText(long, 200, plain, styled).map((l) => l.text); // a box of 180: three letters a line
    expect(cut).toEqual(layoutText({ ...long, spans: null }, 200, plain).map((l) => l.text));
    expect(cut).toEqual(["abc", "def", "ghi", "j"]);
  });
  it("without a styled measure, or without spans, is laid out exactly as before", () => {
    const bare = layoutText(titled(BOLD_BIG), 1920, plain);
    expect(bare).toEqual([{ text: "the big robot", x: 0, y: 0 }]);
    expect(layoutText(titled(null), 1920, plain, styled)).toEqual(bare);
    expect(layoutText(titled([]), 1920, plain, styled)).toEqual(bare);
  });
  it("boxes the text by its styled width", () => {
    const box = textRect(titled(BOLD_BIG), 1920, plain, styled);
    expect([box.left, box.right]).toEqual([-340, 340]);
    expect(textRect(titled(BOLD_BIG), 1920, plain).right).toBe(325);
  });
});

// The lines drawn under letters: every filled box but the frame's own background.
const underlines = (calls: Call[]) => calls.filter((c) => c[0] === "fillRect" && c[3] !== 1920);

describe("drawing a text with styled spans", () => {
  it("writes each stretch in its own font, from where the one before ended", () => {
    const { out } = drawn(titled(BOLD_BIG));
    expect(out.map((o) => [o.text, o.font])).toEqual([["the ", "400 100px"], ["big", "700 100px"], [" robot", "400 100px"]]);
    // Centred on the frame's middle, 680 wide: 620, then 4 × 50 on, then 3 × 60 on.
    const left = out[0].x;
    expect(out.map((o) => o.x - left)).toEqual([0, 200, 380]);
  });
  it("writes a stretch in its own colour and the rest in the clip's, and leaves the font alone when only the colour differs", () => {
    const { out, calls } = drawn(titled(RED_ROBOT));
    expect(out.map((o) => [o.text, o.fill])).toEqual([["the big ", "#ffffff"], ["robot", "#ff0000"]]);
    expect(new Set(out.map((o) => o.font))).toEqual(new Set(["400 100px"]));
    // What is drawn after it starts from the clip's own colour and alignment again.
    const sets = calls.filter((c) => c[0] === "set fillStyle" || c[0] === "set textAlign").map((c) => c[1]);
    expect(sets.slice(-2)).toEqual(["#ffffff", "center"]);
  });
  it("slants and underlines only the stretch that asks for it", () => {
    const { out, calls } = drawn(titled([{ from: 0, to: 3, italic: true }, { from: 8, to: 13, underline: true }]));
    expect(out.map((o) => [o.text, o.font])).toEqual([["the", "italic 400 100px"], [" big ", "400 100px"], ["robot", "400 100px"]]);
    const lines = underlines(calls);
    expect(lines).toHaveLength(1);
    expect([lines[0][1], lines[0][3]]).toEqual([out[2].x, 250]); // under "robot", as wide as it
  });
  it("an underlined text can have a stretch that is not", () => {
    const { calls } = drawn(titled([{ from: 4, to: 7, underline: false }], {}, { underline: true }));
    expect(underlines(calls).map((c) => c[3])).toEqual([200, 300]); // "the " and " robot"
  });
  it("outlines every stretch before any letter is filled, each in its own font", () => {
    const { calls } = drawn(titled(BOLD_BIG, {}, { outlineColor: "#000000", outlineWidth: 4 }));
    const order = calls.filter((c) => c[0] === "strokeText" || c[0] === "fillText").map((c) => `${c[0]} ${String(c[1]).trim()}`);
    expect(order).toEqual(["strokeText the", "strokeText big", "strokeText robot", "fillText the", "fillText big", "fillText robot"]);
  });
  it("a typewriter shows only the characters reached so far, in their own looks", () => {
    // Thirteen characters over 13 frames, one more each frame: at frame 5, the first six ("the bi").
    const { out } = drawn(titled(BOLD_BIG, { animationIn: { preset: "typewriter", frames: 13 } }), 5);
    expect(out.map((o) => [o.text, o.font])).toEqual([["the ", "400 100px"], ["bi", "700 100px"]]);
    // The bold stretch starts where it will be once the line is whole.
    expect(out[1].x - out[0].x).toBe(200);
  });
  it("a lit word takes the highlight colour over its stretch's own, and the others keep theirs", () => {
    const clip = titled(RED_ROBOT, { emphasis: { preset: "highlight_word", color: "#00ff00" } });
    const all = [0, 10, 20].map((frame) => drawn({ ...clip, duration: 30 }, frame).out.map((o) => `${o.text.trim()}:${o.fill}`).filter((s) => !s.startsWith(":")));
    expect(all[0]).toEqual(["the:#00ff00", "big:#ffffff", "robot:#ff0000"]);
    expect(all[1]).toEqual(["the:#ffffff", "big:#00ff00", "robot:#ff0000"]);
    expect(all[2]).toEqual(["the:#ffffff", "big:#ffffff", "robot:#00ff00"]);
  });
  it("a text of one look is drawn as it always was: one call a line", () => {
    const { ctx, calls } = fakeCtx();
    const doc = docWithCaptions("long_16x9");
    doc.tracks[1].clips = [titled(null)];
    drawFrame(ctx, doc, 10);
    expect(calls.filter((c) => c[0] === "fillText").map((c) => c[1])).toEqual(["the big robot"]);
  });
});
