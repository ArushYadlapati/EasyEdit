// Sound to feed the export's sound code, and the rulers every sound test measures it with. Proved in audio-helpers.test.ts.

// amp · sin(2π·freq·i/rate) for i = 0 … frames − 1.
export function tone(freq: number, rate: number, frames: number, amp = 0.5): Float32Array {
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return x;
}

// Silence with `amp` at offset, offset + every, offset + 2·every, …
export function impulses(frames: number, every: number, offset = 0, amp = 1): Float32Array {
  const x = new Float32Array(frames);
  for (let i = offset; i < frames; i += every) x[i] = amp;
  return x;
}

// The middle 60 % of n samples, [from, to): away from a filter's or a ramp's edges.
function middle(n: number): [number, number] {
  return [Math.round(n * 0.2), Math.round(n * 0.8)];
}

// Solves the 3 × 3 system m · v = y by Gaussian elimination with partial pivoting.
function solve3(m: number[][], y: number[]): number[] {
  const a = m.map((row, i) => [...row, y[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < 3; row++) {
      const f = a[row][col] / a[col][col];
      for (let k = col; k < 4; k++) a[row][k] -= f * a[col][k];
    }
  }
  const v = [0, 0, 0];
  for (let row = 2; row >= 0; row--) {
    let sum = a[row][3];
    for (let k = row + 1; k < 3; k++) sum -= a[row][k] * v[k];
    v[row] = sum / a[row][row];
  }
  return v;
}

// Least squares on sin, cos and a constant at freq, over the middle 60 %, in float64.
// gainDb: the fitted tone's amplitude against amp. residualDb: the RMS of what the fit leaves against the fitted tone's RMS.
export function fitTone(x: Float32Array, freq: number, rate: number, amp: number): { gainDb: number; residualDb: number } {
  const [from, to] = middle(x.length);
  const w = (2 * Math.PI * freq) / rate;
  // The normal equations: sums of products of the three columns s, c, 1, and of each with x.
  let ss = 0, sc = 0, s1 = 0, cc = 0, c1 = 0, n = 0, sx = 0, cx = 0, x1 = 0;
  for (let i = from; i < to; i++) {
    const s = Math.sin(w * i);
    const c = Math.cos(w * i);
    ss += s * s;
    sc += s * c;
    s1 += s;
    cc += c * c;
    c1 += c;
    n += 1;
    sx += s * x[i];
    cx += c * x[i];
    x1 += x[i];
  }
  const [a, b, d] = solve3(
    [
      [ss, sc, s1],
      [sc, cc, c1],
      [s1, c1, n],
    ],
    [sx, cx, x1],
  );
  let rest = 0;
  for (let i = from; i < to; i++) {
    const e = x[i] - (a * Math.sin(w * i) + b * Math.cos(w * i) + d);
    rest += e * e;
  }
  const fitted = Math.hypot(a, b);
  return {
    gainDb: 20 * Math.log10(fitted / amp),
    residualDb: 20 * Math.log10(Math.sqrt(rest / n) / (fitted / Math.SQRT2)),
  };
}

// 20·log10 of the RMS over [from, to).
export function levelDb(x: Float32Array, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(sum / (to - from)));
}

// Rising zero crossings over the middle 60 %, each placed by linear interpolation: (crossings − 1) / (last − first), in Hz.
export function zeroCrossHz(x: Float32Array, rate: number): number {
  const [from, to] = middle(x.length);
  let crossings = 0;
  let first = 0;
  let last = 0;
  for (let i = from; i < to - 1; i++) {
    if (x[i] < 0 && x[i + 1] >= 0) {
      const at = i + x[i] / (x[i] - x[i + 1]);
      if (crossings === 0) first = at;
      last = at;
      crossings++;
    }
  }
  return ((crossings - 1) / (last - first)) * rate;
}

// The index of the largest |x|; the first one on a tie.
export function peakIndex(x: Float32Array): number {
  let best = 0;
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[best])) best = i;
  return best;
}

// Indices where |x| is over `above` and a local maximum: over the sample before it and at least the one after it.
export function peaks(x: Float32Array, above: number): number[] {
  const found: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v <= above) continue;
    if (i > 0 && v <= Math.abs(x[i - 1])) continue;
    if (i < x.length - 1 && v < Math.abs(x[i + 1])) continue;
    found.push(i);
  }
  return found;
}

// The largest |a − b|. Two lengths are a mistake in the test, not a difference to measure.
export function maxDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new RangeError(`maxDiff of ${a.length} and ${b.length} samples`);
  let most = 0;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]));
  return most;
}

// One buffer, plane after plane: an f32-planar AudioSample's data.
export function planar(channels: Float32Array[]): Float32Array {
  const out = new Float32Array(channels.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of channels) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
