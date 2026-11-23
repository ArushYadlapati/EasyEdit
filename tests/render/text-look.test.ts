import { describe, expect, it } from "vitest";
import { drawFrame } from "@/lib/render/compositor";
import { layoutText, letterSpacingOf, lineHeightOf, textFont, textRect } from "@/lib/render/text-layout";
import { DEFAULT_TRANSFORM, type Clip, type TextClip, type TimelineDoc } from "@/lib/timeline";
import { text } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx, type Call } from "./fake-ctx";

// "hi" at 64 px in the middle of a 1080 × 1920 frame. The fake context measures half the font size a character, so
// the line is 64 wide and, at the default line height, 76.8 tall.
const STYLE = { fontFamily: "Geist", fontSize: 64, fontWeight: 700, color: "#ffffff", align: "center" };
const styled = (style: Record<string, unknown>, extra: Record<string, unknown> = {}) => text("x", 0, 30, { style: { ...STYLE, ...style }, ...extra }) as TextClip;
function draw(clip: Clip, change: (d: TimelineDoc) => void = () => {}): Call[] {
  const d = docWithCaptions("short_9x16");
  d.tracks[1].clips = [clip];
  change(d);
  const { ctx, calls } = fakeCtx();
  drawFrame(ctx, d, 10);
  // From the clip's own drawing on: after the black frame and the clip's place.
  return calls.slice(calls.findIndex(([name]) => name === "set font"));
}
const names = (calls: Call[]) => calls.map(([name]) => name);
const tenPerChar = (s: string) => s.length * 10;

describe("a text's font, spacing and line height", () => {
  it("slants the font only when the text is italic", () => {
    expect(textFont(styled({}).style, '"Geist", sans-serif')).toBe('700 64px "Geist", sans-serif');
    expect(textFont(styled({ italic: true }).style, '"Geist", sans-serif')).toBe('italic 700 64px "Geist", sans-serif');
  });
  it("spaces letters by a share of the font size", () => {
    expect(letterSpacingOf(styled({}).style)).toBeNull();
    expect(letterSpacingOf(styled({ letterSpacing: 0 }).style)).toBeNull();
    expect(letterSpacingOf(styled({ letterSpacing: 0.1 }).style)).toBe("6.4px");
    expect(letterSpacingOf(styled({ letterSpacing: -0.05 }).style)).toBe("-3.2px");
  });
  it("sets lines apart by the text's own line height", () => {
    const two = styled({ fontSize: 100, lineHeight: 2 }, { text: "A\nB" });
    expect(lineHeightOf(two.style)).toBe(2);
    expect(lineHeightOf(styled({}).style)).toBe(1.2);
    expect(layoutText(two, 1080, tenPerChar).map((l) => l.y)).toEqual([-100, 100]);
    expect(textRect(two, 1080, tenPerChar)).toMatchObject({ top: -200, bottom: 200 });
  });
});

