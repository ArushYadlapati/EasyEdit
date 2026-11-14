import type { AudioBlock } from "@/lib/export/schedule";
import { applyGain, type VoicePart } from "@/lib/export/mix";
import { AUDIO } from "@/lib/export/presets";
import { reach, resampleInto, type SincKernel } from "@/lib/export/resample";
import { sourceAt, type SoundSchedule, type Voice } from "@/lib/export/sound-schedule";
import { createSourceRing, type SoundPacket } from "@/lib/export/source-ring";

// One voice's part of each block, from its file's decoded packets: placed in a ring, resampled to the export's rate,
// at the voice's gain and with its edge ramps.

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
  held(): number; // file frames it holds now
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
      if (rate !== null) {
        const p = (k: number) => sourceAt(schedule, voice, k, rate);
        const step = (voice.speed * rate) / schedule.sampleRate;
        const r = reach(step, kernel);
        const readLeft = (j: number) => ring.read(0, j);
        const readRight = (j: number) => ring.read(1, j);
        for (let c = a; c < b; c += SPAN_SAMPLES) {
          const d = Math.min(c + SPAN_SAMPLES, b);
          const needed = Math.floor(p(d - 1)) + r + 1;
          while (!done && !(ring.top > needed)) await take();
          resampleInto(part.left.subarray(c - a, d - a), d - c, readLeft, p(c), step, kernel);
          resampleInto(part.right.subarray(c - a, d - a), d - c, readRight, p(c), step, kernel);
          ring.dropBefore(Math.floor(p(d)) - r);
        }
      }
      applyGain(part, voice.gain, a - voice.start, voice.end - voice.start);
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
      return ring.held();
    },
  };
}
