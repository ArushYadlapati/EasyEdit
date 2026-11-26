import { describe, expect, it } from "vitest";
import { interestBetween, interestPath, type Interest } from "@/lib/media/interest";
import type { Gray } from "@/lib/media/motion";

const W = 96;
const H = 54;
// A background with detail everywhere (so the camera's move can be read), the same from frame to frame unless shifted.
const ground = (x: number, y: number) => 90 + 50 * Math.sin(x * 0.55) * Math.cos(y * 0.43) + 30 * Math.sin((x + 2 * y) * 0.21);
// A frame: the ground moved by (panX, panY), with a bright patterned box whose middle is at (bx, by), if given.
function frame(box: { x: number; y: number } | null, panX = 0, panY = 0): Gray {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let value = ground(x - panX, y - panY);
      if (box && Math.abs(x - box.x) <= 6 && Math.abs(y - box.y) <= 6) value = (x + y) % 2 ? 250 : 215;
      data[y * W + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return { data, width: W, height: H };
}

describe("where the action is between two frames", () => {
  it("is nowhere when nothing moved", () => {
    expect(interestBetween(frame(null), frame(null))).toBeNull();
    expect(interestBetween(frame({ x: 30, y: 20 }), frame({ x: 30, y: 20 }))).toBeNull();
  });
  it("is at the thing that moved, wherever in the frame it is", () => {
    for (const [x, y] of [[20, 14], [48, 27], [78, 40]]) {
      const found = interestBetween(frame({ x: x - 3, y }), frame({ x: x + 3, y }))!;
      expect(Math.abs(found.u - x / (W - 1)), `across at ${x}`).toBeLessThan(0.04);
      expect(Math.abs(found.v - y / (H - 1)), `down at ${y}`).toBeLessThan(0.06);
      expect(found.weight).toBeGreaterThan(0);
    }
  });
  it("does not take the camera's own move for action: a pan with one thing moving in it still finds the thing", () => {
    // The whole picture slides 3 pixels; nothing else moves.
    expect(interestBetween(frame(null, 0), frame(null, 3))).toBeNull();
    // The picture slides, and the box moves 8 pixels more than it.
    const found = interestBetween(frame({ x: 60, y: 27 }, 0), frame({ x: 71, y: 27 }, 3))!;
    expect(found.u).toBeGreaterThan(0.55);
    expect(found.u).toBeLessThan(0.85);
  });
  it("is nothing for frames of different sizes", () => {
    expect(interestBetween({ data: new Uint8Array(4), width: 2, height: 2 }, frame(null))).toBeNull();
  });
});

describe("a calm path through what was found", () => {
  const at = (u: number, weight = 0.5): Interest => ({ u, v: 0.5, weight });
  it("holds the place before a still stretch, and the place after one that opens the clip", () => {
    const path = interestPath([null, null, at(0.8), at(0.8), null, null, null], 0.5);
    for (const place of path) expect(place.u).toBeCloseTo(0.8, 5);
  });
  it("is the middle when nothing was found at all", () => {
    expect(interestPath([null, null, null], 2)).toEqual([{ u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }]);
    expect(interestPath([], 2)).toEqual([]);
  });
  it("follows a steady move from one side to the other, without lagging far behind", () => {
    const moving = Array.from({ length: 40 }, (_, i) => at(0.2 + (0.6 * i) / 39));
    const path = interestPath(moving, 3);
    for (let i = 0; i < 40; i++) expect(Math.abs(path[i].u - moving[i].u), `sample ${i}`).toBeLessThan(0.06);
    for (let i = 1; i < 40; i++) expect(path[i].u).toBeGreaterThanOrEqual(path[i - 1].u - 1e-9);
  });
  it("takes the jitter out: one frame far off does not jerk the path", () => {
    const steady = Array.from({ length: 30 }, () => at(0.4));
    steady[15] = at(0.9);
    const path = interestPath(steady, 4);
    expect(Math.max(...path.map((p) => p.u))).toBeLessThan(0.48);
  });
  it("counts every place found the same, however much moved there, and a held place for little", () => {
    // A file's full frames flicker all over: they must not outweigh the frames between them.
    const even = interestPath([at(0.2, 0.9), at(0.8, 0.05)], 2);
    expect(even[0].u + even[1].u).toBeCloseTo(1, 5);
    // One place found, then a long still stretch, then another: the path leaves the first only near the second.
    const path = interestPath([at(0.2), null, null, null, null, null, null, null, at(0.8)], 1);
    expect(path[3].u).toBeCloseTo(0.2, 1);
    expect(path[8].u).toBeGreaterThan(0.7);
  });
});
