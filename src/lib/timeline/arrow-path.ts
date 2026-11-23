// The line of an arrow (or a line) as it is drawn: a smooth curve from its tail, through each of its points in order,
// to its tip. Pure, in the arrow's own units: the tail at (−length/2, 0) and the tip at (length/2, 0).
//
// The curve is a chain of cubic pieces, one between each two neighbouring points. Each piece leaves and arrives along
// the parabola through that point and its two neighbours, so the pieces meet without a corner, and an arrow with one
// point is exactly the parabola through tail, point and tip: what `bend` has always drawn.

export type Pt = { x: number; y: number };
// One piece: from `from` to `to`, pulled towards c1 on the way out and c2 on the way in.
export type Segment = { from: Pt; c1: Pt; c2: Pt; to: Pt };
// A place on the line: piece `index`, `t` of the way along it (0..1).
export type PathSpot = { index: number; t: number };

// How the points are spaced along the curve: by the square root of the distance between them, which keeps the line from
// looping or overshooting when two points sit close together and the next is far away.
const SPACING_POWER = 0.5;
const NEVER_ZERO = 1e-6;

// The pieces of the smooth line through these places, in order. Two places make one straight piece.
export function segmentsThrough(knots: readonly Pt[]): Segment[] {
  const n = knots.length;
  if (n < 2) return [];
  if (n === 2) {
    const [a, b] = knots;
    return [{ from: a, c1: lerp(a, b, 1 / 3), c2: lerp(a, b, 2 / 3), to: b }];
  }
  const gap: number[] = [];
  const slope: Pt[] = []; // the travel from one place to the next, per unit of spacing
  for (let i = 0; i < n - 1; i++) {
    const dx = knots[i + 1].x - knots[i].x;
    const dy = knots[i + 1].y - knots[i].y;
    const d = Math.max(NEVER_ZERO, Math.hypot(dx, dy) ** SPACING_POWER);
    gap.push(d);
    slope.push({ x: dx / d, y: dy / d });
  }
  // The direction at each place: the parabola through it and its two neighbours, read at that place.
  const lean: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) lean.push(offCurve(slope[0], slope[1], -gap[0] / (gap[0] + gap[1])));
    else if (i === n - 1) lean.push(offCurve(slope[n - 2], slope[n - 3], -gap[n - 2] / (gap[n - 3] + gap[n - 2])));
    else {
      const total = gap[i - 1] + gap[i];
      lean.push({ x: (gap[i] * slope[i - 1].x + gap[i - 1] * slope[i].x) / total, y: (gap[i] * slope[i - 1].y + gap[i - 1] * slope[i].y) / total });
    }
  }
  const pieces: Segment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const reach = gap[i] / 3;
    pieces.push({
      from: knots[i],
      c1: { x: knots[i].x + lean[i].x * reach, y: knots[i].y + lean[i].y * reach },
      c2: { x: knots[i + 1].x - lean[i + 1].x * reach, y: knots[i + 1].y - lean[i + 1].y * reach },
      to: knots[i + 1],
    });
  }
  return pieces;
}

// near + (other − near) × share: the end direction, which leans away from the neighbouring piece's.
const offCurve = (near: Pt, other: Pt, share: number): Pt => ({ x: near.x + (other.x - near.x) * share, y: near.y + (other.y - near.y) * share });

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Where a piece is at t.
export function segmentPoint(s: Segment, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * s.from.x + b * s.c1.x + c * s.c2.x + d * s.to.x, y: a * s.from.y + b * s.c1.y + c * s.c2.y + d * s.to.y };
}

