import { AUDIO } from "@/lib/export/presets";

// Time-stretching that keeps the pitch: stereo-linked, streaming WSOLA (overlap-add of Hann frames, each moved within
// a search range to where it best continues the frame before it). At tempo 1 it copies.

// 20 ms frames, 50 % overlap, searched ±10 ms.
export const WSOLA = { frame: AUDIO.sampleRate / 50, hop: AUDIO.sampleRate / 100, search: AUDIO.sampleRate / 100 } as const;

export type Stretcher = {
  needs(count: number): number; // one past the highest stream index the next render(count) reads
  keeps(): number; // the lowest stream index any later render reads: what lies below may be dropped
  render(out: { left: Float32Array; right: Float32Array }, count: number): void; // the next `count` output samples
};

// The coarse search tries every COARSE-th offset, then every offset within FINE of the best of those.
const COARSE = 4;
const FINE = 3;

// source(channel, m) is the 48 kHz stream at speed 1, index 0 at the voice's start. It is called only for indices in
// [keeps(), needs(count)) of the render that calls it that lie in [0, ceil(length × tempo)), the voice's own source, and
// never for a negative index. `length` is the number of outputs the stretcher will give.
// At tempo 1 the stretcher copies: out[o] = source(channel, o), each index read once per channel; needs(count) is o + count
// and keeps() is o, with o the outputs already given.
export function createStretcher(tempo: number, source: (channel: 0 | 1, index: number) => number, length: number): Stretcher {
  // Only the voice's own source sounds: [0, span), its in point to its out point at speed 1, for `length` outputs. What
  // lies either side reads as silence, and the search keeps the part of each frame that reaches the output inside it.
  const span = Math.ceil(length * tempo);
  const read = (channel: 0 | 1, index: number) => (index >= 0 && index < span ? source(channel, index) : 0);
  if (tempo === 1) return copier(read);
  const N = WSOLA.frame;
  const H = WSOLA.hop;
  const S = WSOLA.search;

  // Periodic Hann: two of them H apart sum to 1.
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  // Frame k's nominal input, centred on its output: its middle, output k·H + H, reads input (k + 1)·H·tempo.
  // From k each time, never added up.
  const tau = (k: number) => Math.round((k + 1) * H * tempo) - H;

  const template = new Float32Array(H); // the mid that would follow the last frame added, where the next one overlaps it
  const scratch = new Float32Array(2 * S + H); // the mid over [τ − S, τ + S + H)
  const energy = new Float64Array(2 * S + H + 1); // prefix sums of the scratch's squares
  const frame = [new Float64Array(N), new Float64Array(N)]; // the frame being added, per channel
  const ready = [new Float64Array(H), new Float64Array(H)]; // the hop the last frame added finished
  const tail = [new Float64Array(H), new Float64Array(H)]; // the last frame's second half, waiting for the next frame
  let next = -1; // the first frame not yet added
  let given = 0; // outputs already given

  // The offset in [−S, S] where the mid best matches the template, normalised by its energy; ties go to the smaller
  // |δ|, then the smaller δ.
  function search(t: number, heard: number): number {
    const hi = Math.max(-S, Math.min(S, span - heard - t)); // what of the frame is heard ends by the span's end, where it fits
    for (let j = 0; j < scratch.length; j++) scratch[j] = (read(0, t - S + j) + read(1, t - S + j)) / 2;
    energy[0] = 0;
    for (let j = 0; j < scratch.length; j++) energy[j + 1] = energy[j] + scratch[j] * scratch[j];
    const score = (delta: number) => {
      const at = delta + S;
      let dot = 0;
      for (let i = 0; i < H; i++) dot += scratch[at + i] * template[i];
      return dot / Math.sqrt(Math.max(0, energy[at + H] - energy[at]) + 1e-12);
    };
    let best = 0;
    let bestScore = -Infinity;
    const consider = (delta: number) => {
      const value = score(delta);
      const better =
        value > bestScore ||
        (value === bestScore && (Math.abs(delta) < Math.abs(best) || (Math.abs(delta) === Math.abs(best) && delta < best)));
      if (better) {
        best = delta;
        bestScore = value;
      }
    };
    for (let delta = -S; delta <= S; delta += COARSE) if (delta <= hi) consider(delta);
    const coarse = best;
    for (let delta = Math.max(-S, coarse - FINE); delta <= Math.min(hi, coarse + FINE); delta++) consider(delta);
    return best;
  }

  // Adds frame `next` at output [next·H, next·H + N): its first half finishes the hop under it, its second half waits.
  function addFrame(): void {
    const k = next;
    const t = tau(k);
    const p = k < 0 ? t : t + search(t, Math.min(N, length - k * H));
    for (let i = 0; i < N; i++) {
      frame[0][i] = read(0, p + i);
      frame[1][i] = read(1, p + i);
    }
    for (let ch = 0; ch < 2; ch++) {
      const x = frame[ch];
      for (let i = 0; i < H; i++) {
        ready[ch][i] = tail[ch][i] + hann[i] * x[i];
        tail[ch][i] = hann[H + i] * x[H + i];
      }
    }
    for (let i = 0; i < H; i++) template[i] = (frame[0][H + i] + frame[1][H + i]) / 2;
    next = k + 1;
  }

  return {
    needs(count) {
      return tau(Math.floor((given + count - 1) / H)) + S + N;
    },
    keeps() {
      return tau(next) - S;
    },
    render(out, count) {
      for (let n = 0; n < count; n++) {
        const o = given + n;
        const hop = Math.floor(o / H);
        // An output is finished once the frame that starts in its hop is added.
        while (next <= hop) addFrame();
        out.left[n] = ready[0][o - hop * H];
        out.right[n] = ready[1][o - hop * H];
      }
      given += count;
    },
  };
}

function copier(read: (channel: 0 | 1, index: number) => number): Stretcher {
  let given = 0;
  return {
    needs(count) {
      return given + count;
    },
    keeps() {
      return given;
    },
    render(out, count) {
      for (let n = 0; n < count; n++) {
        out.left[n] = read(0, given + n);
        out.right[n] = read(1, given + n);
      }
      given += count;
    },
  };
}
