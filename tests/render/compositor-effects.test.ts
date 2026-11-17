import { describe, expect, it } from "vitest";
import { crossfadeFrom, drawFrame, drawnClips } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, type Clip, type TimelineDoc } from "@/lib/timeline";
import { text, video } from "../editor/fixtures";
import { fakeCtx, type Call } from "./fake-ctx";
import { docWithCaptions } from "../helpers/docs";

const only = (calls: Call[], ...names: string[]) => calls.filter(([name]) => names.includes(name));

// 1080 × 1920: track 0 holds video, track 1 text.
function doc(videos: Clip[], texts: Clip[] = []): TimelineDoc {
  const d = docWithCaptions("short_9x16");
  d.tracks[0].clips = videos;
  d.tracks[1].clips = texts;
  return d;
}

const crossfade = { transitionIn: { kind: "crossfade", frames: 10 } };
const drawn = (d: TimelineDoc, frame: number) => drawnClips(d, frame).map(({ clip, tail }) => `${clip.id}${tail ? " tail" : ""}`);

describe("crossfade tails", () => {
  it("the outgoing clip draws on under the incoming one for the crossfade's length", () => {
    const d = doc([video("A", 0, 30), video("B", 30, 30, crossfade)]);
    expect(drawn(d, 29)).toEqual(["A"]);
    expect(drawn(d, 30)).toEqual(["A tail", "B"]);
    expect(drawn(d, 35)).toEqual(["A tail", "B"]);
    expect(drawn(d, 39)).toEqual(["A tail", "B"]);
    expect(drawn(d, 40)).toEqual(["B"]);
    expect(crossfadeFrom(d.tracks[0], d.tracks[0].clips[1])?.id).toBe("A");
  });

  it("with no clip ending exactly at the cut there is no tail", () => {
    const d = doc([video("A", 0, 29), video("B", 30, 30, crossfade)]);
    expect(drawn(d, 35)).toEqual(["B"]);
    expect(crossfadeFrom(d.tracks[0], d.tracks[0].clips[1])).toBeNull();
  });

  it("only a crossfade has a tail", () => {
    const d = doc([video("A", 0, 30), video("B", 30, 30, { transitionIn: { kind: "fade", frames: 10 } })]);
    expect(drawn(d, 35)).toEqual(["B"]);
    expect(crossfadeFrom(d.tracks[0], d.tracks[0].clips[1])).toBeNull();
  });

  it("a tail draws with its own transform at full alpha and ignores its own out-transition", () => {
    const a = video("A", 0, 30, { transform: { ...DEFAULT_TRANSFORM, opacity: 0.8 }, transitionOut: { kind: "fade", frames: 5 } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([a, video("B", 30, 30, crossfade)]), 35);
    const alphas = only(calls, "set globalAlpha").map(([, v]) => v as number);
    expect(alphas[0]).toBe(0.8);
    expect(alphas[1]).toBeCloseTo(0.6); // B, 6 of 10 frames in
    expect(only(calls, "fillText").map(([, s]) => s)).toEqual(["Video", "Video"]);
  });
});

describe("drawFrame looks", () => {
  it("a fade-in's first frame draws at a tenth of the clip's opacity", () => {
    const c = video("c", 0, 30, { transform: { ...DEFAULT_TRANSFORM, opacity: 0.5 }, transitionIn: { kind: "fade", frames: 10 } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([c]), 0);
    const set = calls.findIndex(([name]) => name === "set globalAlpha");
    expect(set).toBeGreaterThan(-1);
    expect(calls[set][1]).toBeCloseTo(0.05);
    // The placeholder is the clip's draw: its fill comes after the alpha is set.
    const placeholder = calls.findIndex(([name], i) => name === "fillRect" && i > 1);
    expect(placeholder).toBeGreaterThan(set);
  });

  it("a dip fills the whole frame with its colour after the clip", () => {
    const c = video("c", 0, 30, { transitionOut: { kind: "dip", frames: 10, color: "#ff0000" } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([c]), 25);
    const fills = calls.map((call, i) => [call, i] as const).filter(([[name]]) => name === "fillRect");
    const [last, at] = fills[fills.length - 1];
    expect(last).toEqual(["fillRect", 0, 0, 1080, 1920]);
    const label = calls.findIndex(([name]) => name === "fillText");
    expect(at).toBeGreaterThan(label);
    const style = calls.slice(0, at).filter(([name]) => name === "set fillStyle").pop();
    expect(style).toEqual(["set fillStyle", "#ff0000"]);
    const alpha = calls.slice(0, at).filter(([name]) => name === "set globalAlpha").pop();
    expect(alpha![1]).toBeCloseTo(0.6);
  });

  it("a dip at alpha 0 draws nothing over the clip", () => {
    const c = video("c", 0, 30, { transitionIn: { kind: "dip", frames: 10 } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([c]), 9);
    expect(only(calls, "fillRect")).toHaveLength(2); // the black frame and the placeholder
  });

  it("a whip draws its trail before the clip, each copy offset and fainter", () => {
    const c = video("c", 0, 30, { transitionIn: { kind: "whip", frames: 10, direction: "right" } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([c]), 0);
    const translates = only(calls, "translate").map(([, x]) => x as number);
    expect(translates).toHaveLength(4);
    // Each copy sits further left than the clip, by 6% of the width per step.
    for (let i = 0; i < 3; i++) expect(translates[i]).toBeCloseTo(translates[3] - 0.06 * (i + 1) * 1080);
    const alphas = only(calls, "set globalAlpha").map(([, v]) => v as number);
    expect(alphas.slice(0, 3)).toEqual([0.45, 0.25, 0.12]);
    expect(alphas[3]).toBe(1);
  });

  it("a typewriter draws only the revealed graphemes", () => {
    const t = text("t", 0, 30, { text: "Hello", animationIn: { preset: "typewriter", frames: 5 } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([], [t]), 1); // 2 of 5 frames in: 2 of 5 graphemes
    expect(only(calls, "fillText").map(([, s]) => s)).toEqual(["He"]);
  });

  it("a revealed prefix sits where it sits in the whole line, for every alignment", () => {
    // 64 px text: 32 px per character, so "Hello" is 160 wide.
    for (const [align, x] of [["center", -80], ["left", -486], ["right", 486 - 160]] as const) {
      const t = text("t", 0, 30, {
        text: "Hello",
        animationIn: { preset: "typewriter", frames: 5 },
        style: { fontFamily: "Geist", fontSize: 64, fontWeight: 700, color: "#ffffff", align },
      });
      const { ctx, calls } = fakeCtx();
      drawFrame(ctx, doc([], [t]), 1);
      expect(only(calls, "fillText")).toEqual([["fillText", "He", x, 0]]);
      expect(only(calls, "set textAlign").pop()).toEqual(["set textAlign", "left"]);
    }
  });

  it("the reveal carries on across lines", () => {
    const t = text("t", 0, 30, { text: "ab\ncd", animationIn: { preset: "typewriter", frames: 5 } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([], [t]), 3); // 4 of 5 graphemes: a, b, the line break, c
    expect(only(calls, "fillText").map(([, s]) => s)).toEqual(["ab", "c"]);
  });

  it("highlight_word draws each word on its own, the lit one in the highlight colour", () => {
    const t = text("t", 0, 30, { text: "go team go", emphasis: { preset: "highlight_word" } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([], [t]), 10); // a third of the way: the second word
    const texts = only(calls, "fillText");
    expect(texts.map(([, s]) => s)).toEqual(["go", "team", "go"]);
    const second = calls.indexOf(texts[1]);
    const style = calls.slice(0, second).filter(([name]) => name === "set fillStyle").pop();
    expect(style).toEqual(["set fillStyle", "#FFD400"]);
    const third = calls.indexOf(texts[2]);
    expect(calls.slice(second, third).filter(([name]) => name === "set fillStyle").pop()).toEqual(["set fillStyle", "#ffffff"]);
    // "go team go" is 320 wide at 32 px per character, so it starts at −160; each word sits where it sits in the line.
    expect(texts.map(([, , x]) => x)).toEqual([-160, -160 + 96, -160 + 256]);
  });

  it("a word cut across two lines is still one word", () => {
    // The box is 972 px: 30 characters at 32 px. A 40-character word is cut into 30 + 10.
    const long = "x".repeat(40);
    const t = text("t", 0, 30, { text: `${long} go`, emphasis: { preset: "highlight_word", color: "#00ff00" } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([], [t]), 0); // the first word is lit
    const lit: string[] = [];
    let style = "";
    for (const [name, value] of calls) {
      if (name === "set fillStyle") style = value as string;
      if (name === "fillText" && style === "#00ff00") lit.push(value as string);
    }
    expect(lit).toEqual(["x".repeat(30), "x".repeat(10)]);
  });
});
