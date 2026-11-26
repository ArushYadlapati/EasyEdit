import { describe, expect, it } from "vitest";
import { MASK_START, clipFieldOps, clipFieldValue, fieldContext, type ClipField } from "@/lib/editor/inspector-fields";
import { findClip } from "@/lib/editor/store";
import { drawFrame, type Ctx2D, type LayerUse, type ResolvedSource } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, applyOps, describe as describeDoc, prepareOps, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx, type Call } from "../render/fake-ctx";

const c1 = (d: TimelineDoc) => findClip(d, "c1")!.clip as MediaClip;
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const patch = (clipId: string, p: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId, patch: p }];
const MASK = { shape: "ellipse" as const, x: 0.5, y: 0.25, width: 0.5, height: 0.25, feather: 0.2 };

describe("a mask in the ops", () => {
  it("is one value on a picture: set whole, undone to none, guarded by an expect", () => {
    const set = run(sampleDoc(), patch("c1", { mask: MASK }));
    expect(c1(set.doc).mask).toEqual(MASK);
    expect(c1(applyOps(set.doc, JSON.parse(JSON.stringify(set.inverse))).doc).mask).toBeNull();
    const guarded: OpInput[] = [{ op: "update_clip", clipId: "c1", patch: { mask: { ...MASK, invert: true } }, expect: { mask: null } }];
    const after = run(sampleDoc(), guarded).doc;
    expect(c1(after).mask?.invert).toBe(true);
    expect(() => run(after, guarded)).toThrow();
  });
  it("stays in range, and only pictures and adjustment layers take one", () => {
    const d = sampleDoc();
    d.tracks[3].clips = [video("m1", 0, 30, { type: "audio" })];
    expect(() => run(d, patch("c1", { mask: { ...MASK, width: 0 } }))).toThrow(/mask/);
    expect(() => run(d, patch("c1", { mask: { ...MASK, feather: 2 } }))).toThrow(/mask/);
    expect(() => run(d, patch("c1", { mask: { ...MASK, shape: "star" } }))).toThrow(/mask/);
    expect(() => run(d, patch("c1", { mask: { ...MASK, blur: 1 } }))).toThrow();
    expect(() => run(d, patch("x1", { mask: MASK }))).toThrow(/"mask" is not allowed on a text clip/);
    expect(() => run(d, patch("m1", { mask: MASK }))).toThrow(/"mask" is not allowed on an audio clip/);
    const layered = run(d, [{ op: "add_track", track: { id: "o1", kind: "overlay", name: "Overlay 1" }, index: 1 }, { op: "add_clip", trackId: "o1", clip: { id: "adj", type: "adjustment", start: 0, duration: 30, transform: { ...DEFAULT_TRANSFORM }, mask: MASK } }]).doc;
    expect(findClip(layered, "adj")!.clip).toMatchObject({ mask: MASK });
  });
  it("is listed for agents", () => {
    expect(describeDoc(sampleDoc(), { detail: true })).not.toContain("mask=");
    expect(describeDoc(run(sampleDoc(), patch("c1", { mask: MASK })).doc, { detail: true })).toContain(`mask=${JSON.stringify(MASK)}`);
  });
});

describe("the mask's fields", () => {
  const field = (d: TimelineDoc, name: ClipField, raw: string, id = "c1") => clipFieldOps(findClip(d, id)!.clip, name, raw, fieldContext(d, findClip(d, id)!.clip));
  const shown = (d: TimelineDoc, name: ClipField, id = "c1") => clipFieldValue(findClip(d, id)!.clip, name, fieldContext(d, findClip(d, id)!.clip));
  it("turn it on as an ellipse in the middle, and off again", () => {
    const d = sampleDoc();
    expect(shown(d, "mask")).toBe("off");
    expect(field(d, "mask", "on")).toEqual(patch("c1", { mask: MASK_START }));
    expect(field(d, "mask", "off")).toEqual([]);
    const on = run(d, field(d, "mask", "on")!).doc;
    expect([shown(on, "mask"), shown(on, "maskShape"), shown(on, "maskX"), shown(on, "maskWidth"), shown(on, "maskFeather"), shown(on, "maskInvert")]).toEqual(["on", "ellipse", "50", "60", "10", "off"]);
    expect(field(on, "mask", "off")).toEqual(patch("c1", { mask: null }));
    expect(field(d, "mask", "on", "x1")).toBeNull();
    expect(shown(d, "mask", "x1")).toBe("");
  });
  it("set each part, with the whole mask sent, and are nothing while it is off", () => {
    const on = run(sampleDoc(), patch("c1", { mask: MASK_START })).doc;
    expect(field(on, "maskShape", "rect")).toEqual(patch("c1", { mask: { ...MASK_START, shape: "rect" } }));
    expect(field(on, "maskShape", "ellipse")).toEqual([]);
    expect(field(on, "maskShape", "star")).toBeNull();
    expect(field(on, "maskX", "25")).toEqual(patch("c1", { mask: { ...MASK_START, x: 0.25 } }));
    expect(field(on, "maskWidth", "0")).toEqual(patch("c1", { mask: { ...MASK_START, width: 0.01 } }));
    expect(field(on, "maskFeather", "900")).toEqual(patch("c1", { mask: { ...MASK_START, feather: 1 } }));
    expect(field(on, "maskInvert", "on")).toEqual(patch("c1", { mask: { ...MASK_START, invert: true } }));
    expect(field(on, "maskHeight", "tall")).toBeNull();
    for (const ops of [field(on, "maskX", "25"), field(on, "maskInvert", "on")]) expect(() => run(on, ops!)).not.toThrow();
    const off = sampleDoc();
    expect([shown(off, "maskX"), field(off, "maskX", "25"), field(off, "maskShape", "rect")]).toEqual(["", null, null]);
  });
});

