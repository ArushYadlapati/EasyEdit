import { describe, expect, it } from "vitest";
import { drawFrame, type Ctx2D, type LayerUse, type ResolvedSource } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, type MediaClip, type NestClip } from "@/lib/timeline";
import { text, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx, type Call } from "./fake-ctx";

// A nest at frame 100 of the project: a video a (0–60 of the nest's own time) and a title over it.
function nest(over: Partial<NestClip> = {}): NestClip {
  return {
    id: "n1", type: "nest", start: 100, duration: 60, in: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM },
    tracks: [
      { id: "v1", kind: "video", name: "Video 1", muted: false, hidden: false, locked: false, clips: [video("a", 0, 60)] as never },
      { id: "t1", kind: "text", name: "Text 1", muted: false, hidden: false, locked: false, clips: [text("x", 10, 30, { text: "Hello" })] as never },
    ],
    ...over,
  };
}
const PICTURE = { tag: "frame of a" } as unknown as CanvasImageSource;

function draw(n: NestClip, frame: number, withLayers = true) {
  const doc = docWithCaptions("long_16x9");
  doc.tracks[0].clips = [n];
  const { ctx, calls } = fakeCtx();
  (ctx as unknown as { canvas: unknown }).canvas = { width: 1920, height: 1080 };
  const asked: [string, number][] = [];
  const layers = new Map<LayerUse, { ctx: Ctx2D; calls: Call[] }>();
  drawFrame(ctx, doc, frame, {
    resolveSource: (clip: MediaClip, at: number): ResolvedSource | null => {
      if (clip.type !== "video") return null;
      asked.push([clip.id, at]);
      return { image: PICTURE, width: 1920, height: 1080 };
    },
    finish: null,
    makeLayer: (_w, _h, use) => {
      if (!withLayers) return null;
      if (!layers.has(use)) {
        const made = fakeCtx();
        (made.ctx as unknown as { canvas: unknown }).canvas = { width: 1920, height: 1080, use };
        made.calls.length = 0;
        layers.set(use, made);
      }
      return layers.get(use)!.ctx;
    },
  });
  return { calls, layers, asked };
}
const names = (calls: Call[]) => calls.map(([name]) => name);

describe("drawing a nest", () => {
  it("draws its clips together on a layer of their own, cleared first, at the frame of its own timeline", () => {
    const { layers, asked } = draw(nest(), 120); // 20 frames into the nest
    const layer = layers.get("nest")!.calls;
    expect(layer.slice(0, 4)).toEqual([["save"], ["setTransform", 1, 0, 0, 1, 0, 0], ["clearRect", 0, 0, 1920, 1080], ["setTransform", expect.anything()]]);
    // The video under its nested name, at the nest's own frame, and the title over it; no black is put behind them.
    expect(asked).toEqual([["n1/a", 20]]);
    expect(layer.filter(([name]) => name === "drawImage").map((c) => c[1])).toEqual([PICTURE]);
    expect(layer.filter(([name]) => name === "fillText").map((c) => c[1])).toEqual(["Hello"]);
    expect(names(layer)).not.toContain("fillRect");
  });
  it("then draws that layer onto the frame once, as a picture that fills it", () => {
    const { calls } = draw(nest(), 120);
    const pictures = calls.filter(([name]) => name === "drawImage");
    expect(pictures).toEqual([["drawImage", { width: 1920, height: 1080, use: "nest" }, -960, -540, 1920, 1080]]);
    // The frame itself gets no clip of the nest drawn straight onto it.
    expect(calls.filter(([name]) => name === "fillText")).toEqual([]);
  });
  it("shows what its own timeline holds at that moment: the title only while it is there, a later part when trimmed", () => {
    const text9 = (frame: number, n = nest()) => draw(n, frame).layers.get("nest")!.calls.filter(([name]) => name === "fillText").length;
    expect([text9(105), text9(110), text9(139), text9(140)]).toEqual([0, 1, 1, 0]);
    // Playing from frame 30 of itself: its first frame shows the title's 21st, and asks the video for frame 30.
    const trimmed = draw(nest({ in: 30, duration: 30 }), 100);
    expect(trimmed.asked).toEqual([["n1/a", 30]]);
    expect(trimmed.layers.get("nest")!.calls.filter(([name]) => name === "fillText")).toHaveLength(1);
  });
  it("is placed, faded and scaled as one: the frame gets the nest's own transform and opacity, the layer does not", () => {
    const moved = nest({ transform: { ...DEFAULT_TRANSFORM, x: 0.25, scale: 0.5, opacity: 0.4 } });
    const { calls, layers } = draw(moved, 120);
    expect(calls).toContainEqual(["set globalAlpha", 0.4]);
    expect(calls).toContainEqual(["translate", 480, 540]);
    expect(calls).toContainEqual(["scale", 0.5, 0.5]);
    const layer = layers.get("nest")!.calls;
    expect(layer).not.toContainEqual(["set globalAlpha", 0.4]);
    expect(layer).not.toContainEqual(["scale", 0.5, 0.5]);
  });
  it("is not drawn outside its time, and draws nothing where there is no layer to draw on", () => {
    expect(draw(nest(), 99).layers.has("nest")).toBe(false);
    expect(draw(nest(), 160).layers.has("nest")).toBe(false);
    const none = draw(nest(), 120, false);
    expect(none.calls.filter(([name]) => name === "drawImage" || name === "fillText")).toEqual([]);
  });
});
