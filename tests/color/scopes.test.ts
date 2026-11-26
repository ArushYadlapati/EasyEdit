import { describe, expect, it, vi } from "vitest";
import { glow, histogram, vectorPlace, vectorscope, waveform } from "@/lib/color/scopes";
import { createFrameTap, frameTapOf } from "@/lib/editor/frame-tap";

const pixels = (...colors: [number, number, number][]) => new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));

describe("a histogram", () => {
  it("counts each pixel once at its red, green, blue and brightness", () => {
    const h = histogram(pixels([10, 20, 30], [10, 200, 30], [255, 255, 255]));
    expect([h.r[10], h.g[20], h.g[200], h.b[30], h.r[255]]).toEqual([2, 1, 1, 2, 1]);
    // Brightness weighs green most: 0.2126 × 10 + 0.7152 × 200 + 0.0722 × 30 ≈ 147.
    expect(h.luma[147]).toBe(1);
    expect([...h.r].reduce((a, b) => a + b, 0)).toBe(3);
  });
  it("scales to its tallest bar, leaving pure black and white out so they do not flatten the rest", () => {
    const h = histogram(pixels([0, 0, 0], [0, 0, 0], [0, 0, 0], [255, 255, 255], [255, 255, 255], [90, 90, 90]));
    expect([h.r[0], h.r[255], h.most]).toEqual([3, 2, 1]);
    expect(histogram(new Uint8ClampedArray(0)).most).toBe(1);
  });
});

describe("a waveform", () => {
  it("keeps where across the frame each brightness is", () => {
    // Two pixels wide, two tall: the left column dark, the right one bright.
    const w = waveform(pixels([20, 20, 20], [220, 220, 220], [20, 20, 20], [230, 230, 230]), 2, 2, 2);
    expect([w.counts[0 * 256 + 20], w.counts[1 * 256 + 220], w.counts[1 * 256 + 230], w.counts[1 * 256 + 20]]).toEqual([2, 1, 1, 0]);
    expect(w.most).toBe(2);
  });
  it("gathers a wide frame into fewer strips", () => {
    const row = Array.from({ length: 8 }, (_, x) => [x * 30, x * 30, x * 30] as [number, number, number]);
    const w = waveform(pixels(...row), 8, 1, 4);
    expect([w.counts[0 * 256 + 0], w.counts[0 * 256 + 30], w.counts[3 * 256 + 180], w.counts[3 * 256 + 210]]).toEqual([1, 1, 1, 1]);
  });
});

describe("a vectorscope", () => {
  it("puts grey of any brightness in the middle", () => {
    const v = vectorscope(pixels([0, 0, 0], [128, 128, 128], [255, 255, 255]), 101);
    expect(v.counts[50 * 101 + 50]).toBe(3);
    expect(vectorPlace(128, 128, 128)).toEqual({ x: 0.5, y: 0.5 });
  });
  it("puts each colour in its own direction, further out the stronger it is", () => {
    const red = vectorPlace(255, 0, 0);
    const blue = vectorPlace(0, 0, 255);
    const green = vectorPlace(0, 255, 0);
    expect(red.y).toBeLessThan(0.1); // up: Cr
    expect(blue.x).toBeGreaterThan(0.9); // right: Cb
    expect(green.x).toBeLessThan(0.5);
    expect(green.y).toBeGreaterThan(0.5);
    const pale = vectorPlace(255, 128, 128);
    expect(Math.hypot(pale.x - 0.5, pale.y - 0.5)).toBeLessThan(Math.hypot(red.x - 0.5, red.y - 0.5));
    for (const c of [red, blue, green]) for (const n of [c.x, c.y]) expect(n >= 0 && n <= 1).toBe(true);
    const v = vectorscope(pixels([255, 0, 0]), 101);
    expect(v.counts[Math.round(red.y * 100) * 101 + Math.round(red.x * 100)]).toBe(1);
  });
});

describe("how bright a count is drawn", () => {
  it("is nothing for none, something for one, and full for the most", () => {
    expect(glow(0, 100)).toBe(0);
    expect(glow(1, 100)).toBeGreaterThan(0.1);
    expect(glow(100, 100)).toBe(1);
    expect(glow(1000, 100)).toBe(1);
  });
});

describe("the tap on the preview's frames", () => {
  it("tells its readers when the canvas is set and each time a frame is drawn, until they leave", () => {
    const tap = createFrameTap();
    const told = vi.fn();
    const leave = tap.subscribe(told);
    expect(tap.canvas()).toBeNull();
    const canvas = {} as CanvasImageSource;
    tap.set(canvas);
    tap.drawn();
    expect([tap.canvas(), told.mock.calls.length]).toEqual([canvas, 2]);
    leave();
    tap.drawn();
    expect(told).toHaveBeenCalledTimes(2);
  });
  it("is one per editor", () => {
    const a = {};
    expect(frameTapOf(a)).toBe(frameTapOf(a));
    expect(frameTapOf(a)).not.toBe(frameTapOf({}));
  });
});
