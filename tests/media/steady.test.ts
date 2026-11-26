import { describe, expect, it } from "vitest";
import { STEADY_ZOOM_MAX, cameraPath, evenPath, moveAt, packMoves, packedFrames, steadyMoves, unpackMoves, type Shift } from "@/lib/media/steady";

function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
}
// A steady pan to the right with a hand's shake on it: how the picture shifts from each frame to the next.
function shaky(frames: number, pan = 0.002, shake = 0.004, seed = 3): Shift[] {
  const next = random(seed);
  return Array.from({ length: frames }, () => ({ dx: pan + shake * next(), dy: shake * next() }));
}
const wobble = (path: Shift[]) => {
  // How far a path strays from frame to frame beyond its own steady drift.
  const steps = path.slice(1).map((p, i) => ({ dx: p.dx - path[i].dx, dy: p.dy - path[i].dy }));
  const mean = { dx: steps.reduce((s, p) => s + p.dx, 0) / steps.length, dy: steps.reduce((s, p) => s + p.dy, 0) / steps.length };
  return Math.sqrt(steps.reduce((s, p) => s + (p.dx - mean.dx) ** 2 + (p.dy - mean.dy) ** 2, 0) / steps.length);
};

describe("the camera's path", () => {
  it("adds up the shifts from the first frame, counting an unknown one as none", () => {
    expect(cameraPath([{ dx: 0.01, dy: 0 }, null, { dx: -0.02, dy: 0.005 }])).toEqual([{ dx: 0, dy: 0 }, { dx: 0.01, dy: 0 }, { dx: 0.01, dy: 0 }, { dx: -0.01, dy: 0.005 }]);
    expect(cameraPath([])).toEqual([{ dx: 0, dy: 0 }]);
  });
});

describe("a path evened out", () => {
  it("leaves a steady pan as it is, ends and all", () => {
    const pan = cameraPath(Array.from({ length: 60 }, () => ({ dx: 0.003, dy: -0.001 })));
    evenPath(pan, 10).forEach((p, i) => {
      expect(p.dx).toBeCloseTo(pan[i].dx, 9);
      expect(p.dy).toBeCloseTo(pan[i].dy, 9);
    });
  });
  it("takes most of the shake off a shaky path, more the further it reaches", () => {
    const path = cameraPath(shaky(300));
    const [light, strong] = [wobble(evenPath(path, 5)), wobble(evenPath(path, 25))];
    expect(light).toBeLessThan(wobble(path) / 3);
    expect(strong).toBeLessThan(light);
    expect(evenPath(path, 0)).toEqual(path);
  });
});

describe("the moves that steady a clip", () => {
  it("put each frame on the even path, and enlarge the picture by just what the largest move needs", () => {
    const path = cameraPath(shaky(300));
    const { moves, zoom } = steadyMoves(path, 20);
    const steadied = path.map((p, i) => ({ dx: p.dx + moves[i].dx, dy: p.dy + moves[i].dy }));
    expect(wobble(steadied)).toBeLessThan(wobble(path) / 5);
    const far = Math.max(...moves.map((m) => Math.max(Math.abs(m.dx), Math.abs(m.dy))));
    expect(zoom).toBeCloseTo(1 + 2 * far, 3);
    expect(zoom).toBeGreaterThan(1);
    expect(zoom).toBeLessThan(1.1);
  });
  it("move nothing, and enlarge nothing, for a camera that did not shake", () => {
    const still = steadyMoves(cameraPath(Array.from({ length: 50 }, () => ({ dx: 0, dy: 0 }))), 20);
    expect(still.zoom).toBe(1);
    expect(still.moves.every((m) => m.dx === 0 && m.dy === 0)).toBe(true);
  });
  it("hold a wild jolt to what the largest enlargement can hide", () => {
    const jolt = cameraPath([...Array.from({ length: 30 }, () => ({ dx: 0, dy: 0 })), { dx: 0.6, dy: 0 }, ...Array.from({ length: 30 }, () => ({ dx: 0, dy: 0 }))]);
    const { moves, zoom } = steadyMoves(jolt, 20);
    expect(zoom).toBe(STEADY_ZOOM_MAX);
    expect(Math.max(...moves.map((m) => Math.abs(m.dx)))).toBeCloseTo((STEADY_ZOOM_MAX - 1) / 2, 9);
  });
});

describe("the moves as kept on a clip", () => {
  const moves = [{ dx: 0.0123, dy: -0.004 }, { dx: -0.1, dy: 0.1 }, { dx: 0, dy: 0 }];
  it("pack small and come back to a twenty-thousandth of the picture", () => {
    const data = packMoves(moves);
    expect(data.length).toBe(16); // twelve bytes
    expect(packedFrames(data)).toBe(3);
    const back = unpackMoves(data)!;
    expect([...back]).toEqual([246, -80, -2000, 2000, 0, 0]);
    expect(unpackMoves(data)).toBe(back); // read once, however often it is asked for
  });
  it("give a frame's move by the file's frame, and none before the first or after the last", () => {
    const steady = { from: 100, zoom: 1.05, data: packMoves(moves) };
    expect(moveAt(steady, 100)).toEqual({ dx: 0.0123, dy: -0.004 });
    expect(moveAt(steady, 101)).toEqual({ dx: -0.1, dy: 0.1 });
    expect(moveAt(steady, 100.4)).toEqual({ dx: 0.0123, dy: -0.004 });
    expect([moveAt(steady, 99), moveAt(steady, 103)]).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });
  it("are told from text that is no list of moves", () => {
    expect([packedFrames("AAAA"), packedFrames("AAA"), packedFrames("!!!!"), packedFrames("")]).toEqual([null, null, null, 0]);
    expect(unpackMoves("AAAA")).toBeNull(); // three bytes: not a whole frame
    expect(moveAt({ from: 0, zoom: 1, data: "AAAA" }, 0)).toEqual({ dx: 0, dy: 0 });
  });
});
