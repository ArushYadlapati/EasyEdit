import { describe, expect, it } from "vitest";
import { drawCaptions } from "@/lib/render/captions";
import { drawFrame, defaultResolveFont } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, type CaptionStyle, type CaptionWord, type Clip, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";
import { text } from "../editor/fixtures";
import { fakeCtx, type Call } from "./fake-ctx";

const w = (t: string, s: number, e: number): CaptionWord => ({ t, s, e });
const SENTENCE = [w("hello", 0, 400), w("brave", 450, 800), w("new", 900, 1100), w("world.", 1200, 1700)];
const named = (calls: Call[], name: string) => calls.filter((c) => c[0] === name);
const speaker = (id = "c1", extra: Partial<MediaClip> = {}): MediaClip =>
  ({ id, type: "video", assetId: "a", start: 0, duration: 300, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, captions: true, ...extra }) as MediaClip;

function make(style: Partial<CaptionStyle> = {}, clips: Clip[] = [speaker()], words = SENTENCE): TimelineDoc {
  const d = docWithCaptions("short_9x16");
  d.tracks[0].clips = clips;
  d.captions = {
    transcripts: { a: words },
    style: { preset: "block", fontFamily: "Geist", fontWeight: 700, fontSize: 40, color: "#ffffff", highlight: "#ff0000", y: 0.5, uppercase: false, ...style },
  };
  return d;
}
function caps(d: TimelineDoc, frame: number): Call[] {
  const { ctx, calls } = fakeCtx();
  drawCaptions(ctx, d, frame, defaultResolveFont);
  return calls;
}
const texts = (calls: Call[]) => named(calls, "fillText").map((c) => c[1]);

