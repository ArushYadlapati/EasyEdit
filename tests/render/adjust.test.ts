import { describe, expect, it } from "vitest";
import { adjustFilter, compositeOf, needsLayer, temperatureColor } from "@/lib/render/adjust";
import { drawFrame, type Ctx2D, type ResolvedSource } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, NO_ADJUST, type Clip, type TimelineDoc } from "@/lib/timeline";
import { text, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx, type Call } from "./fake-ctx";

// A 1080 × 1920 picture in a 1080 × 1920 frame: it is drawn at −540, −960, the frame's size.
const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 1080, height: 1920 };
const WHOLE = ["drawImage", PICTURE.image, -540, -960, 1080, 1920];

function draw(clip: Clip, layer?: { ctx: Ctx2D; calls: Call[] }, change: (d: TimelineDoc) => void = () => {}) {
  const d = docWithCaptions("short_9x16");
  if (clip.type === "text") d.tracks[1].clips = [clip];
  else d.tracks[0].clips = [clip];
  change(d);
  const { ctx, calls } = fakeCtx();
  // The frame's canvas, as the compositor reads its size.
  (ctx as unknown as { canvas: unknown }).canvas = { width: 1080, height: 1920 };
  drawFrame(ctx, d, 10, { resolveSource: () => PICTURE, makeLayer: layer ? () => layer.ctx : () => null });
  // The clip's own drawing: after its place in the frame is set.
  return calls.slice(calls.findIndex(([name]) => name === "scale") + 1, -1);
}
const names = (calls: Call[]) => calls.map(([name]) => name);
const pictured = (extra: Record<string, unknown>) => video("c", 0, 30, extra);

describe("a canvas filter for a picture's colours", () => {
  it("is nothing for a picture as recorded", () => {
    expect(adjustFilter({ ...NO_ADJUST }, 1)).toBeNull();
    expect(adjustFilter({ ...NO_ADJUST, temperature: 0.5, vignette: 1 }, 1)).toBeNull();
  });
  it("turns each change into its filter, around 1 for as recorded", () => {
    expect(adjustFilter({ ...NO_ADJUST, brightness: 0.2, contrast: -0.1, saturation: -1, hue: 45 }, 1)).toBe("brightness(1.2) contrast(0.9) saturate(0) hue-rotate(45deg)");
  });
  it("blurs by the same share of the picture at any canvas size", () => {
    expect(adjustFilter({ ...NO_ADJUST, blur: 12 }, 1)).toBe("blur(12px)");
    expect(adjustFilter({ ...NO_ADJUST, blur: 12 }, 0.25)).toBe("blur(3px)");
  });
});

describe("warmer and cooler", () => {
  it("multiply by a colour that takes out blue, or red", () => {
    expect(temperatureColor(1)).toBe("rgb(255,215,145)");
    expect(temperatureColor(-1)).toBe("rgb(145,215,255)");
    expect(temperatureColor(0.5)).toBe("rgb(255,235,200)");
    expect(needsLayer({ ...NO_ADJUST, temperature: 0.1 })).toBe(true);
    expect(needsLayer({ ...NO_ADJUST, vignette: 0.1 })).toBe(true);
    expect(needsLayer({ ...NO_ADJUST, brightness: 1, blur: 9 })).toBe(false);
  });
});

describe("blend modes", () => {
  it("map to the canvas's own, and Normal sets none", () => {
    expect([compositeOf(undefined), compositeOf("normal"), compositeOf("multiply"), compositeOf("add"), compositeOf("soft-light")]).toEqual([null, null, "multiply", "lighter", "soft-light"]);
  });
  it("are set for the clip alone", () => {
    expect(draw(pictured({}))).toEqual([WHOLE]);
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [pictured({ blend: "screen" })];
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 10, { resolveSource: () => PICTURE });
    expect(names(calls).slice(2, 5)).toEqual(["save", "set globalAlpha", "set globalCompositeOperation"]);
    expect(calls[4]).toEqual(["set globalCompositeOperation", "screen"]);
    expect(names(calls).at(-1)).toBe("restore"); // which takes the blend off again
  });
  it("work on text too", () => {
    const d = docWithCaptions("short_9x16");
    d.tracks[1].clips = [text("x", 0, 30, { blend: "add" })];
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, 10);
    expect(calls).toContainEqual(["set globalCompositeOperation", "lighter"]);
  });
});

