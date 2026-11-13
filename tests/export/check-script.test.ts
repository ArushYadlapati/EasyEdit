import { describe, expect, it } from "vitest";
import { RULES, compareFrames, parseStillName } from "../../scripts/export-check/compare.mjs";

const W = 96;
const H = 64;
type Rgb = [number, number, number];
function frame(paint: (set: (x: number, y: number, rgb: Rgb) => void) => void): Uint8Array {
  const pixels = new Uint8Array(W * H * 3);
  paint((x, y, rgb) => {
    if (x >= 0 && y >= 0 && x < W && y < H) pixels.set(rgb, (y * W + x) * 3);
  });
  return pixels;
}
// A 36 × 24 block of one color on black, moved by (dx, dy).
const block = (rgb: Rgb = [255, 212, 0], dx = 0, dy = 0) =>
  frame((set) => {
    for (let y = 20; y < 44; y++) for (let x = 30; x < 66; x++) set(x + dx, y + dy, rgb);
  });
const noisy = (pixels: Uint8Array) => pixels.map((v, i) => Math.max(0, Math.min(255, v + (i % 2 ? 3 : -3))));
const BLACK = frame(() => {});

describe("comparing a video frame with a saved preview frame", () => {
  it("fixes its thresholds up front", () => {
    expect(RULES).toEqual({ maxDiff: 12, controlRatio: 3, maxColorShift: 12, inkLevel: 32, minInkPixels: 50, pad: 8, shift: 6, blankMaxDiff: 4 });
  });

  it("passes a frame that equals the still, and one with a little encoder noise", () => {
    expect(compareFrames(block(), block(), W, H)).toMatchObject({ pass: true, blank: false, diff: 0, color: 0, why: [] });
    const result = compareFrames(noisy(block()), block(), W, H);
    expect(result.pass).toBe(true);
    expect(result.diff).toBeGreaterThan(0);
    expect(result.diff).toBeLessThanOrEqual(3);
  });

  it("fails a frame with nothing drawn, and a frame drawn in the wrong place", () => {
    const empty = compareFrames(BLACK, block(), W, H);
    expect(empty.pass).toBe(false);
    expect(empty.why).toEqual(["diff", "black", "shifted", "color"]);
    const moved = compareFrames(block(undefined, 6, 6), block(), W, H);
    expect(moved.pass).toBe(false);
    expect(moved.why).toContain("diff");
  });

  it("fails a frame whose colors drifted, even when the shapes match", () => {
    const drifted = compareFrames(block([235, 190, 0]), block(), W, H);
    expect(drifted.diff).toBeLessThanOrEqual(RULES.maxDiff);
    expect(drifted.color).toBe(22);
    expect(drifted).toMatchObject({ pass: false, why: ["color"] });
  });

  it("compares a blank still over the whole frame", () => {
    expect(compareFrames(BLACK, BLACK, W, H)).toMatchObject({ pass: true, blank: true, diff: 0, black: null, shifted: null, color: null });
    expect(compareFrames(block(), BLACK, W, H)).toMatchObject({ pass: false, blank: true, why: ["diff"] });
  });

  it("skips a control the still itself is within 1 of", () => {
    // 64 dim dots on a 12 × 8 grid: the still is within 1 of black, and moving it 6 pixels lands no dot on another
    const dots = frame((set) => {
      for (let y = 0; y < 64; y += 8) for (let x = 0; x < 96; x += 12) set(x, y, [40, 40, 40]);
    });
    expect(compareFrames(dots, dots, W, H)).toMatchObject({ pass: true, blank: false, black: null, shifted: null, color: null });
  });

  it("measures no color without enough solid ink", () => {
    // stripes two pixels wide: every ink pixel's neighbor two pixels away is black, so none is solid
    const stripes = frame((set) => {
      for (let y = 20; y < 44; y++) for (let x = 30; x < 66; x++) if (x % 4 < 2) set(x, y, [255, 212, 0]);
    });
    expect(compareFrames(stripes, stripes, W, H)).toMatchObject({ pass: true, blank: false, color: null, why: [] });
  });

  it("reads the frame number from a saved image's name", () => {
    expect(parseStillName("/Users/me/Downloads/Qual recap frame 000045.png")).toBe(45);
    expect(parseStillName("Qual recap frame 000000 (1).png")).toBe(0);
    expect(parseStillName("screenshot.png")).toBeNull();
  });

  it("holds a blank still to its own tighter limit", () => {
    const grey = (v: number) => frame((set) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, [v, v, v]);
    });
    expect(compareFrames(grey(3), BLACK, W, H)).toMatchObject({ blank: true, diff: 3, pass: true });
    expect(compareFrames(grey(6), BLACK, W, H)).toMatchObject({ blank: true, diff: 6, pass: false, why: ["diff"] });
  });

  it("asks a control to be at least three times 1 when the frame matches exactly", () => {
    // dim dots every 6 × 4 pixels: the still is between 1 and 3 from black, and more than 3 from itself moved
    const dots = frame((set) => {
      for (let y = 0; y < 64; y += 4) for (let x = 0; x < 96; x += 6) set(x, y, [40, 40, 40]);
    });
    const result = compareFrames(dots, dots, W, H);
    expect(result.diff).toBe(0);
    expect(result.black).toBeGreaterThan(1);
    expect(result.black).toBeLessThan(3);
    expect(result).toMatchObject({ pass: false, why: ["black"] });
  });

  it("needs as many solid pixels as ink pixels before it measures color", () => {
    // a 9 × 9 square: 81 ink pixels, only the 5 × 5 inside is solid
    const square = frame((set) => {
      for (let y = 28; y < 37; y++) for (let x = 40; x < 49; x++) set(x, y, [255, 212, 0]);
    });
    expect(compareFrames(square, square, W, H)).toMatchObject({ pass: true, blank: false, color: null });
  });

  it("reads only six digits at the end of the name", () => {
    expect(parseStillName("Qual recap frame 45.png")).toBeNull();
    expect(parseStillName("Qual recap frame 000045 copy.png")).toBeNull();
    expect(parseStillName("Qual recap frame 000045.png.zip")).toBeNull();
  });
});

describe("comparing a frame with footage in it", () => {
  // A picture with no flat areas, as footage has: every pixel differs from its neighbors.
  const footage = (dx = 0) => frame((set) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, [((x + dx) * 5) % 256, (y * 7) % 256, 90]);
  });

  it("compares over the whole frame, without the controls, and passes encoder noise", () => {
    expect(compareFrames(noisy(footage()), footage(), W, H, { media: true })).toMatchObject({ pass: true, blank: false, black: null, shifted: null, color: null, why: [] });
  });

  it("fails a frame from another moment", () => {
    expect(compareFrames(footage(12), footage(), W, H, { media: true })).toMatchObject({ pass: false, why: ["diff"] });
  });

  it("looks at the whole frame, not only around the bright parts", () => {
    // the exported frame has a white band at the left edge, far from the still's block
    const banded = block();
    for (let y = 0; y < H; y++) for (let x = 0; x < 16; x++) banded.set([255, 255, 255], (y * W + x) * 3);
    expect(compareFrames(banded, block(), W, H)).toMatchObject({ pass: true });
    expect(compareFrames(banded, block(), W, H, { media: true })).toMatchObject({ pass: false, why: ["diff"] });
  });

  it("never treats a dark footage still as blank", () => {
    expect(compareFrames(BLACK, BLACK, W, H, { media: true })).toMatchObject({ pass: true, blank: false, diff: 0, black: null, shifted: null, color: null });
  });
});
