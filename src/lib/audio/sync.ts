// Lining up two recordings of the same moment by their sound: a camera's own sound and a separate microphone's, or two
// cameras. Each recording is reduced to where its sounds begin (a clap, a word), and the two are slid past each other
// until those line up. It imports nothing.

export const ENVELOPE_RATE = 200; // steps a second: five thousandths of a second each, well inside one frame
export const SYNC_MAX_SECONDS = 600; // only this much of each recording is compared
export const SYNC_MIN_SCORE = 0.2; // below this the best match is no better than chance, however long the recordings
export const SYNC_MIN_SECONDS = 4; // with less than this lying on each other, chance does as well as the truth

const COARSE = 10; // the first pass looks at every tenth of the detail

// Where the sound gets louder, step by step. The loudness of each step is taken on a logarithmic scale and against
// the recording's own level, so a far, quiet microphone and a close, loud one give the same shape; only rises are
// kept, since that is what both microphones agree on when their rooms ring differently. from, to: the part of the
// file, in samples.
export function onsets(sides: Float32Array[], sampleRate: number, from: number, to: number, rate = ENVELOPE_RATE): Float32Array {
  const length = sides[0]?.length ?? 0;
  const start = Math.max(0, Math.min(length, Math.floor(from)));
  const end = Math.max(start, Math.min(length, Math.floor(to), start + Math.floor(SYNC_MAX_SECONDS * sampleRate)));
  const size = sampleRate / rate;
  const steps = Math.floor((end - start) / size);
  const out = new Float32Array(Math.max(0, steps));
  let total = 0;
  for (let step = 0; step < steps; step++) {
    const a = start + Math.floor(step * size);
    const b = start + Math.floor((step + 1) * size);
    let energy = 0;
    for (const side of sides) for (let i = a; i < b; i++) energy += side[i] * side[i];
    out[step] = energy / Math.max(1, (b - a) * sides.length);
    total += out[step];
  }
  if (total === 0) return out.fill(0);
  // Anything 40 dB under the recording's average counts as its silence.
  const floor = (total / steps) * 1e-4;
  let before = 0;
  for (let step = 0; step < steps; step++) {
    const loud = Math.log(floor + out[step]);
    out[step] = step === 0 ? 0 : Math.max(0, loud - before);
    before = loud;
  }
  return out;
}

// The same values, measured from their average.
function centred(values: Float32Array): Float32Array {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = values.length > 0 ? sum / values.length : 0;
  return values.map((v) => v - mean);
}

// Every `by` steps added into one.
function coarser(values: Float32Array, by: number): Float32Array {
  const out = new Float32Array(Math.floor(values.length / by));
  for (let i = 0; i < out.length; i++) for (let j = 0; j < by; j++) out[i] += values[i * by + j];
  return out;
}

// How alike a and b are where they overlap when b's step i sits on a's step i + lag: 1 the same shape, 0 nothing in
// common. Null when they overlap by less than `least` steps.
function likeness(a: Float32Array, b: Float32Array, lag: number, least: number): number | null {
  const from = Math.max(0, -lag);
  const to = Math.min(b.length, a.length - lag);
  if (to - from < least) return null;
  let both = 0;
  let aa = 0;
  let bb = 0;
  for (let i = from; i < to; i++) {
    const x = a[i + lag];
    const y = b[i];
    both += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa === 0 || bb === 0 ? 0 : both / Math.sqrt(aa * bb);
}

// overlap: how many seconds of the two lie on each other there.
export type Match = { seconds: number; score: number; overlap: number };

// Whether a match is one to act on. Two recordings with nothing in common still have a best place, and the fewer
// sounds there are to go by, the better that place looks: the less the two overlap, the more alike they have to be,
// and under four seconds nothing is sure. Measured on made-up recordings of different moments, forty pairs a length:
// their best score stays under about 1 / √seconds, and with this rule none of 560 such pairs was taken for a match,
// while a close and a far microphone on the same moment were matched every time from six seconds up. (How far the
// best place stands above the others is no guide: music repeats, so many places score well for a true match.)
export function isSure(match: Match): boolean {
  return match.overlap >= SYNC_MIN_SECONDS && match.score >= Math.max(SYNC_MIN_SCORE, 1.1 / Math.sqrt(match.overlap));
}

// Where b belongs against a: b's start is `seconds` after a's start (before it, when negative). score: how alike the
// two are once placed there, 0 to 1. Null when either has no sound to go by, or they cannot overlap by at least a
// second and half of the shorter one. A first pass at a tenth of the detail finds the likely places; each is then
// looked at closely.
export function matchSound(a: Float32Array, b: Float32Array, rate = ENVELOPE_RATE): Match | null {
  const least = Math.max(rate, Math.floor(Math.min(a.length, b.length) / 2));
  if (a.length < least || b.length < least) return null;
  // Each is measured from its own average, so that two recordings with nothing in common score about nothing: marks
  // are never below zero, and left as they are any two would seem a little alike.
  a = centred(a);
  b = centred(b);
  const ca = centred(coarser(a, COARSE));
  const cb = centred(coarser(b, COARSE));
  const coarseLeast = Math.max(1, Math.floor(least / COARSE));
  const found: { lag: number; score: number }[] = [];
  for (let lag = -cb.length; lag <= ca.length; lag++) {
    const score = likeness(ca, cb, lag, coarseLeast);
    if (score !== null) found.push({ lag, score });
  }
  // The three likeliest places that are not each other's neighbours.
  found.sort((x, y) => y.score - x.score);
  const places: number[] = [];
  for (const { lag } of found) {
    if (places.every((p) => Math.abs(p - lag) > 2)) places.push(lag);
    if (places.length === 3) break;
  }
  let best: { lag: number; score: number } | null = null;
  for (const place of places) {
    for (let lag = (place - 1) * COARSE; lag <= (place + 1) * COARSE; lag++) {
      const score = likeness(a, b, lag, least);
      if (score !== null && (!best || score > best.score)) best = { lag, score };
    }
  }
  if (!best) return null;
  const overlap = (Math.min(b.length, a.length - best.lag) - Math.max(0, -best.lag)) / rate;
  return { seconds: best.lag / rate, score: best.score, overlap };
}