describe("drawing a text's look", () => {
  it("plain text draws exactly as it always did", () => {
    expect(draw(styled({}))).toEqual([
      ["set font", '700 64px "Geist", sans-serif'], ["set fillStyle", "#ffffff"], ["set textAlign", "center"], ["set textBaseline", "middle"],
      ["fillText", "hi", 0, 0],
      ["restore"],
    ]);
    // A look that is switched off, as a style keeps it once it was touched, draws the same.
    expect(draw(styled({ italic: false, underline: false, letterSpacing: 0, outlineColor: null, outlineWidth: 5, shadowColor: null, backgroundColor: null }))).toEqual(draw(styled({})));
  });

  it("italic and letter spacing go into the font and the context", () => {
    const calls = draw(styled({ italic: true, letterSpacing: 0.25 }));
    expect(calls.slice(0, 2)).toEqual([["set font", 'italic 700 64px "Geist", sans-serif'], ["set letterSpacing", "16px"]]);
  });

  it("an underline runs under each line, as wide as the line", () => {
    const calls = draw(styled({ underline: true }));
    const line = calls.find(([name]) => name === "fillRect")!;
    expect(line.slice(1, 4)).toEqual([-32, 64 * 0.42, 64]);
    expect(line[4]).toBeCloseTo(64 / 14);
    expect(names(calls).indexOf("fillRect")).toBeLessThan(names(calls).indexOf("fillText"));
    // Left-aligned text starts at the left of its box.
    expect(draw(styled({ underline: true, align: "left" })).find(([name]) => name === "fillRect")![1]).toBe(-486);
  });

  it("an outline is drawn under the letters, twice its width so its outer half shows", () => {
    const calls = draw(styled({ outlineColor: "#000000", outlineWidth: 6 }));
    expect(calls.slice(4)).toEqual([
      ["set lineJoin", "round"], ["set lineWidth", 12], ["set strokeStyle", "#000000"],
      ["strokeText", "hi", 0, 0],
      ["fillText", "hi", 0, 0],
      ["restore"],
    ]);
    // No width is no outline.
    expect(names(draw(styled({ outlineColor: "#000000", outlineWidth: 0 })))).not.toContain("strokeText");
  });

  it("a shadow falls from the letters, once", () => {
    const calls = draw(styled({ shadowColor: "#102030", shadowBlur: 10, shadowX: 4, shadowY: 8, shadowOpacity: 0.5 }));
    expect(calls.slice(4)).toEqual([
      ["set shadowColor", "rgba(16,32,48,0.5)"], ["set shadowBlur", 10], ["set shadowOffsetX", 4], ["set shadowOffsetY", 8],
      ["fillText", "hi", 0, 0],
      ["set shadowColor", "transparent"],
      ["restore"],
    ]);
    expect(names(draw(styled({ shadowColor: "#102030", shadowOpacity: 0 })))).not.toContain("set shadowColor");
  });

  it("with an outline, the shadow falls from both and the letters are drawn clean on top", () => {
    const calls = draw(styled({ outlineColor: "#000000", outlineWidth: 6, shadowColor: "#000000", shadowBlur: 10, shadowY: 8 }));
    expect(names(calls.slice(4))).toEqual([
      "set lineJoin", "set lineWidth", "set strokeStyle",
      "set shadowColor", "set shadowBlur", "set shadowOffsetX", "set shadowOffsetY",
      "strokeText", "fillText", "set shadowColor", "strokeText", "fillText", "restore",
    ]);
  });

  it("a background is one rounded box behind all the lines, at its own opacity", () => {
    const calls = draw(styled({ backgroundColor: "#ff0000", backgroundOpacity: 0.5, backgroundPadding: 0.5, backgroundRadius: 0.25 }), (d) => {
      d.tracks[1].clips[0].transform = { ...DEFAULT_TRANSFORM, opacity: 0.8 };
    });
    // The line is 64 × 76.8 and the padding 32 on every side, so the box is 128 × 140.8 around the centre.
    expect(calls.slice(4, 8)).toEqual([["set globalAlpha", 0.4], ["set fillStyle", "#ff0000"], ["beginPath"], ["moveTo", -64 + 16, -70.4]]);
    expect(calls.filter(([name]) => name === "arcTo").map((call) => call[5])).toEqual([16, 16, 16, 16]);
    const after = calls.slice(names(calls).indexOf("fill"));
    expect(after).toEqual([["fill"], ["set globalAlpha", 0.8], ["set fillStyle", "#ffffff"], ["fillText", "hi", 0, 0], ["restore"]]);
  });

  it("a box's rounding never passes half its short side", () => {
    const calls = draw(styled({ backgroundColor: "#ff0000", backgroundPadding: 0, backgroundRadius: 2 }));
    expect(calls.filter(([name]) => name === "arcTo").map((call) => call[5])).toEqual([32, 32, 32, 32]);
  });

  it("a typed-in text outlines and fills only the letters shown so far", () => {
    const clip = styled({ outlineColor: "#000000", outlineWidth: 4 }, { text: "hello", animationIn: { preset: "typewriter", frames: 20 } });
    const d = docWithCaptions("short_9x16");
    d.tracks[1].clips = [clip];
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 9); // half way through the typing
    const stroked = calls.filter(([name]) => name === "strokeText");
    const filled = calls.filter(([name]) => name === "fillText");
    expect(stroked).toHaveLength(1);
    expect(filled).toHaveLength(1);
    expect(stroked[0][1]).toBe(filled[0][1]);
    expect(String(filled[0][1]).length).toBeLessThan(5);
    expect(names(calls).indexOf("strokeText")).toBeLessThan(names(calls).indexOf("fillText"));
  });
});
