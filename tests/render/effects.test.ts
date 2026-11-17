import { describe, expect, it } from "vitest";
import { clipLook, effectWindows } from "@/lib/render/effects";
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
      transform: effectiveTransform(c, 110), alpha: 1, ghosts: [], dip: null, reveal: null, litWord: null, litColor: null,
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

  it("slides in from the left and settles on the base x", () => {
    const c = media({ transitionIn: { kind: "slide", frames: 10 } });
    expect(clipLook(c, 100, doc).transform.x).toBeLessThan(0);
    expect(clipLook(c, 109, doc).transform.x).toBe(0.5);
  });

  it("slides in from above and out downward", () => {
    const c = media({ transitionIn: { kind: "slide", frames: 10, direction: "up" }, transitionOut: { kind: "slide", frames: 10, direction: "down" } });
    expect(clipLook(c, 100, doc).transform.y).toBeLessThan(0.5);
    expect(clipLook(c, 159, doc).transform.y).toBeCloseTo(1.5);
  });

  it("zooms in to the base scale", () => {
    const c = media({ transitionIn: { kind: "zoom", frames: 10 } });
    expect(clipLook(c, 100, doc).transform.scale).toBeGreaterThan(1);
    expect(clipLook(c, 109, doc).transform.scale).toBeCloseTo(1);
  });

  it("whips with three trailing ghosts only inside the window", () => {
    const c = media({ transitionIn: { kind: "whip", frames: 10 } });
    const look = clipLook(c, 104, doc);
    expect(look.ghosts.map((g) => g.alpha)).toEqual([0.45, 0.25, 0.12]);
    expect(look.ghosts[0].dx).toBeCloseTo(-0.06 * 1000);
    expect(clipLook(c, 110, doc).ghosts).toEqual([]);
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

  it("slides text from the named side", () => {
    const c = text({ animationIn: { preset: "slide_left", frames: 10 } });
    expect(clipLook(c, 0, doc).transform.x).toBeLessThan(0.5);
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
    expect(clipLook(c, 100, doc).transform.x).toBeLessThan(0.2);
  });
});
