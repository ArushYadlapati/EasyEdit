import { shiftBetween, type Gray } from "./motion";

// Where the action is in a video: the middle of what moved from one frame to the next, once the camera's own move is
// taken out. Frames come in small and grey. Nothing here knows what a face or a person is: it follows movement.
// Pure, and it imports only the frame helpers.

// u, v: the middle of what moved, 0 to 1 across and down the frame. weight: how much moved, 0 (nothing) to 1.
export type Interest = { u: number; v: number; weight: number };

const CHANGED = 14; // a pixel counts as moved when its brightness changed by more than this of 255
const LEAST = 0.00012; // of the whole picture's brightness: under this, what changed is flicker, not a subject
const EDGE = 2; // pixels at each edge left out: a camera's move brings new picture in there

// The middle of what moved between two frames. Null when next to nothing did (a still shot).
export function interestBetween(prev: Gray, frame: Gray): Interest | null {
  const { width, height } = frame;
  if (prev.width !== width || prev.height !== height) return null;
  // The camera's own move: each pixel is compared with where it was.
  const shift = shiftBetween(prev, frame);
  const dx = Math.round(shift?.dx ?? 0);
  const dy = Math.round(shift?.dy ?? 0);
  let sum = 0;
  let sumX = 0;
  let sumY = 0;
  let seen = 0;
  for (let y = EDGE; y < height - EDGE; y++) {
    const py = y - dy;
    if (py < 0 || py >= height) continue;
    for (let x = EDGE; x < width - EDGE; x++) {
      const px = x - dx;
      if (px < 0 || px >= width) continue;
      seen++;
      const change = Math.abs(frame.data[y * width + x] - prev.data[py * width + px]);
      if (change <= CHANGED) continue;
      sum += change;
      sumX += change * x;
      sumY += change * y;
    }
  }
  if (seen === 0 || sum === 0) return null;
  const weight = sum / (seen * 255);
  if (weight < LEAST) return null; // a few flickering pixels are not a subject
  return { u: sumX / sum / (width - 1), v: sumY / sum / (height - 1), weight: Math.min(1, weight * 12) };
}

const HELD = 0.15; // what a held place counts for, against 1 for a place found

// The place at a sample, also past either end of the clip: there the path is carried on as it was going (the samples
// inside, turned about the end one). Holding the end place instead would make a thing that moves steadily seem to
// slow down at both ends, and the picture would trail it there (measured: 10% of the picture off at each end).
function beyond(held: readonly { u: number; v: number; weight: number }[], i: number): { u: number; v: number; weight: number } {
  const n = held.length;
  if (i >= 0 && i < n) return held[i];
  const end = i < 0 ? 0 : n - 1;
  const mirror = held[Math.min(n - 1, Math.max(0, 2 * end - i))];
  return { u: 2 * held[end].u - mirror.u, v: 2 * held[end].v - mirror.v, weight: mirror.weight };
}

// A calm path through what was found, one place for each sample: a still stretch holds the place before it (the
// first, the place after it; with nothing found at all, the middle), and the whole is evened out over about
// `spread` samples each way. A place found counts the same however much moved there: a file's full frames flicker
// all over and would otherwise outweigh the frames between them (measured: they pulled the path 6% of the picture
// off a thing moving steadily). A camera operator, not a jitter.
export function interestPath(found: readonly (Interest | null)[], spread: number): { u: number; v: number }[] {
  const n = found.length;
  if (n === 0) return [];
  const first = found.find((f) => f !== null) ?? null;
  const held: { u: number; v: number; weight: number }[] = [];
  let last = first ? { u: first.u, v: first.v } : { u: 0.5, v: 0.5 };
  for (const f of found) {
    if (f) last = { u: f.u, v: f.v };
    held.push({ ...last, weight: f ? 1 : HELD });
  }
  const sigma = Math.max(0.5, spread);
  const reach = Math.ceil(sigma * 3);
  const bell = Array.from({ length: reach + 1 }, (_, d) => Math.exp(-(d * d) / (2 * sigma * sigma)));
  return held.map((_, i) => {
    let total = 0;
    let u = 0;
    let v = 0;
    for (let d = -reach; d <= reach; d++) {
      const w = bell[Math.abs(d)];
      const place = beyond(held, i + d);
      total += w * place.weight;
      u += w * place.weight * place.u;
      v += w * place.weight * place.v;
    }
    return { u: Math.min(1, Math.max(0, u / total)), v: Math.min(1, Math.max(0, v / total)) };
  });
}
