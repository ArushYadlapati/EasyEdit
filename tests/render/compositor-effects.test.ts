import { describe, expect, it } from "vitest";
import { crossfadeFrom, drawFrame, drawnClips, type Ctx2D, type LayerUse, type ResolvedSource } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, type Clip, type NestClip, type TimelineDoc } from "@/lib/timeline";
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

describe("a crossfade after an empty slot", () => {
  const slot = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}): Clip =>
    ({ id, type: "placeholder", start, duration, transform: { ...DEFAULT_TRANSFORM }, accepts: "visual", slot: { name: "hero_clip" }, ...extra }) as Clip;

  it("has nothing to blend from, so it fades in like a clip with no clip before it, and the slot never draws", () => {
    const withSlot = doc([slot("S", 0, 30, { transitionOut: { kind: "dip", frames: 10 } }), video("B", 30, 30, crossfade)]);
    const alone = doc([video("B", 30, 30, crossfade)]);
    expect(crossfadeFrom(withSlot.tracks[0], withSlot.tracks[0].clips[1])).toBeNull();
    for (const frame of [25, 29, 30, 35, 39, 40]) {
      expect(drawn(withSlot, frame), String(frame)).toEqual(drawn(alone, frame));
      const a = fakeCtx();
      const b = fakeCtx();
      expect(() => drawFrame(a.ctx, withSlot, frame)).not.toThrow();
      drawFrame(b.ctx, alone, frame);
      expect(a.calls, String(frame)).toEqual(b.calls);
    }
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, withSlot, 35);
    expect(only(calls, "set globalAlpha").map(([, v]) => v)).toEqual([0.6]); // B alone, 6 of 10 frames in
  });

  it("a slot's own transitions and keyframes draw nothing while it is empty", () => {
    const s = slot("S", 0, 30, { transitionIn: { kind: "dip", frames: 10 }, keyframes: { x: [{ at: 0, value: 0 }, { at: 29, value: 1 }] } });
    for (const frame of [0, 5, 15, 29]) {
      const a = fakeCtx();
      const b = fakeCtx();
      drawFrame(a.ctx, doc([s]), frame);
      drawFrame(b.ctx, doc([]), frame);
      expect(a.calls, String(frame)).toEqual(b.calls);
      expect(drawnClips(doc([s]), frame)).toEqual([]);
    }
  });
});