// The two parts of a piece cut at t, each a piece of its own that draws the same curve.
export function splitSegment(s: Segment, t: number): [Segment, Segment] {
  const ab = lerp(s.from, s.c1, t);
  const bc = lerp(s.c1, s.c2, t);
  const cd = lerp(s.c2, s.to, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const mid = lerp(abc, bcd, t);
  return [
    { from: s.from, c1: ab, c2: abc, to: mid },
    { from: mid, c1: bcd, c2: cd, to: s.to },
  ];
}

export function spotPoint(path: readonly Segment[], spot: PathSpot): Pt {
  return segmentPoint(path[spot.index], spot.t);
}

const STEPS = 16; // how finely a piece is walked when looking for a place on it

// The first place on the line, walking in from one end, that is `distance` from that end in a straight line. A head
// drawn at the end reaches back to there. The far end when the whole line is nearer than that.
export function spotFromEnd(path: readonly Segment[], end: "tail" | "tip", distance: number): PathSpot {
  const last = path.length - 1;
  const origin = end === "tail" ? path[0].from : path[last].to;
  const far = (spot: PathSpot) => {
    const p = spotPoint(path, spot);
    return Math.hypot(p.x - origin.x, p.y - origin.y) >= distance;
  };
  // Step k of the walk, counted from the end walked in from.
  const spotAt = (k: number): PathSpot => {
    const piece = Math.min(last, Math.floor(k / STEPS));
    const t = (k - piece * STEPS) / STEPS;
    return end === "tail" ? { index: piece, t } : { index: last - piece, t: 1 - t };
  };
  const total = path.length * STEPS;
  for (let k = 1; k <= total; k++) {
    if (!far(spotAt(k))) continue;
    // Between step k − 1 and k. A step that ends a piece is named as the next piece's start, so name it on this one.
    let near = spotAt(k - 1);
    let beyond = spotAt(k);
    if (near.index !== beyond.index) beyond = { index: near.index, t: end === "tail" ? 1 : 0 };
    for (let i = 0; i < 20; i++) {
      const mid = { index: near.index, t: (near.t + beyond.t) / 2 };
      if (far(mid)) beyond = mid;
      else near = mid;
    }
    return beyond;
  }
  return spotAt(total);
}

// The line between two places on it, the first nearer the tail.
export function pathBetween(path: readonly Segment[], from: PathSpot, to: PathSpot): Segment[] {
  if (from.index === to.index) {
    const [, rest] = splitSegment(path[from.index], from.t);
    const share = from.t >= 1 ? 0 : (to.t - from.t) / (1 - from.t);
    return [splitSegment(rest, Math.max(0, Math.min(1, share)))[0]];
  }
  return [splitSegment(path[from.index], from.t)[1], ...path.slice(from.index + 1, to.index), splitSegment(path[to.index], to.t)[0]];
}

// The box the line fits in exactly: its ends, and wherever it turns back along x or y.
export function pathBounds(path: readonly Segment[]): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const take = (p: Pt) => {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  };
  for (const s of path) {
    take(s.from);
    take(s.to);
    for (const axis of ["x", "y"] as const) {
      for (const t of turns(s.from[axis], s.c1[axis], s.c2[axis], s.to[axis])) take(segmentPoint(s, t));
    }
  }
  return { left, top, right, bottom };
}

// Where a cubic's travel along one axis stops and turns: the roots of its derivative strictly inside 0..1.
function turns(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const inside = (t: number) => t > 0 && t < 1;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b].filter(inside);
  const root = b * b - 4 * a * c;
  if (root < 0) return [];
  const r = Math.sqrt(root);
  return [(-b + r) / (2 * a), (-b - r) / (2 * a)].filter(inside);
}

// How near a point comes to the line, walking each piece in straight steps.
export function distanceToPath(path: readonly Segment[], p: Pt): number {
  let best = Infinity;
  for (const s of path) {
    let prev = s.from;
    for (let i = 1; i <= STEPS; i++) {
      const next = segmentPoint(s, i / STEPS);
      best = Math.min(best, distanceToStretch(p, prev, next));
      prev = next;
    }
  }
  return best;
}

// How near a point comes to the straight stretch from a to b.
export function distanceToStretch(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