describe("drawing captions", () => {
  it("draws nothing without a caption track, with it hidden, with captions off, or between cues", () => {
    const d = make();
    const none = make();
    none.tracks = none.tracks.filter((t) => t.kind !== "caption");
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, none, 5);
    expect(texts(calls)).not.toContain("hello brave new world.");
    const hidden = make();
    hidden.tracks.find((t) => t.kind === "caption")!.hidden = true;
    const f = fakeCtx();
    drawFrame(f.ctx, hidden, 5);
    expect(texts(f.calls)).not.toContain("hello brave new world.");
    expect(texts(caps(make({}, [speaker("c1", { captions: false })]), 5))).toEqual([]);
    expect(texts(caps(d, 250))).toEqual([]);
  });

  it("block: outlines in black then fills, centred on the frame and on y", () => {
    const calls = caps(make(), 5);
    expect(calls).toContainEqual(["set font", '700 40px "Geist", sans-serif']);
    expect(calls).toContainEqual(["set textBaseline", "middle"]);
    expect(calls.find((c) => c[0] === "set lineWidth")![1]).toBeCloseTo(5.6, 6);
    expect(calls).toContainEqual(["set lineJoin", "round"]);
    expect(calls).toContainEqual(["translate", 540, 960]);
    const strokeAt = calls.findIndex((c) => c[0] === "strokeText");
    const fillAt = calls.findIndex((c) => c[0] === "fillText");
    expect(strokeAt).toBeGreaterThan(-1);
    expect(strokeAt).toBeLessThan(fillAt);
    expect(texts(calls)).toEqual(["hello brave new world."]);
    expect(calls).toContainEqual(["set fillStyle", "#ffffff"]);
  });

  it("wraps at 0.8 of the width and keeps the lines centred on y", () => {
    // 100px text is 50 px per character here, so 864 px holds 17 characters.
    const long = make({ fontSize: 100 });
    long.captions!.transcripts!.a = [w("alpha", 0, 300), w("bravo", 400, 700), w("charlie", 800, 1100)];
    const lines = texts(caps(long, 5));
    expect(lines).toEqual(["alpha bravo", "charlie"]);
    expect(named(caps(long, 5), "translate")).toEqual([["translate", 540, 960]]);
    expect(named(caps(long, 5), "fillText").map((c) => c[3])).toEqual([-60, 60]);
  });

  it("karaoke fills the lit word in the highlight colour", () => {
    const d = make({ preset: "karaoke" });
    const calls = caps(d, 14); // "brave" is being said
    const fills = calls.filter((c) => c[0] === "fillText" || c[0] === "set fillStyle");
    const at = fills.findIndex((c) => c[0] === "fillText" && c[1] === "brave");
    expect(fills[at - 1]).toEqual(["set fillStyle", "#ff0000"]);
    expect(texts(calls)).toEqual(["hello ", "brave", " new world."]);
  });

  it("word shows one word, bigger, popping from 0.8 over the first 3 frames", () => {
    const d = make({ preset: "word" });
    const first = caps(d, 0);
    expect(texts(first)).toEqual(["hello"]);
    expect(first).toContainEqual(["set font", '700 52px "Geist", sans-serif']);
    expect(named(first, "scale")).toEqual([["scale", 0.8, 0.8]]);
    const mid = named(caps(d, 1), "scale")[0];
    expect(mid[1]).toBeCloseTo(0.8667, 3);
    expect(named(caps(d, 3), "scale")[0][1]).toBe(1);
  });

  it("bar draws a rounded box before the text, with no outline", () => {
    const calls = caps(make({ preset: "bar" }), 5);
    expect(calls).toContainEqual(["set fillStyle", "rgba(0,0,0,0.65)"]);
    expect(named(calls, "arcTo")).toHaveLength(4);
    expect(named(calls, "arcTo")[0][5]).toBe(8);
    expect(named(calls, "strokeText")).toHaveLength(0);
    const boxAt = calls.findIndex((c) => c[0] === "fill");
    expect(boxAt).toBeGreaterThan(-1);
    expect(boxAt).toBeLessThan(calls.findIndex((c) => c[0] === "fillText"));
  });

  it("upper-cases when asked", () => {
    expect(texts(caps(make({ uppercase: true }), 5))).toEqual(["HELLO BRAVE NEW WORLD."]);
  });

  it("two overlapping clips stack upward, the first at y", () => {
    const d = make({}, [speaker("c1")]);
    d.tracks[1].clips = [speaker("c2")];
    const calls = caps(d, 5);
    const moves = named(calls, "translate").map((c) => c[2] as number);
    expect(moves).toHaveLength(2);
    expect(moves[0]).toBe(960);
    expect(moves[1]).toBeCloseTo(960 - (48 + 8), 5); // one line is 1.2 × 40, plus a 0.2 × 40 gap
  });

  it("stacked bar captions keep 0.2 × the font size between their boxes, not between their text", () => {
    const d = make({ preset: "bar" }, [speaker("c1")]);
    d.tracks[1].clips = [speaker("c2")];
    const calls = caps(d, 5);
    const moves = named(calls, "translate").map((c) => c[2] as number);
    expect(moves).toHaveLength(2);
    expect(moves[0]).toBe(960);
    // Each box is the 48 px line plus 0.3 × 40 above and below: 72 px tall, centred on its move.
    const box = 48 + 2 * 0.3 * 40;
    const lowerTop = moves[0] - box / 2;
    const upperBottom = moves[1] + box / 2;
    expect(lowerTop - upperBottom).toBeCloseTo(0.2 * 40, 5);
  });

  it("leaves no state behind", () => {
    const calls = caps(make({ preset: "word" }), 1);
    expect(named(calls, "save").length).toBe(named(calls, "restore").length);
  });

  it("draws above clips on tracks before the caption track and below those after it", () => {
    const d = make({}, [speaker("vid")]);
    d.tracks[1].clips = [text("under", 0, 300, { text: "UNDER" })];
    d.tracks.push({ id: "top", kind: "text", name: "Top", muted: false, hidden: false, locked: false, clips: [text("over", 0, 300, { text: "OVER" })] } as never);
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 5);
    const order = texts(calls);
    expect(order.indexOf("UNDER")).toBeLessThan(order.indexOf("hello brave new world."));
    expect(order.indexOf("hello brave new world.")).toBeLessThan(order.indexOf("OVER"));
  });

  it("is drawn after everything when no clip sits above it, and hideClipId does not hide it", () => {
    const d = make({}, [speaker("vid")]);
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 5, { hideClipId: "vid" });
    expect(texts(calls)).toContain("hello brave new world.");
  });
});

describe("a line that runs right to left", () => {
  const ARABIC = [w("مرحبا", 0, 400), w("بكم", 450, 800), w("جميعا", 900, 1300)];
  it("is drawn whole in karaoke, not word by word: the canvas orders and joins its letters", () => {
    const calls = caps(make({ preset: "karaoke" }, [speaker()], ARABIC), 14); // the second word is being said
    expect(texts(calls)).toEqual(["مرحبا بكم جميعا"]);
    expect(calls.filter((c) => c[0] === "set fillStyle").map((c) => c[1])).not.toContain("#ff0000");
  });
  it("leaves a left-to-right line in another script lit word by word", () => {
    const HINDI = [w("नमस्ते", 0, 400), w("दुनिया", 450, 800)];
    const calls = caps(make({ preset: "karaoke" }, [speaker()], HINDI), 14);
    expect(texts(calls)).toEqual(["नमस्ते ", "दुनिया"]);
    expect(calls.filter((c) => c[0] === "set fillStyle").map((c) => c[1])).toContain("#ff0000");
  });
});
