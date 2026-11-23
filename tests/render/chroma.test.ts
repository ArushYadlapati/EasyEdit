import { describe, expect, it } from "vitest";
import { applyLook } from "@/lib/editor/actions";
import { clipFieldOps, clipFieldValue, fieldContext, type ClipField } from "@/lib/editor/inspector-fields";
import { findClip } from "@/lib/editor/store";
import { CHROMA_START, keyOut } from "@/lib/render/chroma";
import { drawFrame, type Ctx2D, type ResolvedSource } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, applyOps, describe as describeDoc, prepareOps, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx, type Call } from "./fake-ctx";

const px = (...rgba: number[][]) => Uint8ClampedArray.from(rgba.flat());
const alphas = (data: Uint8ClampedArray) => Array.from({ length: data.length / 4 }, (_, i) => data[i * 4 + 3]);
const GREEN = [0, 255, 0, 255];
const RED = [255, 0, 0, 255];
const SKIN = [224, 172, 150, 255];

describe("taking a colour out of a picture", () => {
  it("makes the key colour see-through and leaves other colours whole", () => {
    const data = px(GREEN, RED, SKIN, [255, 255, 255, 255], [0, 0, 0, 255]);
    keyOut(data, CHROMA_START);
    expect(alphas(data)).toEqual([0, 255, 255, 255, 255]);
    expect([...data.slice(0, 3)]).toEqual([0, 255, 0]); // the colours themselves are not touched
  });

  it("takes the shaded and lit greens of a real screen with it", () => {
    const data = px([0, 200, 0, 255], [40, 230, 40, 255], [20, 160, 30, 255]);
    keyOut(data, CHROMA_START);
    expect(alphas(data)).toEqual([0, 0, 0]);
  });

  it("fades the edge back in over the softness, so it is not jagged", () => {
    // A green on its way to grey: further from the key the more it is seen.
    const data = px([60, 230, 60, 255], [110, 200, 110, 255], [140, 180, 140, 255]);
    keyOut(data, { color: "#00ff00", tolerance: 0.3, softness: 0.4 });
    const [near, mid, far] = alphas(data);
    expect(near).toBe(0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(far);
    expect(far).toBeLessThanOrEqual(255);
  });

  it("with no tolerance takes nothing but the exact colour's hue, and leaves see-through pixels alone", () => {
    const data = px(GREEN, [0, 255, 0, 0], RED);
    keyOut(data, { color: "#00ff00", tolerance: 0, softness: 0 });
    expect(alphas(data)).toEqual([0, 0, 255]);
  });

  it("keys any colour", () => {
    const data = px([0, 0, 255, 255], GREEN);
    keyOut(data, { color: "#0000ff", tolerance: 0.3, softness: 0.1 });
    expect(alphas(data)).toEqual([0, 255]);
  });
});

// A 4 × 2 picture, and a key layer that hands back pixels the test set.
const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 4, height: 2 };
function draw(clip: MediaClip, keyLayer?: { ctx: Ctx2D; calls: Call[] }) {
  const d = docWithCaptions("short_9x16");
  d.tracks[0].clips = [clip];
  const { ctx, calls } = fakeCtx();
  drawFrame(ctx, d, 10, { resolveSource: () => PICTURE, makeKeyLayer: keyLayer ? () => keyLayer.ctx : () => null });
  return calls;
}
const pictured = (extra: Record<string, unknown>) => video("c", 0, 30, extra) as MediaClip;

describe("drawing a keyed or rounded picture", () => {
  it("keys the picture on a canvas of its own size and draws from that", () => {
    const layer = fakeCtx();
    const pixels = { data: px(GREEN, RED) };
    const canvas = { tag: "keyed" };
    Object.assign(layer.ctx as unknown as Record<string, unknown>, { getImageData: () => pixels, canvas });
    const calls = draw(pictured({ chroma: CHROMA_START }), layer);
    const drawn = layer.calls.filter(([name]) => !name.startsWith("set "));
    expect(drawn.map(([name]) => name)).toEqual(["clearRect", "drawImage", "putImageData"]);
    expect(drawn[1]).toEqual(["drawImage", PICTURE.image, 0, 0, 4, 2]);
    expect(alphas(pixels.data)).toEqual([0, 255]);
    // The frame draws the keyed canvas, not the file's picture.
    expect(calls.find(([name]) => name === "drawImage")![1]).toBe(canvas);
  });

  it("draws the picture as it is where there is no canvas to key on, or no key", () => {
    expect(draw(pictured({ chroma: CHROMA_START })).find(([name]) => name === "drawImage")![1]).toBe(PICTURE.image);
    expect(draw(pictured({ chroma: null })).find(([name]) => name === "drawImage")![1]).toBe(PICTURE.image);
  });

  it("rounds the corners of what is shown by clipping to a rounded box", () => {
    // Fitted to cover a 1080 × 1920 frame, the picture is 3840 × 1920: fully round is half its short side.
    const calls = draw(pictured({ rounding: 1 }));
    const names = calls.map(([name]) => name);
    expect(names.indexOf("clip")).toBeGreaterThan(-1);
    expect(names.indexOf("clip")).toBeLessThan(names.indexOf("drawImage"));
    expect(calls.filter(([name]) => name === "arcTo").map((call) => call[5])).toEqual([960, 960, 960, 960]);
    expect(draw(pictured({ rounding: 0 })).map(([name]) => name)).not.toContain("clip");
    const half = draw(pictured({ rounding: 0.5, transform: { ...DEFAULT_TRANSFORM, crop: { left: 0.5, top: 0, right: 0, bottom: 0 } } }));
    // The kept half is 1920 × 1920, so half round is a quarter of its side.
    expect(half.filter(([name]) => name === "arcTo").map((call) => call[5])).toEqual([480, 480, 480, 480]);
  });
});

