// Following something through a video's frames, and telling how the whole picture shifts from one frame to the next.
// Frames come in small and grey; places are in their pixels. Pure, and it imports nothing.

export type Gray = { data: Uint8Array; width: number; height: number };

// A frame's brightness, one byte a pixel.
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < data.length; p++, i += 4) data[p] = (rgba[i] * 54 + rgba[i + 1] * 183 + rgba[i + 2] * 19) >> 8;
  return { data, width, height };
}

// How alike the square around (ax, ay) of a is to the square around (bx, by) of b: 1 the same pattern (whatever its
// brightness and contrast), 0 nothing alike, below 0 its negative. half: the square reaches this far each way. Parts
// of either square off its frame's edge are left out; null when too little of it is left, or one of them is flat.
export function alike(a: Gray, ax: number, ay: number, b: Gray, bx: number, by: number, half: number): number | null {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let dy = -half; dy <= half; dy++) {
    const ya = ay + dy;
    const yb = by + dy;
    if (ya < 0 || yb < 0 || ya >= a.height || yb >= b.height) continue;
    for (let dx = -half; dx <= half; dx++) {
      const xa = ax + dx;
      const xb = bx + dx;
      if (xa < 0 || xb < 0 || xa >= a.width || xb >= b.width) continue;
      const va = a.data[ya * a.width + xa];
      const vb = b.data[yb * b.width + xb];
      n++;
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  const whole = (2 * half + 1) ** 2;
  if (n < whole / 2) return null;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  if (va < n * 4 || vb < n * 4) return null; // flat: nothing in it to tell one place from another
  return (sab - (sa * sb) / n) / Math.sqrt(va * vb);
}

export type Found = { x: number; y: number; score: number };

// The top of the curve through three scores a pixel apart, as a part of a pixel either way of the middle one.
const peak = (before: number, at: number, after: number) => {
  const bend = before - 2 * at + after;
  return bend >= 0 ? 0 : Math.max(-0.5, Math.min(0.5, (before - after) / (2 * bend)));
};

// Where in `to` the square around (x, y) of `from` is, looked for up to `search` pixels each way of (nearX, nearY),
// to a part of a pixel. Null when nowhere there is anything like it to compare.
export function find(from: Gray, x: number, y: number, to: Gray, nearX: number, nearY: number, half: number, search: number): Found | null {
  const fx = Math.round(x);
  const fy = Math.round(y);
  const cx = Math.round(nearX);
  const cy = Math.round(nearY);
  const side = 2 * search + 1;
  const scores = new Float32Array(side * side).fill(-2);
  let best = -2;
  let bestAt = -1;
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const score = alike(from, fx, fy, to, cx + dx, cy + dy, half);
      if (score === null) continue;
      const at = (dy + search) * side + (dx + search);
      scores[at] = score;
      if (score > best) {
        best = score;
        bestAt = at;
      }
    }
  }
  if (bestAt < 0) return null;
  const bx = bestAt % side;
  const by = Math.floor(bestAt / side);
  const near = (ox: number, oy: number) => {
    const sx = bx + ox;
    const sy = by + oy;
    const score = sx < 0 || sy < 0 || sx >= side || sy >= side ? -2 : scores[sy * side + sx];
    return score === -2 ? best : score;
  };
  return {
    x: cx + (bx - search) + peak(near(-1, 0), best, near(1, 0)) + (x - fx),
    y: cy + (by - search) + peak(near(0, -1), best, near(0, 1)) + (y - fy),
    score: best,
  };
}

export const TRACK_HALF = 10; // the square followed reaches this far each way, in the small frame's pixels
export const TRACK_SEARCH = 14; // how far it may move from one frame to the next
export const TRACK_KEEP = 0.55; // as alike as this to how it last surely looked, it is taken to be the same thing
export const TRACK_SURE = 0.8; // as alike as this to the frame before, it is surely still there, however it has changed

// Follows the thing at (x, y) of frames[start] through the frames after it (step 1) or before it (step −1). Each
// frame it is looked for near where it was, as it looked in the frame before. Where it still looks as it did when it
// was last surely seen, it is put back on that, so small slips do not add up; where it no longer does but plainly
// carried on from the frame before (it turned, it came closer), how it looks now becomes what it is known by. It
// stops where it is lost: gone behind something, or out of the picture. The places found, one for each frame from
// start on in the way asked, the start's own first.
export function follow(frames: readonly Gray[], start: number, x: number, y: number, step: 1 | -1): { x: number; y: number }[] {
  let known = { frame: frames[start], x, y };
  const path = [{ x, y }];
  let at = { x, y };
  for (let i = start + step; i >= 0 && i < frames.length; i += step) {
    const before = frames[i - step];
    const moved = find(before, at.x, at.y, frames[i], at.x, at.y, TRACK_HALF, TRACK_SEARCH);
    if (!moved) break;
    const same = find(known.frame, known.x, known.y, frames[i], moved.x, moved.y, TRACK_HALF, 3);
    if (same && same.score >= TRACK_KEEP) at = { x: same.x, y: same.y };
    else if (moved.score >= TRACK_SURE) {
      at = { x: moved.x, y: moved.y };
      known = { frame: frames[i], x: at.x, y: at.y };
    } else break; // neither what it was nor plainly what the frame before showed: a best guess among strangers
    path.push(at);
  }
  return path;
}

// How the whole picture moved from one frame to the next, in pixels: the middle shift of a grid of squares, so that
// one thing moving across the picture does not count as the camera moving. Null when too few squares could be placed.
export function shiftBetween(from: Gray, to: Gray, half = 12, search = 10): { dx: number; dy: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let gy = 1; gy <= 3; gy++) {
    for (let gx = 1; gx <= 4; gx++) {
      const x = Math.round((from.width * gx) / 5);
      const y = Math.round((from.height * gy) / 4);
      const found = find(from, x, y, to, x, y, half, search);
      if (!found || found.score < 0.5) continue;
      xs.push(found.x - x);
      ys.push(found.y - y);
    }
  }
  if (xs.length < 4) return null;
  const middle = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return { dx: middle(xs), dy: middle(ys) };
}

// A path with fewer points: the ones that matter kept, so that a straight line between neighbours is never further
// than `tolerance` from a point left out, in x or in y. at: when each point is. The first and last always stay.
export function thinPath<P extends { at: number; x: number; y: number }>(points: readonly P[], tolerance: number): P[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let worst = 0;
    let worstAt = -1;
    for (let i = a + 1; i < b; i++) {
      const t = (points[i].at - points[a].at) / (points[b].at - points[a].at);
      const off = Math.max(Math.abs(points[a].x + (points[b].x - points[a].x) * t - points[i].x), Math.abs(points[a].y + (points[b].y - points[a].y) * t - points[i].y));
      if (off > worst) {
        worst = off;
        worstAt = i;
      }
    }
    if (worstAt >= 0 && worst > tolerance) {
      keep[worstAt] = true;
      stack.push([a, worstAt], [worstAt, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// The same, loosened until no more than `most` points are left.
export function thinTo<P extends { at: number; x: number; y: number }>(points: readonly P[], most: number, tolerance: number): P[] {
  let thinned = thinPath(points, tolerance);
  for (let loose = tolerance * 1.5; thinned.length > most; loose *= 1.5) thinned = thinPath(points, loose);
  return thinned;
}