describe("drawing a masked picture", () => {
  const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 1080, height: 1920 };
  const WHOLE = ["drawImage", PICTURE.image, -540, -960, 1080, 1920];
  function draw(extra: Record<string, unknown>, withLayers = true) {
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [video("c", 0, 30, extra)];
    const { ctx, calls } = fakeCtx();
    (ctx as unknown as { canvas: unknown }).canvas = { width: 1080, height: 1920 };
    const layers = new Map<LayerUse, { ctx: Ctx2D; calls: Call[] }>();
    drawFrame(ctx, d, 10, {
      resolveSource: () => PICTURE,
      finish: null,
      makeLayer: (_w, _h, use) => {
        if (!withLayers) return null;
        if (!layers.has(use)) {
          const made = fakeCtx();
          (made.ctx as unknown as { canvas: unknown }).canvas = { width: 1080, height: 1920, use };
          made.calls.length = 0;
          layers.set(use, made);
        }
        return layers.get(use)!.ctx;
      },
    });
    return { onFrame: calls.slice(calls.findIndex(([name]) => name === "scale") + 1, -1), layers };
  }

  it("paints it whole on a layer, keeps the mask's part of that layer, and draws the layer onto the frame", () => {
    const { onFrame, layers } = draw({ mask: MASK });
    const layer = layers.get("mask")!;
    expect(layer.calls).toEqual([
      ["save"], ["setTransform", 1, 0, 0, 1, 0, 0], ["clearRect", 0, 0, 1080, 1920], ["setTransform", expect.anything()],
      WHOLE,
      ["set globalCompositeOperation", "destination-in"],
      // A fifth of its shorter half: 0.2 × (480 / 2 … the ellipse is 540 wide and 480 tall) = 48 px.
      ["set filter", "blur(48px)"],
      ["set fillStyle", "#000000"], ["beginPath"],
      // Centred across, a quarter of the way down: 1920 × 0.25 − 960 = −480.
      ["ellipse", 0, -480, 270, 240, 0, 0, Math.PI * 2],
      ["fill"], ["restore"],
    ]);
    expect(onFrame).toEqual([["setTransform", 1, 0, 0, 1, 0, 0], ["drawImage", { width: 1080, height: 1920, use: "mask" }, 0, 0], ["setTransform", expect.anything()]]);
  });
  it("a box with a hard edge sets no blur, and an inverted mask takes its part out", () => {
    const { layers } = draw({ mask: { shape: "rect", x: 0.5, y: 0.5, width: 0.5, height: 0.5, feather: 0, invert: true } });
    const calls = layers.get("mask")!.calls;
    expect(calls).toContainEqual(["set globalCompositeOperation", "destination-out"]);
    expect(calls).toContainEqual(["rect", -270, -480, 540, 960]);
    expect(calls.map(([name]) => name)).not.toContain("set filter");
  });
  it("is measured on what a crop keeps", () => {
    const { layers } = draw({ mask: { ...MASK, shape: "rect", x: 0.5, y: 0.5, width: 1, height: 1, feather: 0 }, transform: { ...DEFAULT_TRANSFORM, crop: { left: 0.5, top: 0, right: 0, bottom: 0 } } });
    expect(layers.get("mask")!.calls).toContainEqual(["rect", 0, -960, 540, 1920]);
  });
  it("masks the picture after its colours are changed", () => {
    const { layers } = draw({ mask: MASK, adjust: { brightness: 0.2 } });
    const names = layers.get("mask")!.calls.map(([name]) => name);
    expect(names.indexOf("set filter")).toBeLessThan(names.indexOf("drawImage")); // the brightness, on the picture
    expect(layers.get("mask")!.calls.filter(([name]) => name === "set filter").map(([, value]) => value)).toEqual(["brightness(1.2)", "blur(48px)"]);
  });
  it("with no layer to be had, the picture is drawn whole", () => {
    expect(draw({ mask: MASK }, false).onFrame).toEqual([WHOLE]);
    expect(draw({}).onFrame).toEqual([WHOLE]);
  });
  it("on an adjustment layer limits the change to that part of the frame", () => {
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [video("c", 0, 30)];
    d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [{ id: "adj", type: "adjustment", start: 0, duration: 30, transform: { ...DEFAULT_TRANSFORM }, adjust: { blur: 20 }, mask: { shape: "rect", x: 0.5, y: 0.5, width: 0.5, height: 0.5, feather: 0 } }] });
    const { ctx, calls } = fakeCtx();
    (ctx as unknown as { canvas: unknown }).canvas = { width: 1080, height: 1920 };
    const layers = new Map<LayerUse, { ctx: Ctx2D; calls: Call[] }>();
    drawFrame(ctx, d, 10, {
      resolveSource: () => PICTURE,
      finish: null,
      makeLayer: (_w, _h, use) => {
        if (!layers.has(use)) {
          const made = fakeCtx();
          (made.ctx as unknown as { canvas: unknown }).canvas = { width: 1080, height: 1920, use };
          made.calls.length = 0;
          layers.set(use, made);
        }
        return layers.get(use)!.ctx;
      },
    });
    const mask = layers.get("mask")!.calls;
    expect(mask).toContainEqual(["set filter", "blur(20px)"]); // the layer's own blur, on the copied frame
    expect(mask).toContainEqual(["rect", 270, 480, 540, 960]); // the middle quarter of the frame
    expect(calls.at(-2)).toEqual(["setTransform", expect.anything()]);
    expect(calls.filter(([name]) => name === "drawImage").at(-1)).toEqual(["drawImage", { width: 1080, height: 1920, use: "mask" }, 0, 0]);
  });
});