describe("the green screen and rounding in the ops and the inspector", () => {
  const c1 = (d: TimelineDoc) => findClip(d, "c1")!.clip as MediaClip;
  const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
  const field = (d: TimelineDoc, name: ClipField, raw: string, id = "c1") => clipFieldOps(findClip(d, id)!.clip, name, raw, fieldContext(d, findClip(d, id)!.clip));
  const shown = (d: TimelineDoc, name: ClipField) => clipFieldValue(c1(d), name, fieldContext(d, c1(d)));

  it("turn on with a green key, change one number at a time, and undo", () => {
    const d = sampleDoc();
    const on = run(d, field(d, "chroma", "on")!);
    expect(c1(on.doc).chroma).toEqual(CHROMA_START);
    expect(applyOps(on.doc, on.inverse).doc.tracks[0].clips[0]).toMatchObject({ chroma: null });
    const tuned = run(on.doc, field(on.doc, "chromaTolerance", "45")!).doc;
    expect(CHROMA_START).toEqual({ color: "#00ff00", tolerance: 0.4, softness: 0.1 });
    expect(c1(tuned).chroma).toEqual({ color: "#00ff00", tolerance: 0.45, softness: 0.1 });
    expect((["chroma", "chromaColor", "chromaTolerance", "chromaSoftness"] as const).map((f) => shown(tuned, f))).toEqual(["on", "#00ff00", "45", "10"]);
    expect(c1(run(tuned, field(tuned, "chromaColor", "#0000FF")!).doc).chroma!.color).toBe("#0000ff");
    expect(c1(run(tuned, field(tuned, "chroma", "off")!).doc).chroma).toBeNull();
    expect(field(d, "chromaTolerance", "45")).toBeNull(); // nothing to tune while it is off
    expect(field(on.doc, "chroma", "on")).toEqual([]);
  });

  it("round a picture's corners in percent", () => {
    const d = sampleDoc();
    const rounded = run(d, field(d, "rounding", "250")!).doc;
    expect(c1(rounded).rounding).toBe(1);
    expect(shown(rounded, "rounding")).toBe("100");
    expect(field(d, "rounding", "0")).toEqual([]);
    expect(field(d, "rounding", "10", "x1")).toBeNull();
  });

  it("are for pictures only, kept in range, and listed for agents", () => {
    const d = sampleDoc();
    expect(() => run(d, [{ op: "update_clip", clipId: "x1", patch: { rounding: 0.5 } }])).toThrow(/"rounding" is not allowed on a text clip/);
    expect(() => run(d, [{ op: "update_clip", clipId: "c1", patch: { chroma: { color: "green", tolerance: 0.3, softness: 0 } } }])).toThrow(/chroma/);
    expect(() => run(d, [{ op: "update_clip", clipId: "c1", patch: { rounding: 2 } }])).toThrow(/rounding/);
    const set = run(d, [{ op: "update_clip", clipId: "c1", patch: { rounding: 0.25, chroma: CHROMA_START } }]).doc;
    const said = describeDoc(set, { detail: true });
    expect(said).toContain("rounding=0.25");
    expect(said).toContain('chroma={"color":"#00ff00","tolerance":0.4,"softness":0.1}');
  });

  it("a colour look leaves both alone", () => {
    const store = makeStore();
    store.getState().edit([{ op: "update_clip", clipId: "c1", patch: { rounding: 0.5, chroma: CHROMA_START } }], "x");
    applyLook(store, "c1", "warm");
    expect(c1(store.getState().doc)).toMatchObject({ rounding: 0.5, chroma: CHROMA_START });
  });
});
