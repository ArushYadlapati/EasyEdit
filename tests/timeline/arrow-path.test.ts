import { describe, expect, it } from "vitest";
import {
  distanceToPath,
  pathBetween,
  pathBounds,
  segmentPoint,
  segmentsThrough,
  splitSegment,
  spotFromEnd,
  spotPoint,
  type Pt,
  type Segment,
} from "@/lib/timeline/arrow-path";

const near = (a: Pt, b: Pt, places = 6) => {
  expect(a.x).toBeCloseTo(b.x, places);
  expect(a.y).toBeCloseTo(b.y, places);
};
// The older curve: a quadratic from a to b whose control point is c.
const quadratic = (a: Pt, c: Pt, b: Pt, t: number): Pt => {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};
// The direction a piece leaves or arrives in, as a unit vector.
const heading = (from: Pt, to: Pt) => {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
};

describe("the line through an arrow's points", () => {
  it("two places make one straight piece", () => {
    const path = segmentsThrough([{ x: -200, y: 0 }, { x: 200, y: 0 }]);
    expect(path).toHaveLength(1);
    near(segmentPoint(path[0], 0.25), { x: -100, y: 0 });
    near(segmentPoint(path[0], 0.5), { x: 0, y: 0 });
  });

  it("one point in the middle draws exactly the curve a bend drew", () => {
    // bend 0.25 on a 400 long arrow: the curve's middle 100 out, its quadratic control 200 out.
    const tail = { x: -200, y: 0 };
    const tip = { x: 200, y: 0 };
    const path = segmentsThrough([tail, { x: 0, y: 100 }, tip]);
    expect(path).toHaveLength(2);
    for (const t of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
      near(segmentPoint(path[0], t), quadratic(tail, { x: 0, y: 200 }, tip, t / 2));
      near(segmentPoint(path[1], t), quadratic(tail, { x: 0, y: 200 }, tip, 0.5 + t / 2));
    }
  });

  it("passes through every point, wherever it is, without a corner", () => {
    const knots = [{ x: -200, y: 0 }, { x: -150, y: 220 }, { x: 40, y: -90 }, { x: 60, y: 300 }, { x: 200, y: 0 }];
    const path = segmentsThrough(knots);
    expect(path).toHaveLength(4);
    path.forEach((piece, i) => {
      near(piece.from, knots[i]);
      near(piece.to, knots[i + 1]);
    });
    for (let i = 0; i < path.length - 1; i++) near(heading(path[i].c2, path[i].to), heading(path[i + 1].from, path[i + 1].c1));
  });

  it("a point far off to one side is still on the line", () => {
    const off = { x: -900, y: -1400 };
    const path = segmentsThrough([{ x: -200, y: 0 }, off, { x: 200, y: 0 }]);
    near(path[0].to, off);
    expect(distanceToPath(path, off)).toBeCloseTo(0, 6);
  });

  it("two points in the same place still draw a finite line", () => {
    const path = segmentsThrough([{ x: -200, y: 0 }, { x: 0, y: 50 }, { x: 0, y: 50 }, { x: 200, y: 0 }]);
    for (const piece of path) for (const p of [piece.c1, piece.c2]) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe("places on the line", () => {
  const straight = segmentsThrough([{ x: -200, y: 0 }, { x: 200, y: 0 }]);
  const curved = segmentsThrough([{ x: -200, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 0 }]);

  it("a piece cut in two draws the same curve", () => {
    const [first, second] = splitSegment(curved[0], 0.3);
    near(first.to, segmentPoint(curved[0], 0.3));
    near(segmentPoint(first, 0.5), segmentPoint(curved[0], 0.15));
    near(segmentPoint(second, 0.5), segmentPoint(curved[0], 0.65));
  });

  it("finds the place a given distance back from either end", () => {
    near(spotPoint(straight, spotFromEnd(straight, "tip", 44)), { x: 156, y: 0 }, 3);
    near(spotPoint(straight, spotFromEnd(straight, "tail", 44)), { x: -156, y: 0 }, 3);
    const back = spotPoint(curved, spotFromEnd(curved, "tip", 60));
    expect(Math.hypot(back.x - 200, back.y)).toBeCloseTo(60, 3);
    expect(spotFromEnd(curved, "tip", 60).index).toBe(1);
    // A distance that reaches past a point lands on the piece before it.
    expect(spotFromEnd(curved, "tip", 300).index).toBe(0);
    // Farther than the whole line: its other end.
    near(spotPoint(straight, spotFromEnd(straight, "tip", 5000)), { x: -200, y: 0 });
  });

  it("the line between two places starts and ends at them", () => {
    const from = spotFromEnd(curved, "tail", 50);
    const to = spotFromEnd(curved, "tip", 50);
    const part: Segment[] = pathBetween(curved, from, to);
    expect(part).toHaveLength(2);
    near(part[0].from, spotPoint(curved, from));
    near(part[1].to, spotPoint(curved, to));
    const within = pathBetween(straight, { index: 0, t: 0.25 }, { index: 0, t: 0.75 });
    expect(within).toHaveLength(1);
    near(within[0].from, { x: -100, y: 0 });
    near(within[0].to, { x: 100, y: 0 });
  });

  it("the box holds the whole curve, to where it turns back", () => {
    expect(pathBounds(straight)).toEqual({ left: -200, top: 0, right: 200, bottom: 0 });
    const box = pathBounds(curved);
    expect(box.bottom).toBeCloseTo(100, 6);
    expect(box.top).toBeCloseTo(0, 6);
    // A point pulled past the tip carries the line out beyond both ends.
    const past = pathBounds(segmentsThrough([{ x: -200, y: 0 }, { x: 320, y: 60 }, { x: 200, y: 0 }]));
    expect(past.right).toBeGreaterThanOrEqual(320);
  });

  it("measures how near a point comes to the line", () => {
    expect(distanceToPath(straight, { x: 0, y: 30 })).toBeCloseTo(30, 6);
    expect(distanceToPath(curved, { x: 0, y: 100 })).toBeCloseTo(0, 6);
    expect(distanceToPath(straight, { x: 260, y: 0 })).toBeCloseTo(60, 6);
  });
});
