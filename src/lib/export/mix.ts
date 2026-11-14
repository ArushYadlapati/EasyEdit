// A block's sound from its voices' parts: each voice's gain and edge ramps, the sum, a hard clamp at ±1 and interleaving.
// No limiter, no soft clip, no dither.

import { AUDIO } from "@/lib/export/presets";

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

// Multiplies the part in place by gain × edgeGain(first + i, length): `first` is the part's first sample within its voice.
export function applyGain(part: VoicePart, gain: number, first: number, length: number): void {
  const { left, right } = part;
  for (let i = 0; i < left.length; i++) {
    const g = gain * edgeGain(first + i, length);
    left[i] *= g;
    right[i] *= g;
  }
}

// Sums the parts where they sit, in the order given, clamps each sample to ±1 and interleaves L R L R …,
// in a fresh array of count × 2 on every call. A NaN becomes 0, so it never reaches the encoder; ±Infinity clamps to ±1.
export function mixParts(count: number, parts: readonly VoicePart[]): Float32Array {
  const out = new Float32Array(count * 2);
  for (const { at, left, right } of parts) {
    for (let i = 0; i < left.length; i++) {
      out[2 * (at + i)] += left[i];
      out[2 * (at + i) + 1] += right[i];
    }
  }
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    out[i] = x > 1 ? 1 : x < -1 ? -1 : x === x ? x : 0;
  }
  return out;
}
