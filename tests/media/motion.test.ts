import { describe, expect, it } from "vitest";
import { alike, find, follow, shiftBetween, thinPath, thinTo, toGray, type Gray } from "@/lib/media/motion";

const [W, H] = [160, 90];
// A textured background (the same on every run), shifted by (sx, sy), with a bright patterned square at (bx, by).
function scene(sx: number, sy: number, bx?: number, by?: number): Gray {
  const data = new Uint8Array(W * H);
  const texture = (x: number, y: number) => 90 + 40 * Math.sin(x * 0.31) * Math.cos(y * 0.27) + 25 * Math.sin((x + y) * 0.11) + 15 * Math.sin(x * 0.9 + y * 1.3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = Math.max(0, Math.min(255, Math.round(texture(x - sx, y - sy))));
  if (bx !== undefined && by !== undefined) {
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const x = Math.round(bx) + dx;
      const y = Math.round(by) + dy;
      if (x >= 0 && y >= 0 && x < W && y < H) data[y * W + x] = (dx + dy) % 2 === 0 ? 250 : 200 - 10 * Math.abs(dx);
    }
  }
  return { data, width: W, height: H };
}

describe("a frame in grey", () => {
  it("is one byte a pixel, green counting most", () => {
    const gray = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255]), 2, 2);
    expect([...gray.data]).toEqual([255, 0, 182, 53]);
    expect([gray.width, gray.height]).toEqual([2, 2]);
  });
});

describe("how alike two squares are", () => {
  it("is 1 for the same pattern, whatever its brightness, and low for another place", () => {
    const a = scene(0, 0);
    const dimmer: Gray = { ...a, data: a.data.map((v) => Math.round(v * 0.5 + 10)) };
    expect(alike(a, 60, 40, a, 60, 40, 10)).toBeCloseTo(1, 5);
    expect(alike(a, 60, 40, dimmer, 60, 40, 10)!).toBeGreaterThan(0.98);
    expect(alike(a, 60, 40, a, 90, 60, 10)!).toBeLessThan(0.6);
  });
  it("has nothing to say of a flat square, or one mostly off the frame", () => {
    const flat: Gray = { data: new Uint8Array(W * H).fill(128), width: W, height: H };
    expect(alike(flat, 60, 40, flat, 60, 40, 10)).toBeNull();
    expect(alike(scene(0, 0), -8, -8, scene(0, 0), -8, -8, 10)).toBeNull();
  });
});

describe("finding where something went", () => {
  it("finds a square that moved, to a part of a pixel", () => {
    const found = find(scene(0, 0, 50, 40), 50, 40, scene(0, 0, 57, 36), 50, 40, 10, 14)!;
    expect(found.x).toBeCloseTo(57, 0);
    expect(found.y).toBeCloseTo(36, 0);
    expect(found.score).toBeGreaterThan(0.9);
  });
  it("finds the background's own shift when the whole picture moves", () => {
    const found = find(scene(0, 0), 80, 45, scene(4, -3), 80, 45, 12, 10)!;
    expect([Math.round(found.x), Math.round(found.y)]).toEqual([84, 42]);
  });
});

describe("following something through frames", () => {
  // The square crosses the frame on a curve over 40 frames; the background stays.
  const place = (i: number) => ({ x: 30 + i * 2.5, y: 45 + 18 * Math.sin(i / 8) });
  const frames = Array.from({ length: 41 }, (_, i) => scene(0, 0, place(i).x, place(i).y));
  it("stays on it forward, and backward from the middle", () => {
    const forward = follow(frames, 0, place(0).x, place(0).y, 1);
    expect(forward).toHaveLength(41);
    forward.forEach((p, i) => {
      expect(Math.abs(p.x - Math.round(place(i).x))).toBeLessThan(1.5);
      expect(Math.abs(p.y - Math.round(place(i).y))).toBeLessThan(1.5);
    });
    const backward = follow(frames, 20, Math.round(place(20).x), Math.round(place(20).y), -1);
    expect(backward).toHaveLength(21);
    expect(Math.abs(backward.at(-1)!.x - Math.round(place(0).x))).toBeLessThan(1.5);
  });
  it("stops where the thing is gone, and does not wander off after it", () => {
    const gone = [...frames.slice(0, 15), ...Array.from({ length: 10 }, () => scene(0, 0))];
    const path = follow(gone, 0, place(0).x, place(0).y, 1);
    expect(path.length).toBeGreaterThanOrEqual(14);
    expect(path.length).toBeLessThanOrEqual(16);
  });
  it("follows the picture itself when the camera moves and nothing else does", () => {
    const pan = Array.from({ length: 20 }, (_, i) => scene(i * 1.5, i * 0.5));
    const path = follow(pan, 0, 70, 40, 1);
    expect(path).toHaveLength(20);
    expect(path.at(-1)!.x).toBeCloseTo(70 + 19 * 1.5, 0);
    expect(path.at(-1)!.y).toBeCloseTo(40 + 19 * 0.5, 0);
  });
});