describe("a crossfade owns its cut", () => {
  it("the outgoing clip's own out-transition is left out, so it does not fade away before its tail draws whole", () => {
    const a = video("A", 0, 30, { transitionOut: { kind: "fade", frames: 10 } });
    const alphaAt = (d: TimelineDoc, frame: number) => {
      const { ctx, calls } = fakeCtx();
      drawFrame(ctx, d, frame);
      return only(calls, "set globalAlpha").map(([, v]) => v as number);
    };
    expect(alphaAt(doc([a, video("B", 30, 30, crossfade)]), 29)).toEqual([1]);
    expect(alphaAt(doc([a, video("B", 30, 30, crossfade)]), 25)).toEqual([1]);
    expect(alphaAt(doc([a, video("B", 30, 30, crossfade)]), 30)[0]).toBe(1); // the tail
    expect(alphaAt(doc([a, video("B", 30, 30)]), 29)).toEqual([0]); // no crossfade: the fade-out plays
  });

  it("an incoming clip that is also crossfaded out of keeps its full crossfade, and its outgoing clip's tail matches it", () => {
    // B is 12 frames with a crossfade in of 10 and a fade out of 10. C crossfades in from B, so B's fade out is left
    // out and its crossfade is not cut to half of B: A's tail runs the whole 10 frames.
    const d = doc([
      video("A", 0, 30),
      video("B", 30, 12, { ...crossfade, transitionOut: { kind: "fade", frames: 10 } }),
      video("C", 42, 30, crossfade),
    ]);
    for (const frame of [30, 35, 36, 37, 39]) expect(drawn(d, frame)).toEqual(["A tail", "B"]);
    expect(drawn(d, 40)).toEqual(["B"]);
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 36);
    const alphas = only(calls, "set globalAlpha").map(([, v]) => v as number);
    expect(alphas[0]).toBe(1); // A's tail
    expect(alphas[1]).toBeCloseTo(0.7); // B, 7 of 10 frames in
  });

  it("a crossfade too short to hold a frame draws no tail and leaves the outgoing clip's own out-transition", () => {
    const a = video("A", 0, 30, { transitionOut: { kind: "fade", frames: 10 } });
    // A one-frame clip with an effect at each end has room for neither, so its 10-frame crossfade is cut to 0.
    const d = doc([a, video("B", 30, 1, { ...crossfade, transitionOut: { kind: "fade", frames: 10 } })]);
    expect(drawn(d, 30)).toEqual(["B"]);
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 29);
    expect(only(calls, "set globalAlpha").map(([, v]) => v as number)).toEqual([0]); // A's fade out plays
  });

  it("a dip out on the outgoing clip is left out too", () => {
    const a = video("A", 0, 30, { transitionOut: { kind: "dip", frames: 10 } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([a, video("B", 30, 30, crossfade)]), 29);
    expect(only(calls, "fillRect")).toHaveLength(2); // the black frame and the placeholder, no dip
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

  it("a whip with no layer to smear on draws its clip once, where the move puts it, with no copies", () => {
    const c = video("c", 0, 30, { transitionIn: { kind: "whip", frames: 10, direction: "right" } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([c]), 4);
    const translates = only(calls, "translate").map(([, x]) => x as number);
    expect(translates).toHaveLength(1);
    expect(translates[0]).toBeLessThan(540); // still coming in from the left
    expect(only(calls, "set globalAlpha").map(([, v]) => v)).toEqual([1]);
    expect(only(calls, "fillText")).toHaveLength(1);
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

  it("a grapheme a wrap leaves that is not in the text is drawn with its word, and the graphemes after it still draw", () => {
    // " \u0301" is one grapheme (a space with a combining accent). Wrapping at the space leaves "\u0301" at the start
    // of the second line, a grapheme the text does not have on its own. The box is 30 characters at 32 px.
    const t = text("t", 0, 30, { text: `${"x".repeat(28)} \u0301cd`, emphasis: { preset: "highlight_word", color: "#00ff00" } });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc([], [t]), 0);
    expect(only(calls, "fillText").map(([, s]) => s)).toEqual(["x".repeat(28), "\u0301cd"]);
    const typed = text("t", 0, 30, { text: `${"x".repeat(28)} \u0301cd`, animationIn: { preset: "typewriter", frames: 5 } });
    const all = fakeCtx();
    drawFrame(all.ctx, doc([], [typed]), 29); // fully typed
    expect(only(all.calls, "fillText").map(([, s]) => s)).toEqual(["x".repeat(28), "\u0301cd"]);
  });
});

const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 1080, height: 1920 };
type Layer = { ctx: Ctx2D; calls: Call[] };

// A frame k times the project's size, as a preview or an export draws on: the context is scaled by k.
function frameOf(k: number): Layer {
  const made = fakeCtx();
  const ctx = new Proxy(made.ctx as object, {
    get: (target, key) => (key === "getTransform" ? () => ({ a: k, b: 0, c: 0, d: k, e: 0, f: 0 }) : Reflect.get(target, key)),
    set: (target, key, value) => Reflect.set(target, key, value),
  }) as Ctx2D;
  (ctx as unknown as { canvas: unknown }).canvas = { width: 1080 * k, height: 1920 * k };
  made.calls.length = 0;
  return { ctx, calls: made.calls };
}

// Draws the clips at a frame k times the project's size, with a layer for each use asked for.
function smeared(clips: Clip[], frame: number, k = 1) {
  const onFrame = frameOf(k);
  const layers = new Map<LayerUse, Layer>();
  const asked: LayerUse[] = [];
  drawFrame(onFrame.ctx, doc(clips), frame, {
    resolveSource: () => PICTURE,
    finish: null,
    makeLayer: (width, height, use) => {
      asked.push(use);
      if (!layers.has(use)) {
        const made = fakeCtx();
        (made.ctx as unknown as { canvas: unknown }).canvas = { width, height, use };
        made.calls.length = 0;
        layers.set(use, made);
      }
      return layers.get(use)!.ctx;
    },
  });
  const canvasOf = (use: LayerUse) => (layers.get(use)?.ctx as unknown as { canvas: unknown } | undefined)?.canvas;
  // How far each step of the spread moves its copies either way: the draws of a whole layer moved to the right.
  const halves = (["motion", "motion-spread"] as const)
    .flatMap((use) => layers.get(use)?.calls ?? [])
    .filter((call) => call[0] === "drawImage" && call.length === 4 && (call[2] as number) > 0 && call[3] === 0)
    .map((call) => call[2] as number)
    .sort((a, b) => a - b);
  return { onFrame: onFrame.calls, layers, asked, canvasOf, halves };
}

const whipRight = (extra: Record<string, unknown> = {}) => video("c", 0, 30, { transitionIn: { kind: "whip", frames: 10, direction: "right" }, ...extra });

describe("a whip's smear", () => {
  it("draws the clip once, plain, on a layer of its own", () => {
    const { layers, asked, onFrame } = smeared([whipRight()], 4);
    expect(asked).toEqual(["motion", "motion-spread"]);
    const motion = layers.get("motion")!.calls;
    expect(motion.slice(0, 4)).toEqual([["save"], ["setTransform", 1, 0, 0, 1, 0, 0], ["clearRect", 0, 0, 1080, 1920], ["setTransform", expect.anything()]]);
    const pictures = [...onFrame, ...motion, ...layers.get("motion-spread")!.calls].filter(([name, what]) => name === "drawImage" && what === PICTURE.image);
    expect(pictures).toHaveLength(1);
    expect(motion).toContainEqual(["drawImage", PICTURE.image, -540, -960, 1080, 1920]);
    // The frame gets the clip only as the finished smear.
    expect(only(onFrame, "translate")).toEqual([]);
  });

  it("spreads it evenly over the move in steps that double, its copies under two canvas pixels apart, up to 128 of them", () => {
    const sum = (halves: number[]) => halves.reduce((a, b) => a + b, 0);
    // Three tenths of the way into a 10-frame whip at 30 fps: 0.108 of the width, 116.64 pixels, in 64 copies.
    const early = smeared([whipRight()], 2).halves;
    expect(early).toHaveLength(6);
    const gap = early[0] * 2;
    expect(gap).toBeLessThanOrEqual(2);
    for (let i = 1; i < early.length; i++) expect(early[i]).toBeCloseTo(2 * early[i - 1]);
    // From the first copy to the last, plus the share each stands for: the whole move.
    expect(2 * sum(early) + gap).toBeCloseTo(0.108 * 1080);
    // Halfway: 0.3 of the width, 324 pixels. Seven steps make 128 copies, each too faint to see on its own.
    const mid = smeared([whipRight()], 4).halves;
    expect(mid).toHaveLength(7);
    expect(2 * sum(mid) + 2 * mid[0]).toBeCloseTo(0.3 * 1080);
  });

  it("adds each step's two copies at half strength, moved either way, and fills the strip each leaves bare at the edge from the edge", () => {
    const { layers, canvasOf } = smeared([whipRight()], 4);
    const spread = layers.get("motion-spread")!.calls;
    const motion = canvasOf("motion");
    const step = spread.slice(0, 12);
    const half = step.find((call) => call[0] === "drawImage" && call.length === 4 && (call[2] as number) > 0)![2] as number;
    expect(step).toEqual([
      ["save"],
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["clearRect", 0, 0, 1080, 1920],
      ["set globalCompositeOperation", "lighter"],
      ["set globalAlpha", 0.5],
      ["drawImage", motion, -half, 0],
      ["drawImage", motion, 1079, 0, 1, 1920, 1080 - half, 0, half, 1920],
      ["drawImage", motion, half, 0],
      ["drawImage", motion, 0, 0, 1, 1920, 0, 0, half, 1920],
      ["restore"],
      ["save"],
      ["setTransform", 1, 0, 0, 1, 0, 0],
    ]);
  });

  it("joins the frame once, with the clip's own opacity and blend", () => {
    const { onFrame, canvasOf, layers } = smeared([whipRight({ transform: { ...DEFAULT_TRANSFORM, opacity: 0.6 }, blend: "screen" })], 4);
    // Seven steps, back and forth: the last lands on the spread layer.
    expect(onFrame.slice(-6)).toEqual([
      ["save"],
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["set globalAlpha", 0.6],
      ["set globalCompositeOperation", "screen"],
      ["drawImage", canvasOf("motion-spread"), 0, 0],
      ["restore"],
    ]);
    // On its own layer the clip is drawn solid and plain: none of its opacity or blend is used twice.
    const motion = layers.get("motion")!.calls;
    const own = motion.slice(0, motion.findIndex(([name]) => name === "restore"));
    expect(only(own, "set globalAlpha", "set globalCompositeOperation")).toEqual([]);
  });

  it("is the same share of the frame in a half-size preview as in the export, with fewer copies where fewer will do", () => {
    // A fifth of the way in: 0.048 of the width.
    const span = (k: number) => {
      const { halves } = smeared([whipRight()], 1, k);
      return { steps: halves.length, share: (2 * halves.reduce((a, b) => a + b, 0) + 2 * halves[0]) / (1080 * k), gap: 2 * halves[0] };
    };
    const exported = span(1);
    const preview = span(0.5);
    expect(exported.share).toBeCloseTo(0.048);
    expect(preview.share).toBeCloseTo(exported.share);
    expect([exported.steps, preview.steps]).toEqual([5, 4]);
    expect(preview.gap).toBeLessThanOrEqual(2);
  });

  it("goes up and down the frame for a whip up or down", () => {
    const { layers } = smeared([video("c", 0, 30, { transitionIn: { kind: "whip", frames: 10, direction: "up" } })], 4);
    const spread = layers.get("motion-spread")!.calls.filter(([name]) => name === "drawImage").slice(0, 4);
    const half = spread[2][3] as number;
    expect(half).toBeGreaterThan(0);
    expect(spread.map((call) => call.slice(2))).toEqual([
      [0, -half],
      [0, 1919, 1080, 1, 0, 1920 - half, 1080, half],
      [0, half],
      [0, 0, 1080, 1, 0, 0, 1080, half],
    ]);
  });

  it("is left out at rest, and when it is under a canvas pixel", () => {
    expect(smeared([whipRight()], 9).asked).toEqual([]); // the last frame in
    expect(smeared([whipRight()], 20).asked).toEqual([]);
    // A 1-frame-long move across 30 seconds is too slow to smear a 54-pixel-wide frame by a pixel.
    const slow = video("c", 0, 600, { transitionIn: { kind: "whip", frames: 600, direction: "right" } });
    expect(smeared([slow], 1, 0.05).asked).toEqual([]);
  });

  it("a whip inside a nest that is whipping too is smeared once, with the nest", () => {
    const inner = video("a", 0, 30, { transitionIn: { kind: "whip", frames: 10, direction: "left" } });
    const nest: NestClip = {
      id: "n1", type: "nest", start: 0, duration: 30, in: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM },
      transitionIn: { kind: "whip", frames: 10, direction: "right" },
      tracks: [{ id: "v1", kind: "video", name: "Video 1", muted: false, hidden: false, locked: false, clips: [inner] as never }],
    };
    const { asked, layers } = smeared([nest], 4);
    expect(asked).toEqual(["motion", "motion-spread", "nest"]);
    // The nested clip is drawn as it is onto the nest's layer, which is then smeared as one picture.
    expect(only(layers.get("nest")!.calls, "drawImage")).toEqual([["drawImage", PICTURE.image, -540, -960, 1080, 1920]]);
  });
});
