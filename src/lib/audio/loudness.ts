import { VOLUME_MAX } from "@/lib/timeline";
import { fromDb, peakOf, toDb } from "./meter";

// How loud a stretch of sound is to a listener, and the volume that would bring it to one common level, so clips
// recorded near and far, or on different phones, end up sounding alike. The measure is the broadcast one without its
// tone filter: the average power of the sound in short overlapping blocks, leaving out the blocks that are silence or
// far below the rest, so pauses between sentences do not count as quiet speech. Pure.

export const TARGET_DB = -20; // where a levelled clip's loudness is put: speech sits here in a comfortable mix
export const CEILING_DB = -1; // and its loudest sample is kept under this, so levelling never makes a clip distort
const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.1;
const SILENCE_DB = -70; // blocks under this are silence
const FAR_BELOW_DB = 10; // and blocks this far under the average of the rest are left out too

export type Loudness = { loudnessDb: number; peak: number }; // peak: the loudest sample, 1 being full scale

// The loudness of samples [from, to) of a sound given side by side, each side the same length. Null when there is
// nothing but silence to measure.
export function measureLoudness(sides: readonly Float32Array[], sampleRate: number, from = 0, to = Infinity): Loudness | null {
  const length = Math.min(...sides.map((side) => side.length));
  const first = Math.max(0, Math.floor(from));
  const end = Math.min(length, Math.ceil(to));
  if (sides.length === 0 || !(end > first)) return null;
  const block = Math.max(1, Math.min(end - first, Math.round(BLOCK_SECONDS * sampleRate)));
  const hop = Math.max(1, Math.round(HOP_SECONDS * sampleRate));
  const powers: number[] = []; // each block's mean square, the sides averaged
  for (let at = first; at + block <= end; at += hop) {
    let sum = 0;
    for (const side of sides) for (let i = at; i < at + block; i++) sum += side[i] * side[i];
    powers.push(sum / (block * sides.length));
  }
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const heard = powers.filter((p) => 10 * Math.log10(p) > SILENCE_DB);
  if (heard.length === 0) return null;
  const gate = mean(heard) / 10 ** (FAR_BELOW_DB / 10);
  const counted = heard.filter((p) => p > gate);
  let peak = 0;
  for (const side of sides) peak = Math.max(peak, peakOf(side.subarray(first, end)));
  return { loudnessDb: 10 * Math.log10(mean(counted.length > 0 ? counted : heard)), peak };
}

// The volume that brings a sound measured this way to the target: up or down, never so far up that its loudest
// sample would pass the ceiling, and never past what a clip's volume can be. In whole percents.
export function levelVolume(measured: Loudness): number {
  const wanted = fromDb(TARGET_DB - measured.loudnessDb);
  const room = measured.peak > 0 ? fromDb(CEILING_DB) / measured.peak : Infinity;
  return Math.round(Math.min(wanted, room, VOLUME_MAX) * 100) / 100;
}

// For the person: how far a volume moves the sound, as "+6.0 dB" or "-3.5 dB".
export function gainLabel(volume: number): string {
  const db = toDb(volume);
  if (db === -Infinity) return "silent";
  const rounded = Math.round(db * 10) / 10;
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)} dB`;
}