describe("how the whole picture moved", () => {
  it("is the background's shift, not that of one thing crossing it", () => {
    const shift = shiftBetween(scene(0, 0, 40, 40), scene(3, -2, 70, 50))!;
    expect(shift.dx).toBeCloseTo(3, 0);
    expect(shift.dy).toBeCloseTo(-2, 0);
    const still = shiftBetween(scene(0, 0), scene(0, 0))!;
    expect(Math.abs(still.dx) < 0.05 && Math.abs(still.dy) < 0.05).toBe(true);
  });
  it("is unknown for a flat picture", () => {
    const flat: Gray = { data: new Uint8Array(W * H).fill(128), width: W, height: H };
    expect(shiftBetween(flat, flat)).toBeNull();
  });
});

describe("a path with fewer points", () => {
  it("keeps the ends and the corners, and drops what lies on the line between them", () => {
    // Along a line, then a corner at 10, then along another.
    const path = Array.from({ length: 21 }, (_, i) => ({ at: i, x: i <= 10 ? i : 10, y: i <= 10 ? 0 : i - 10 }));
    expect(thinPath(path, 0.01).map((p) => p.at)).toEqual([0, 10, 20]);
    expect(thinPath(path.slice(0, 2), 0.01)).toHaveLength(2);
  });
  it("is never further from a point left out than it was told it may be", () => {
    const curve = Array.from({ length: 200 }, (_, i) => ({ at: i, x: i / 200, y: 0.5 + 0.3 * Math.sin(i / 20) }));
    const thinned = thinPath(curve, 0.005);
    expect(thinned.length).toBeLessThan(60);
    for (const p of curve) {
      const after = thinned.findIndex((k) => k.at >= p.at);
      const [a, b] = [thinned[Math.max(0, after - 1)], thinned[after]];
      const t = b.at === a.at ? 0 : (p.at - a.at) / (b.at - a.at);
      expect(Math.abs(a.y + (b.y - a.y) * t - p.y)).toBeLessThanOrEqual(0.0051);
    }
  });
  it("is loosened until it has no more points than asked for", () => {
    const wild = Array.from({ length: 500 }, (_, i) => ({ at: i, x: Math.sin(i * 1.7), y: Math.cos(i * 2.3) }));
    const few = thinTo(wild, 100, 0.001);
    expect(few.length).toBeLessThanOrEqual(100);
    expect([few[0].at, few.at(-1)!.at]).toEqual([0, 499]);
  });
});

describe("something that changes as it goes", () => {
  it("is still followed when it slowly comes to look different", () => {
    // The square's pattern turns from a checker into stripes over 30 frames while it moves: each frame is almost
    // the one before, and the last is nothing like the first.
    const frames = Array.from({ length: 31 }, (_, i) => {
      const f = scene(0, 0);
      const k = i / 30;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const checker = (dx + dy) % 2 === 0 ? 250 : 60;
        const stripes = Math.floor((dy + 6) / 3) % 2 === 0 ? 240 : 40;
        f.data[(45 + dy) * W + (40 + i * 2 + dx)] = Math.round(checker * (1 - k) + stripes * k);
      }
      return f;
    });
    const path = follow(frames, 0, 40, 45, 1);
    expect(path).toHaveLength(31);
    expect(Math.abs(path.at(-1)!.x - 100)).toBeLessThan(2);
    expect(Math.abs(path.at(-1)!.y - 45)).toBeLessThan(2);
  });
});
