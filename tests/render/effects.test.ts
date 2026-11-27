import { describe, expect, it } from "vitest";
import { WHIP_SHUTTER, clipLook, effectWindows } from "@/lib/render/effects";
import { effectiveTransform } from "@/lib/timeline/keyframes";
import type { Clip } from "@/lib/timeline/types";

const doc = { width: 1000, height: 500, fps: 30 };
const tf = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, fit: "cover" as const };

function media(over: Record<string, unknown> = {}): Clip {
  return { id: "c", type: "video", start: 100, duration: 60, transform: tf, assetId: "a", in: 0, speed: 1, volume: 1, ...over } as Clip;
}
function text(over: Record<string, unknown> = {}): Clip {
  return {
    id: "t", type: "text", start: 0, duration: 30, transform: tf, text: "Hello",
    style: { fontFamily: "Inter", fontSize: 48, fontWeight: 700, color: "#fff", align: "center" }, ...over,
  } as Clip;
}

describe("clipLook", () => {
  it("a clip with no effects is neutral", () => {
    const c = media();
    expect(clipLook(c, 110, doc)).toEqual({
      transform: effectiveTransform(c, 110), alpha: 1, smear: null, dip: null, reveal: null, litWord: null, litColor: null,
    });
  });

  it("gives audio a neutral look", () => {
    const c = media({ type: "audio" });
    expect(clipLook(c, 100, doc).alpha).toBe(1);
  });

  it("fades in and out", () => {
    const c = media({ transitionIn: { kind: "fade", frames: 10 }, transitionOut: { kind: "fade", frames: 10 } });
    expect(clipLook(c, 100, doc).alpha).toBeCloseTo(0.1);
    expect(clipLook(c, 109, doc).alpha).toBe(1);
    expect(clipLook(c, 120, doc).alpha).toBe(1);
    expect(clipLook(c, 150, doc).alpha).toBeCloseTo(0.9);
    expect(clipLook(c, 159, doc).alpha).toBe(0);
  });

  it("treats a crossfade in like a fade", () => {
    const c = media({ transitionIn: { kind: "crossfade", frames: 10 } });
    expect(clipLook(c, 100, doc).alpha).toBeCloseTo(0.1);
  });

  it("slides left: enters from the right edge and settles on the base x", () => {
    const c = media({ transitionIn: { kind: "slide", frames: 10 } });
    expect(clipLook(c, 100, doc).transform.x).toBeGreaterThan(1);
    expect(clipLook(c, 109, doc).transform.x).toBe(0.5);
  });

  it("slides up in from below and down out the bottom", () => {
    const c = media({ transitionIn: { kind: "slide", frames: 10, direction: "up" }, transitionOut: { kind: "slide", frames: 10, direction: "down" } });
    expect(clipLook(c, 100, doc).transform.y).toBeGreaterThan(1);
    expect(clipLook(c, 159, doc).transform.y).toBeCloseTo(1.5);
  });

  it("zooms in to the base scale", () => {
    const c = media({ transitionIn: { kind: "zoom", frames: 10 } });
    expect(clipLook(c, 100, doc).transform.scale).toBeGreaterThan(1);
    expect(clipLook(c, 109, doc).transform.scale).toBeCloseTo(1);
  });

  it("a whip smears along its move, longest where it is fastest and not at all at rest", () => {
    const c = media({ transitionIn: { kind: "whip", frames: 10 } });
    // Halfway in, ease_in_out is at its fastest: 3 frame widths per 10 frames, 9 a second, so a thirtieth of a second
    // of it is 0.3 of the width. It moves left, so it smears left.
    expect(clipLook(c, 104, doc).smear).toEqual({ dx: expect.closeTo(-0.3 * 1000, 6), dy: 0 });
    const lengths = Array.from({ length: 10 }, (_, i) => Math.abs(clipLook(c, 100 + i, doc).smear?.dx ?? 0));
    expect(lengths.indexOf(Math.max(...lengths))).toBe(4);
    for (let i = 1; i <= 4; i++) expect(lengths[i]).toBeGreaterThan(lengths[i - 1]);
    for (let i = 5; i < 10; i++) expect(lengths[i]).toBeLessThan(lengths[i - 1]);
    expect(clipLook(c, 109, doc).smear).toBeNull(); // the last frame in: at rest
    expect(clipLook(c, 110, doc).smear).toBeNull();
    expect(clipLook(c, 109, doc).transform.x).toBe(0.5);
  });

  it("a faster whip smears further, by its speed a second", () => {
    const at = (frames: number) => Math.abs(clipLook(media({ transitionIn: { kind: "whip", frames } }), 100 + frames / 2 - 1, doc).smear!.dx);
    expect(at(10)).toBeCloseTo(2 * at(20));
    expect(at(20)).toBeCloseTo(3 * (30 / 20) * WHIP_SHUTTER * 1000);
  });

  it("a whip of the same length in seconds smears the same at any frame rate", () => {
    const at30 = clipLook(media({ transitionIn: { kind: "whip", frames: 10 } }), 104, doc).smear!;
    const at60 = clipLook(media({ start: 200, duration: 120, transitionIn: { kind: "whip", frames: 20 } }), 209, { ...doc, fps: 60 }).smear!;
    expect(at60.dx).toBeCloseTo(at30.dx);
    const at24 = clipLook(media({ transitionIn: { kind: "whip", frames: 8 } }), 103, { ...doc, fps: 24 }).smear!;
    expect(at24.dx).toBeCloseTo(at30.dx);
  });

  it("a whip smears along its own direction, by the frame's height for up and down, and never past half the frame", () => {
    const up = clipLook(media({ transitionIn: { kind: "whip", frames: 10, direction: "up" } }), 104, doc).smear!;
    expect(up).toEqual({ dx: 0, dy: expect.closeTo(-0.3 * 500, 6) });
    const right = clipLook(media({ transitionIn: { kind: "whip", frames: 10, direction: "right" } }), 104, doc).smear!;
    expect(right.dx).toBeCloseTo(0.3 * 1000);
    // Two frames: 45 frame widths a second, a smear of 1.5 widths, cut to half.
    expect(clipLook(media({ transitionIn: { kind: "whip", frames: 2 } }), 100, doc).smear!.dx).toBeCloseTo(-0.5 * 1000);
  });

  it("a shape whips and smears as a video does; text never does", () => {
    const shape = media({ type: "shape", transitionIn: { kind: "whip", frames: 10 } });
    expect(clipLook(shape, 104, doc).smear).toEqual(clipLook(media({ transitionIn: { kind: "whip", frames: 10 } }), 104, doc).smear);
    const t = text({ animationIn: { preset: "slide_left", frames: 10 } });
    expect(clipLook(t, 4, doc).smear).toBeNull();
  });

  it("a whip cut short by its clip smears by the window it has", () => {
    // Two 30-frame whips on a 20-frame clip each get 10 frames: as fast as a 10-frame whip.
    const short = media({ duration: 20, transitionIn: { kind: "whip", frames: 30 }, transitionOut: { kind: "whip", frames: 30 } });
    expect(clipLook(short, 104, doc).smear).toEqual(clipLook(media({ transitionIn: { kind: "whip", frames: 10 } }), 104, doc).smear);
  });

  it("dips in with the chosen colour, fading out the fill", () => {
    const c = media({ transitionIn: { kind: "dip", frames: 10, color: "#ff0000" } });
    const first = clipLook(c, 100, doc).dip!;
    expect(first.color).toBe("#ff0000");
    expect(first.alpha).toBeCloseTo(0.9);
    expect(clipLook(c, 109, doc).dip!.alpha).toBe(0);
    expect(clipLook(c, 110, doc).dip).toBeNull();
  });

  it("defaults the dip to black", () => {
    const c = media({ transitionOut: { kind: "dip", frames: 10 } });
    expect(clipLook(c, 159, doc).dip).toEqual({ color: "#000000", alpha: 1 });
  });

  it("cuts oversized windows to half and keeps every alpha sane", () => {
    const c = media({ duration: 10, transitionIn: { kind: "fade", frames: 30 }, transitionOut: { kind: "fade", frames: 30 } });
    expect(effectWindows(c)).toEqual({ inFrames: 5, outFrames: 5 });
    for (let f = 100; f < 110; f++) {
      const a = clipLook(c, f, doc).alpha;
      expect(Number.isFinite(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it("pops text in from a smaller scale", () => {
    const c = text({ animationIn: { preset: "pop", frames: 10 } });
    const look = clipLook(c, 0, doc);
    expect(look.transform.scale).toBeLessThan(1);
    expect(look.alpha).toBeCloseTo(0.2);
  });

  it("types text out by grapheme count", () => {
    const c = text({ animationIn: { preset: "typewriter", frames: 10 } });
    expect(clipLook(c, 3, doc).reveal).toBe(2);
    expect(clipLook(c, 10, doc).reveal).toBeNull();
  });

  it("slides text the way it is named: slide_left comes from the right", () => {
    const c = text({ animationIn: { preset: "slide_left", frames: 10 } });
    expect(clipLook(c, 0, doc).transform.x).toBeGreaterThan(0.5);
    expect(clipLook(c, 9, doc).transform.x).toBe(0.5);
  });

  it("lights words evenly", () => {
    const c = text({ text: "go team go", emphasis: { preset: "highlight_word" } });
    expect(clipLook(c, 0, doc).litWord).toBe(0);
    expect(clipLook(c, 15, doc).litWord).toBe(1);
    expect(clipLook(c, 29, doc).litWord).toBe(2);
    expect(clipLook(c, 0, doc).litColor).toBe("#FFD400");
  });

  it("shakes deterministically", () => {
    const c = text({ emphasis: { preset: "shake" } });
    expect(clipLook(c, 7, doc)).toEqual(clipLook(c, 7, doc));
    expect(clipLook(c, 7, doc).transform.x).not.toBe(0.5);
  });

  it("applies keyframes before offsets", () => {
    const c = media({
      keyframes: { x: [{ at: 0, value: 0.2 }] },
      transitionIn: { kind: "slide", frames: 10 },
    });
    expect(clipLook(c, 109, doc).transform.x).toBe(0.2);
    expect(clipLook(c, 100, doc).transform.x).toBeGreaterThan(0.2);
  });

  it("slide_up rises from below and the out preset keeps moving up", () => {
    const c = text({ animationIn: { preset: "slide_up", frames: 10 }, animationOut: { preset: "slide_up", frames: 10 } });
    expect(clipLook(c, 0, doc).transform.y).toBeGreaterThan(0.5);
    expect(clipLook(c, 0, doc).transform.y).toBeLessThanOrEqual(0.58);
    expect(clipLook(c, 29, doc).transform.y).toBeCloseTo(0.42);
  });

  it("text out presets fade and pop away", () => {
    const f = text({ animationOut: { preset: "fade", frames: 10 } });
    expect(clipLook(f, 29, doc).alpha).toBe(0);
    expect(clipLook(f, 20, doc).alpha).toBeCloseTo(0.9);
    const p = text({ animationOut: { preset: "pop", frames: 10 } });
    expect(clipLook(p, 29, doc).alpha).toBe(0);
    expect(clipLook(p, 29, doc).transform.scale).toBeLessThan(0.01);
  });

  it("pop overshoots the base scale late in the window", () => {
    const c = text({ animationIn: { preset: "pop", frames: 10 } });
    const s = clipLook(c, 6, doc).transform.scale;
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThan(1.15);
  });

  it("zoom starts at exactly 1.25 minus one frame's share", () => {
    const c = media({ transitionIn: { kind: "zoom", frames: 10 } });
    expect(clipLook(c, 100, doc).transform.scale).toBeCloseTo(1.25 - 0.25 / 10);
  });

  it("scale_punch starts big and settles to base", () => {
    const c = text({ animationIn: { preset: "scale_punch", frames: 10 } });
    expect(clipLook(c, 0, doc).transform.scale).toBeGreaterThan(1.25);
    expect(clipLook(c, 9, doc).transform.scale).toBeCloseTo(1);
  });

  it("pulse swings around the base scale with a 0.8 s period", () => {
    const c = text({ emphasis: { preset: "pulse" } });
    const scales = Array.from({ length: 24 }, (_, f) => clipLook(c, f, doc).transform.scale);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.05);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.95);
    expect(Math.max(...scales)).toBeGreaterThan(1.04);
    expect(clipLook(c, 0, doc).transform.scale).toBeCloseTo(1);
    expect(clipLook(c, 24, doc).transform.scale).toBeCloseTo(1);
  });

  it("shake stays within its bounds", () => {
    const c = text({ duration: 400, emphasis: { preset: "shake" } });
    for (let f = 0; f < 400; f++) {
      const t = clipLook(c, f, doc).transform;
      expect(Math.abs(t.x - 0.5)).toBeLessThanOrEqual(0.006 + 1e-9);
      expect(Math.abs(t.y - 0.5) * doc.height).toBeLessThanOrEqual(0.006 * doc.width + 1e-9);
      expect(Math.abs(t.rotation)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });

  it("a whip out smears as it leaves, from a standstill to its fastest and down to nothing once it is off the frame", () => {
    const c = media({ transitionOut: { kind: "whip", frames: 10 } });
    expect(clipLook(c, 149, doc).smear).toBeNull();
    expect(clipLook(c, 150, doc).smear!.dx).toBeLessThan(0);
    expect(clipLook(c, 154, doc).smear!.dx).toBeCloseTo(-0.3 * 1000);
    expect(clipLook(c, 159, doc).smear).toBeNull();
    expect(clipLook(c, 159, doc).transform.x).toBeCloseTo(-0.5);
  });

  it("keeps a lone effect up to the clip's length and cuts only the side that does not fit", () => {
    const windows = (inF: number, outF: number, duration = 20) =>
      effectWindows(media({ duration, transitionIn: inF ? { kind: "fade", frames: inF } : null, transitionOut: outF ? { kind: "fade", frames: outF } : null }));
    expect(windows(30, 0)).toEqual({ inFrames: 20, outFrames: 0 });
    expect(windows(0, 30)).toEqual({ inFrames: 0, outFrames: 20 });
    expect(windows(5, 30)).toEqual({ inFrames: 5, outFrames: 15 });
    expect(windows(30, 5)).toEqual({ inFrames: 15, outFrames: 5 });
    expect(windows(30, 30)).toEqual({ inFrames: 10, outFrames: 10 });
    expect(windows(12, 8)).toEqual({ inFrames: 12, outFrames: 8 });
    expect(windows(30, 30, 1)).toEqual({ inFrames: 0, outFrames: 0 });
    const lone = media({ duration: 20, transitionIn: { kind: "fade", frames: 30 } });
    expect(clipLook(lone, 100, doc).alpha).toBeCloseTo(1 / 20);
    expect(clipLook(lone, 119, doc).alpha).toBe(1);
  });

  it("copes with a one-frame clip and frames outside the clip", () => {
    const c = media({ duration: 1, transitionIn: { kind: "fade", frames: 10 }, transitionOut: { kind: "fade", frames: 10 } });
    expect(effectWindows(c)).toEqual({ inFrames: 0, outFrames: 0 });
    expect(clipLook(c, 100, doc).alpha).toBe(1);
    const d = media({ transitionIn: { kind: "fade", frames: 10 }, transitionOut: { kind: "fade", frames: 10 } });
    expect(clipLook(d, 50, doc).alpha).toBeGreaterThanOrEqual(0);
    expect(clipLook(d, 50, doc).alpha).toBeLessThanOrEqual(1);
    expect(clipLook(d, 400, doc).alpha).toBe(0);
  });
});