describe("drawing a picture's colours", () => {
  it("a picture as recorded draws exactly as before, also once its colours were touched", () => {
    expect(draw(pictured({ adjust: { brightness: 0, blur: 0 } }))).toEqual([WHOLE]);
  });

  it("brightness, contrast, saturation, hue and blur are one filter on the frame", () => {
    expect(draw(pictured({ adjust: { brightness: 0.1, saturation: 0.5, blur: 8 } }))).toEqual([["set filter", "brightness(1.1) saturate(1.5) blur(8px)"], WHOLE]);
  });

  it("warmth is multiplied in on a layer of the picture's own, then the layer joins the frame", () => {
    const layer = fakeCtx();
    const onFrame = draw(pictured({ adjust: { temperature: 1, contrast: 0.2 } }), layer);
    expect(layer.calls).toEqual([
      ["save"], ["setTransform", 1, 0, 0, 1, 0, 0], ["clearRect", 0, 0, 1080, 1920], ["setTransform", expect.anything()],
      ["set filter", "contrast(1.2)"], WHOLE, ["set filter", "none"],
      ["set globalCompositeOperation", "multiply"], ["set fillStyle", "rgb(255,215,145)"], ["fillRect", -540, -960, 1080, 1920],
      ["restore"],
    ]);
    expect(onFrame).toEqual([["setTransform", 1, 0, 0, 1, 0, 0], ["drawImage", expect.anything(), 0, 0], ["setTransform", expect.anything()]]);
  });

  it("an image's see-through parts stay see-through under the warmth", () => {
    const layer = fakeCtx();
    draw(pictured({ type: "image", adjust: { temperature: -0.5 } }), layer);
    const after = layer.calls.slice(names(layer.calls).indexOf("fillRect") + 1);
    expect(after).toEqual([["set globalCompositeOperation", "destination-in"], WHOLE, ["restore"]]);
  });

  it("a vignette darkens the corners of the picture only", () => {
    const layer = fakeCtx();
    draw(pictured({ adjust: { vignette: 0.6 } }), layer);
    const reach = Math.hypot(1080, 1920) / 2;
    expect(layer.calls).toContainEqual(["createRadialGradient", 0, 0, reach * 0.45, 0, 0, reach]);
    expect(layer.calls).toContainEqual(["set globalCompositeOperation", "source-atop"]);
    expect(names(layer.calls)).not.toContain("set filter");
  });

  it("with no layer to be had, the filter's share is still drawn", () => {
    expect(draw(pictured({ adjust: { temperature: 1, brightness: 0.2 } }))).toEqual([["set filter", "brightness(1.2)"], WHOLE]);
    expect(draw(pictured({ adjust: { temperature: 1 } }))).toEqual([WHOLE]);
  });

  it("a cropped picture is warmed inside what is kept", () => {
    const layer = fakeCtx();
    draw(pictured({ adjust: { temperature: 1 }, transform: { ...DEFAULT_TRANSFORM, crop: { left: 0.5, top: 0, right: 0, bottom: 0 } } }), layer);
    expect(layer.calls).toContainEqual(["fillRect", 0, -960, 540, 1920]);
  });
});

describe("a mirrored picture", () => {
  it("is turned over about its own middle", () => {
    const sideways = draw(pictured({ transform: { ...DEFAULT_TRANSFORM, flipH: true } }));
    expect(sideways).toEqual([["translate", 0, 0], ["scale", -1, 1], ["translate", -0, -0], WHOLE]);
    expect(draw(pictured({ transform: { ...DEFAULT_TRANSFORM, flipV: true } }))[1]).toEqual(["scale", 1, -1]);
    expect(draw(pictured({ transform: { ...DEFAULT_TRANSFORM, flipH: false, flipV: false } }))).toEqual([WHOLE]);
  });
  it("stays where it is when it is cropped", () => {
    // The right half is kept: its middle is 270 px right of the clip's centre.
    const calls = draw(pictured({ transform: { ...DEFAULT_TRANSFORM, flipH: true, crop: { left: 0.5, top: 0, right: 0, bottom: 0 } } }));
    expect(calls.slice(0, 3)).toEqual([["translate", 270, 0], ["scale", -1, 1], ["translate", -270, -0]]);
  });
});
