import type { AudioBlock } from "@/lib/export/schedule";
import { applyGain, type VoicePart } from "@/lib/export/mix";
import { AUDIO } from "@/lib/export/presets";
import { reach, resampleInto, type SincKernel } from "@/lib/export/resample";
import { sourceAt, type SoundSchedule, type Voice } from "@/lib/export/sound-schedule";
import { createSourceRing, type SoundPacket } from "@/lib/export/source-ring";
import { createStretcher } from "@/lib/export/wsola";

// One voice's part of each block, from its file's decoded packets: placed in a ring, resampled to the export's rate
// (and stretched to its speed, keeping the pitch), at the voice's gain and with its edge ramps.

// A tenth of a second: a voice renders, reads and lets go in spans this long, so it holds about this much of its file
// times its speed, never a whole block's worth.
export const SPAN_SAMPLES = AUDIO.sampleRate / 10;

export type VoicePlayer = {
  // The voice's part of the block, gain and ramps applied; null when the block does not reach the voice. Blocks come in
  // order. It takes packets only as far as each span needs, closes each once placed, and lets go of what lies behind
  // each span. A render that rejects leaves the iterator for stop() to return.
  render(block: AudioBlock): Promise<VoicePart | null>;
  // Returns the iterator without waiting, catching a throw and a rejection: it runs mid-export, where an escaped
  // rejection would end the export. The only call that returns it; a second does nothing.
  stop(): void;
  held(): number; // file frames it holds now: the ring's, and the stage's at other speeds
};

export function createVoicePlayer(
  schedule: SoundSchedule,
  voice: Voice,
  packets: AsyncIterator<SoundPacket>,
  kernel: SincKernel,
): VoicePlayer {
  const ring = createSourceRing();
  let done = false;
  let stopped = false;
  // Other speeds keep their pitch: the file is resampled at speed 1 into a stage, which the stretcher reads at
  // tempo = speed. The voice's output sample k is the stretcher's output k − voice.start.
  const stretcher = voice.speed === 1 ? null : createStretcher(voice.speed, (ch, m) => stage.read(ch, m), voice.end - voice.start);
  const stage = createStage(stretcher ? stretcher.keeps() : 0);
  const readLeft = (j: number) => ring.read(0, j);
  const readRight = (j: number) => ring.read(1, j);

  // Takes the next packet into the ring, closing it whether or not it fits, or marks the file's end.
  async function take(): Promise<void> {
    const next = await packets.next();
    if (next.done) {
      done = true;
      ring.end();
      return;
    }
    try {
      ring.place(next.value);
    } finally {
      next.value.close();
    }
  }

  return {
    async render(block) {
      const a = Math.max(block.startSample, voice.start);
      const b = Math.min(block.startSample + block.sampleCount, voice.end);
      if (a >= b) return null;
      const part: VoicePart = { at: a - block.startSample, left: new Float32Array(b - a), right: new Float32Array(b - a) };
      if (ring.rate === null && !done) await take();
      const rate = ring.rate;
      if (rate !== null && stretcher) {
        // Stage index m is the file at speed 1 and the export's rate, m samples after the in point.
        const q = (m: number) => (rate * voice.in) / schedule.fps + (m * rate) / schedule.sampleRate;
        const step = rate / schedule.sampleRate;
        const r = reach(step, kernel);
        for (let c = a; c < b; c += SPAN_SAMPLES) {
          const d = Math.min(c + SPAN_SAMPLES, b);
          const top = stretcher.needs(d - c);
          const from = stage.top;
          if (top > from) {
            const needed = Math.floor(q(top - 1)) + r + 1;
            while (!done && !(ring.top > needed)) await take();
            const [left, right] = stage.extend(top - from);
            resampleInto(left, top - from, readLeft, q(from), step, kernel);
            resampleInto(right, top - from, readRight, q(from), step, kernel);
          }
          stretcher.render({ left: part.left.subarray(c - a, d - a), right: part.right.subarray(c - a, d - a) }, d - c);
          stage.dropBefore(stretcher.keeps());
          ring.dropBefore(Math.floor(q(stage.top)) - r);
        }
      } else if (rate !== null) {
        const p = (k: number) => sourceAt(schedule, voice, k, rate);
        const step = (voice.speed * rate) / schedule.sampleRate;
        const r = reach(step, kernel);
        for (let c = a; c < b; c += SPAN_SAMPLES) {
          const d = Math.min(c + SPAN_SAMPLES, b);
          const needed = Math.floor(p(d - 1)) + r + 1;
          while (!done && !(ring.top > needed)) await take();
          resampleInto(part.left.subarray(c - a, d - a), d - c, readLeft, p(c), step, kernel);
          resampleInto(part.right.subarray(c - a, d - a), d - c, readRight, p(c), step, kernel);
          ring.dropBefore(Math.floor(p(d)) - r);
        }
      }
      applyGain(part, voice.gain, a - voice.start, voice.end - voice.start, { in: voice.fadeIn, out: voice.fadeOut }, voice.envelope, voice.pan ?? 0);
      return part;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        void Promise.resolve(packets.return?.()).catch(() => {});
      } catch {
        // let go anyway: nothing more is read from it
      }
    },
    held() {
      return ring.held() + stage.held();
    },
  };
}

// The voice's file at speed 1, resampled to the export's rate, for the stretcher to read: a stereo ring like the source
// ring, computed in order from `from` and let go from below.
type Stage = {
  readonly top: number; // one past the last index computed
  extend(count: number): [Float32Array, Float32Array]; // room for the next `count` indices, to be filled
  read(channel: 0 | 1, index: number): number; // RangeError outside what is computed and kept
  dropBefore(index: number): void;
  held(): number;
};

function createStage(from: number): Stage {
  let base = from; // the index of storage[0]
  let top = from;
  let left = new Float32Array(0);
  let right = new Float32Array(0);
  return {
    get top() {
      return top;
    },
    extend(count) {
      if (top + count - base > left.length) {
        const size = Math.max(top + count - base, 2 * left.length);
        const nextLeft = new Float32Array(size);
        const nextRight = new Float32Array(size);
        nextLeft.set(left.subarray(0, top - base));
        nextRight.set(right.subarray(0, top - base));
        left = nextLeft;
        right = nextRight;
      }
      const at = top - base;
      top += count;
      return [left.subarray(at, at + count), right.subarray(at, at + count)];
    },
    read(channel, index) {
      if (index < base || index >= top) throw new RangeError(`Stage index ${index} is outside ${base} to ${top}.`);
      return (channel === 0 ? left : right)[index - base];
    },
    dropBefore(index) {
      if (index <= base) return;
      const to = Math.min(index, top);
      left.copyWithin(0, to - base, top - base);
      right.copyWithin(0, to - base, top - base);
      base = to;
    },
    held() {
      return top - base;
    },
  };
}
