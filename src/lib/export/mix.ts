// A block's sound from its voices' parts: each voice's gain, fades and edge ramps, the sum, the mix's limiter where
// one is given, a hard clamp at ±1 and interleaving. No soft clip, no dither.

import { AUDIO } from "@/lib/export/presets";
import { fadeGain, panGains } from "@/lib/render/clip-sound";
import { ease } from "@/lib/timeline/keyframes";
import type { EnvelopePoint } from "./sound-schedule";

// 4 ms at the export's rate.
export const EDGE_RAMP_SAMPLES = AUDIO.sampleRate / 250;

// A voice's envelope at sample `index` of its `length`: a raised cosine 0.5 − 0.5·cos(π·i / r) in over the first r samples
// and the same, mirrored, out over the last r, with r = min(EDGE_RAMP_SAMPLES, floor(length / 2)); 1 between; 1 when r is 0.
export function edgeGain(index: number, length: number): number {
  const r = Math.min(EDGE_RAMP_SAMPLES, Math.floor(length / 2));
  if (index < r) return 0.5 - 0.5 * Math.cos((Math.PI * index) / r);
  const fromEnd = length - 1 - index;
  if (fromEnd < r) return 0.5 - 0.5 * Math.cos((Math.PI * fromEnd) / r);
  return 1;
}

// A voice's samples for [at, at + left.length) of a block.
export type VoicePart = { at: number; left: Float32Array; right: Float32Array };

// The samples a voice fades over at its start and at its end; 0 for none.
export type VoiceFade = { in: number; out: number };
const NO_FADE: VoiceFade = { in: 0, out: 0 };

// Multiplies the part in place by gain × edgeGain(first + i, length) × the fades' gain there, by the rule the preview
// fades by: `first` is the part's first sample within its voice.
// envelope: the voice's volume keyframes, in samples from its start; the gain follows them from one to the next.
// pan: the voice moved towards one side, by the rule the preview's panner follows (panGains).
export function applyGain(part: VoicePart, gain: number, first: number, length: number, fade: VoiceFade = NO_FADE, envelope?: readonly EnvelopePoint[], pan = 0): void {
  const { left, right } = part;
  const sides = pan === 0 ? null : panGains(pan);
  const fades = fade.in > 0 || fade.out > 0;
  const shaped = envelope !== undefined && envelope.length > 0;
  let seg = 0; // the keyframe at or before the sample being written; samples only go forward
  for (let i = 0; i < left.length; i++) {
    let g = gain * edgeGain(first + i, length);
    if (fades) g *= fadeGain(first + i, length, fade.in, fade.out);
    if (shaped) {
      const at = first + i;
      while (seg + 1 < envelope.length && envelope[seg + 1].at <= at) seg++;
      const a = envelope[seg];
      const b = envelope[seg + 1];
      g *= at <= a.at || !b ? a.value : a.value + (b.value - a.value) * ease(a.ease ?? "linear", (at - a.at) / (b.at - a.at));
    }
    if (sides) {
      const l = left[i];
      const r = right[i];
      left[i] = (l * sides.ll + r * sides.lr) * g;
      right[i] = (l * sides.rl + r * sides.rr) * g;
      continue;
    }
    left[i] *= g;
    right[i] *= g;
  }
}

// Sums the parts where they sit, in the order given, clamps each sample to ±1 and interleaves L R L R …,
// in a fresh array of count × 2 on every call. A NaN becomes 0, so it never reaches the encoder; ±Infinity clamps to ±1.
// limit: the mix's limiter, which holds a mix that would pass its ceiling; the clamp after it is then only a guard.
export function mixParts(count: number, parts: readonly VoicePart[], limit?: { processInterleaved(samples: Float32Array): void }): Float32Array {
  const out = new Float32Array(count * 2);
  for (const { at, left, right } of parts) {
    for (let i = 0; i < left.length; i++) {
      out[2 * (at + i)] += left[i];
      out[2 * (at + i) + 1] += right[i];
    }
  }
  if (limit) {
    // A NaN would poison the limiter's memory, so it is made 0 first.
    for (let i = 0; i < out.length; i++) if (out[i] !== out[i]) out[i] = 0;
    limit.processInterleaved(out);
  }
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    out[i] = x > 1 ? 1 : x < -1 ? -1 : x === x ? x : 0;
  }
  return out;
}
