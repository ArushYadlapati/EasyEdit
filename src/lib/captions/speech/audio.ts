import { reach, resampleInto, sincKernel } from "@/lib/export/resample";
import type { SoundPacket } from "@/lib/export/source-ring";

// A file's sound as Whisper hears it (mono, 16 kHz, from file time 0), and where to cut it into windows.
// findSilences, silenceCutWindows and their constants were tuned on one set of synthetic test speech and then passed,
// unchanged, on another set they had not seen.

export const SAMPLE_RATE = 16_000;

const FRAME_SECONDS = 0.01;
// A quiet stretch must last this long to count as a pause between phrases.
const MIN_SILENCE_SECONDS = 0.25;
// Quiet means below max(-50 dBFS, the 10th-percentile frame level + 10 dB).
const FLOOR_PERCENTILE = 0.1;
const ABOVE_FLOOR_DB = 10;
const MIN_THRESHOLD_DB = -50;
// Whisper sees at most 30 s at a time; leave a little room.
export const MAX_WINDOW_SECONDS = 28;

export type Span = { start: number; end: number }; // seconds

// Pauses in seconds, from 10 ms frame energy against a threshold that follows the noise floor.
export function findSilences(samples: Float32Array): Span[] {
  const frame = Math.round(FRAME_SECONDS * SAMPLE_RATE);
  const levels: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += samples[j] * samples[j];
    levels.push(10 * Math.log10(sum / frame + 1e-12));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * FLOOR_PERCENTILE)] ?? -120;
  const threshold = Math.max(MIN_THRESHOLD_DB, floor + ABOVE_FLOOR_DB);

  const silences: Span[] = [];
  let runStart = -1;
  for (let f = 0; f <= levels.length; f++) {
    const quiet = f < levels.length && levels[f] < threshold;
    if (quiet && runStart < 0) runStart = f;
    if (!quiet && runStart >= 0) {
      if ((f - runStart) * FRAME_SECONDS >= MIN_SILENCE_SECONDS) {
        silences.push({ start: runStart * FRAME_SECONDS, end: f * FRAME_SECONDS });
      }
      runStart = -1;
    }
  }
  return silences;
}

// Split audio into windows of at most MAX_WINDOW_SECONDS, cutting in the middle of the
// latest pause that fits, so no window overlaps another and no word is cut in two
// (unless a stretch has no pause at all, which gets a hard cut).
export function silenceCutWindows(samples: Float32Array): Span[] {
  const duration = samples.length / SAMPLE_RATE;
  const cuts = findSilences(samples).map((s) => (s.start + s.end) / 2);
  const windows: Span[] = [];
  let start = 0;
  while (duration - start > MAX_WINDOW_SECONDS) {
    const fitting = cuts.filter((c) => c > start && c <= start + MAX_WINDOW_SECONDS);
    const end = fitting.length > 0 ? fitting[fitting.length - 1] : start + MAX_WINDOW_SECONDS;
    windows.push({ start, end });
    start = end;
  }
  windows.push({ start, end: duration });
  return windows;
}

// out[at + i] = the average of every plane's frame i, for i in [0, frames).
export function monoInto(planes: readonly Float32Array[], frames: number, out: Float32Array, at: number): void {
  const share = 1 / planes.length;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const plane of planes) sum += plane[i];
    out[at + i] = planes.length === 1 ? sum : sum * share;
  }
}

// Decoded packets, in file order, taken to mono 16 kHz as they come: only a few packets of the file's own rate are
// held at a time, so the peak memory is the 16 kHz buffer. Each packet sits at its own time (round(timestamp × rate)):
// what lies before time 0 (an encoder's priming) and what overlaps sound already taken are dropped, and a gap reads
// as silence. The caller closes each packet.
export type SpeechSound = {
  add(packet: SoundPacket): void; // throws for a packet whose rate differs from the first's
  seconds(): number; // how far into the file the sound taken so far reaches
  finish(): Float32Array; // the sound at 16 kHz: as long as what was taken, and never longer than `capacity`
};

const GAP_CHUNK = 4096; // a gap is taken as silence in pieces this long, so a long one never needs a long buffer

export function createSpeechSound(capacity: number): SpeechSound {
  const kernel = sincKernel();
  const out = new Float32Array(capacity);
  let rate = 0; // the file's rate, fixed by the first packet
  let step = 0; // file frames per 16 kHz sample
  let r = 0; // file frames the resampler reads on each side of a position
  let made = 0; // 16 kHz samples written
  let top = 0; // one past the last file frame taken
  let base = 0; // the file frame held at held[0]
  let held = new Float32Array(0); // file frames [base, top), mono
  let planes: Float32Array[] = [];
  let mono = new Float32Array(0);

  const read = (j: number) => (j >= base && j < top ? held[j - base] : 0);

  // Writes every 16 kHz sample whose reach ends inside what has been taken (all the rest when `last`). One frame of
  // margin, because resampleInto sums its positions a little differently from (made + count) · step.
  function emit(last: boolean): void {
    const end = last ? Math.min(capacity, Math.ceil((top * SAMPLE_RATE) / rate)) : capacity;
    let count = 0;
    while (made + count < end && (last || Math.floor((made + count) * step) + r + 1 < top)) count++;
    if (count > 0) resampleInto(out.subarray(made), count, read, made * step, step, kernel);
    made += count;
  }

  // Lets go of the file frames no sample still to be written reads (one frame of margin, as in emit).
  function drop(): void {
    const keep = Math.max(base, Math.min(top, Math.floor(made * step) - r));
    if (keep === base) return;
    held.copyWithin(0, keep - base, top - base);
    base = keep;
  }

  // Appends file frames at `top` and writes what they complete.
  function take(frames: Float32Array): void {
    if (made >= capacity) {
      top += frames.length;
      base = top;
      return;
    }
    drop();
    const need = top - base + frames.length;
    if (need > held.length) {
      const grown = new Float32Array(Math.max(need, 2 * held.length));
      grown.set(held.subarray(0, top - base));
      held = grown;
    }
    held.set(frames, top - base);
    top += frames.length;
    emit(false);
  }

  return {
    add(packet) {
      if (rate === 0) {
        rate = packet.sampleRate;
        step = rate / SAMPLE_RATE;
        r = reach(step, kernel);
      } else if (packet.sampleRate !== rate) {
        throw new Error("The sound changed rate partway through the file.");
      }
      const index = Math.round(packet.timestamp * rate);
      for (let gap = index - top; gap > 0; gap = index - top) take(new Float32Array(Math.min(gap, GAP_CHUNK)));
      const frameOffset = top - index;
      const frameCount = packet.numberOfFrames - frameOffset;
      if (frameCount <= 0) return; // wholly before time 0 or under what was taken: copyTo would throw for it
      const channels = packet.numberOfChannels;
      if (planes.length !== channels || planes[0].length < frameCount) {
        planes = Array.from({ length: channels }, () => new Float32Array(frameCount));
      }
      if (mono.length < frameCount) mono = new Float32Array(frameCount);
      for (let c = 0; c < channels; c++) {
        packet.copyTo(planes[c], { planeIndex: c, format: "f32-planar", frameOffset, frameCount });
      }
      monoInto(planes, frameCount, mono, 0);
      take(mono.subarray(0, frameCount));
    },
    seconds: () => (rate === 0 ? 0 : top / rate),
    finish() {
      if (rate === 0) return out.subarray(0, 0);
      emit(true);
      return out.subarray(0, made);
    },
  };
}
