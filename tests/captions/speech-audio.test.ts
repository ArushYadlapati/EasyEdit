import { describe, expect, it } from "vitest";
import {
  MAX_WINDOW_SECONDS,
  SAMPLE_RATE,
  createSpeechSound,
  findSilences,
  monoInto,
  silenceCutWindows,
} from "@/lib/captions/speech/audio";
import type { SoundPacket } from "@/lib/export/source-ring";
import { tone } from "../export/audio-helpers";

// Sound at 16 kHz from parts: a number of seconds of a 440 Hz tone, or of digital silence.
function sound(parts: { tone?: number; quiet?: number }[]): Float32Array {
  const pieces = parts.map((part) =>
    part.tone !== undefined ? tone(440, SAMPLE_RATE, part.tone * SAMPLE_RATE) : new Float32Array((part.quiet ?? 0) * SAMPLE_RATE),
  );
  const out = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

describe("finding pauses", () => {
  it("finds a pause between two stretches of sound", () => {
    const silences = findSilences(sound([{ tone: 1 }, { quiet: 0.5 }, { tone: 1 }]));
    expect(silences).toHaveLength(1);
    expect(silences[0].start).toBeCloseTo(1, 5);
    expect(silences[0].end).toBeCloseTo(1.5, 5);
  });

  it("does not count a gap shorter than a quarter second", () => {
    expect(findSilences(sound([{ tone: 1 }, { quiet: 0.1 }, { tone: 1 }, { quiet: 1 }]))).toHaveLength(1);
  });
});

describe("cutting sound into windows", () => {
  it("keeps short sound in one window", () => {
    const samples = sound([{ tone: 5 }, { quiet: 1 }, { tone: 4 }]);
    expect(silenceCutWindows(samples)).toEqual([{ start: 0, end: 10 }]);
  });

  it("cuts in the middle of the latest pause that fits, never making a window over 28 s", () => {
    // Pauses at 10, 20, 26, 30 and 45 s, and 7 s of quiet at the end (so the noise floor is the quiet, as in speech).
    const samples = sound([
      { tone: 10 }, { quiet: 0.5 }, { tone: 9.5 }, { quiet: 0.5 }, { tone: 5.5 }, { quiet: 0.5 },
      { tone: 3.5 }, { quiet: 0.5 }, { tone: 14.5 }, { quiet: 0.5 }, { tone: 14.5 }, { quiet: 7 },
    ]);
    const windows = silenceCutWindows(samples);
    expect(windows.map((w) => [w.start, w.end].map((s) => Math.round(s * 100) / 100))).toEqual([
      [0, 26.25],
      [26.25, 45.25],
      [45.25, 67],
    ]);
    for (const w of windows) expect(w.end - w.start).toBeLessThanOrEqual(MAX_WINDOW_SECONDS);
  });

  it("cuts hard at 28 s where there is no pause", () => {
    const samples = sound([{ tone: 56 }, { quiet: 8 }]);
    const windows = silenceCutWindows(samples);
    expect(windows).toEqual([
      { start: 0, end: 28 },
      { start: 28, end: 56 },
      { start: 56, end: 64 },
    ]);
  });

  it("gives windows that cover the sound end to end, each at most 28 s", () => {
    const samples = sound([{ tone: 40 }, { quiet: 2 }, { tone: 50 }, { quiet: 1 }, { tone: 3 }, { quiet: 20 }]);
    const windows = silenceCutWindows(samples);
    expect(windows[0].start).toBe(0);
    expect(windows.at(-1)!.end).toBe(samples.length / SAMPLE_RATE);
    for (let i = 1; i < windows.length; i++) expect(windows[i].start).toBe(windows[i - 1].end);
    for (const w of windows) expect(w.end - w.start).toBeLessThanOrEqual(MAX_WINDOW_SECONDS);
  });
});

describe("mixing channels to one", () => {
  it("copies one channel", () => {
    const out = new Float32Array(5).fill(9);
    monoInto([Float32Array.of(0.1, 0.2, 0.3)], 3, out, 1);
    expect(Array.from(out)).toEqual([9, 0.1, 0.2, 0.3, 9].map(Math.fround));
  });

  it("averages two channels", () => {
    const out = new Float32Array(3);
    monoInto([Float32Array.of(1, 0.5, -1), Float32Array.of(0, 0.5, 1)], 3, out, 0);
    expect(Array.from(out)).toEqual([0.5, 0.5, 0]);
  });

  it("averages six channels, only over the frames asked for", () => {
    const planes = [1, 2, 3, 4, 5, 6].map((v) => Float32Array.of(v, v * 2, 100));
    const out = new Float32Array(4).fill(-1);
    monoInto(planes, 2, out, 2);
    expect(Array.from(out)).toEqual([-1, -1, 3.5, 7]);
  });
});

// A decoded packet like mediabunny's AudioSample: planar channels at a rate, starting at a time.
function packet(timestamp: number, sampleRate: number, planes: Float32Array[]): SoundPacket & { closed: boolean } {
  return {
    timestamp,
    sampleRate,
    numberOfChannels: planes.length,
    numberOfFrames: planes[0].length,
    closed: false,
    copyTo(destination, { planeIndex, frameOffset = 0, frameCount = planes[0].length - frameOffset }) {
      destination.set(planes[planeIndex].subarray(frameOffset, frameOffset + frameCount));
    },
    close() {
      this.closed = true;
    },
  };
}

// The sound cut into packets of `size` frames, each stamped with its time.
function packets(planes: Float32Array[], rate: number, size: number, from = 0): SoundPacket[] {
  const out: SoundPacket[] = [];
  for (let i = 0; i < planes[0].length; i += size) {
    out.push(packet(from + i / rate, rate, planes.map((p) => p.slice(i, i + size))));
  }
  return out;
}

describe("taking decoded sound to 16 kHz mono", () => {
  it("keeps 16 kHz mono sound as it is", () => {
    const source = tone(300, SAMPLE_RATE, SAMPLE_RATE);
    const speech = createSpeechSound(SAMPLE_RATE);
    for (const p of packets([source], SAMPLE_RATE, 1000)) speech.add(p);
    expect(speech.seconds()).toBe(1);
    expect(Array.from(speech.finish())).toEqual(Array.from(source));
  });

  it("resamples 48 kHz stereo to a 16 kHz mono tone at the same time and level", () => {
    const left = tone(440, 48_000, 96_000);
    const right = tone(440, 48_000, 96_000, 0.3);
    const speech = createSpeechSound(2 * SAMPLE_RATE);
    for (const p of packets([left, right], 48_000, 1024)) speech.add(p);
    const out = speech.finish();
    expect(out.length).toBe(2 * SAMPLE_RATE);
    const expected = tone(440, SAMPLE_RATE, 2 * SAMPLE_RATE, 0.4);
    let worst = 0;
    for (let i = 1000; i < out.length - 1000; i++) worst = Math.max(worst, Math.abs(out[i] - expected[i]));
    expect(worst).toBeLessThan(1e-3);
  });

  it("resamples 44.1 kHz to the length of the sound at 16 kHz", () => {
    const speech = createSpeechSound(10 * SAMPLE_RATE);
    for (const p of packets([tone(200, 44_100, 44_100 * 3)], 44_100, 1024)) speech.add(p);
    expect(speech.seconds()).toBeCloseTo(3, 6);
    expect(speech.finish().length).toBe(3 * SAMPLE_RATE);
  });

  it("places sound at its file time: a late first packet leaves silence before it, a gap reads as silence", () => {
    const ones = (n: number) => new Float32Array(n).fill(0.5);
    const speech = createSpeechSound(4 * SAMPLE_RATE);
    speech.add(packet(1, SAMPLE_RATE, [ones(SAMPLE_RATE)]));
    speech.add(packet(3, SAMPLE_RATE, [ones(SAMPLE_RATE)]));
    const out = speech.finish();
    expect(out.length).toBe(4 * SAMPLE_RATE);
    expect(out[SAMPLE_RATE / 2]).toBe(0);
    expect(out[1.5 * SAMPLE_RATE]).toBe(0.5);
    expect(out[2.5 * SAMPLE_RATE]).toBe(0);
    expect(out[3.5 * SAMPLE_RATE]).toBe(0.5);
  });

  it("drops what comes before time 0 and what overlaps sound already taken", () => {
    const speech = createSpeechSound(SAMPLE_RATE);
    speech.add(packet(-0.5, SAMPLE_RATE, [new Float32Array(SAMPLE_RATE).fill(0.25)])); // priming, then 0.5 s of sound
    speech.add(packet(0.25, SAMPLE_RATE, [new Float32Array(SAMPLE_RATE / 2).fill(0.75)])); // 0.25 s over what is there
    const out = speech.finish();
    expect(out.length).toBe(0.75 * SAMPLE_RATE);
    expect(out[0]).toBe(0.25);
    expect(out[0.4 * SAMPLE_RATE]).toBe(0.25);
    expect(out[0.6 * SAMPLE_RATE]).toBe(0.75);
  });

  it("stops at the room it was given", () => {
    const speech = createSpeechSound(SAMPLE_RATE);
    for (const p of packets([tone(300, 48_000, 48_000 * 2)], 48_000, 4800)) speech.add(p);
    expect(speech.finish().length).toBe(SAMPLE_RATE);
  });

  it("refuses a packet whose rate differs from the first", () => {
    const speech = createSpeechSound(SAMPLE_RATE);
    speech.add(packet(0, 48_000, [new Float32Array(480)]));
    expect(() => speech.add(packet(0.01, 44_100, [new Float32Array(441)]))).toThrow();
  });
});
