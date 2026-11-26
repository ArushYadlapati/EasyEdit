import { describe, expect, it } from "vitest";
import { DENOISE_FRAME, NO_FX, createChain, createDenoiser, isPlainFx, type FxSettings } from "@/lib/audio/clean-dsp";

const RATE = 48_000;
const LATE = DENOISE_FRAME; // how late the sound comes out
function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// Steady noise at a level in dB, the same on every run.
function hiss(seconds: number, levelDb: number, seed = 7): Float32Array {
  const next = random(seed);
  const sigma = Math.pow(10, levelDb / 20);
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => sigma * Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next()));
}
// A voice of sorts from one second on: words of three gliding pitches, 0.35 s long, with 0.25 s pauses between.
function words(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = RATE; i < out.length; i++) {
    const t = (i - RATE) / RATE;
    if (t % 0.6 >= 0.35) continue;
    const glide = 1 + 0.15 * Math.sin(2 * Math.PI * 1.3 * t);
    out[i] = 0.1 * (Math.sin(2 * Math.PI * 220 * glide * t) + 0.6 * Math.sin(2 * Math.PI * 880 * glide * t) + 0.4 * Math.sin(2 * Math.PI * 2600 * glide * t));
  }
  return out;
}
const sum = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + b[i]);
const level = (x: Float32Array, fromSeconds: number, toSeconds: number, late = 0) => {
  const from = Math.round(fromSeconds * RATE) + late;
  const to = Math.round(toSeconds * RATE) + late;
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return 10 * Math.log10(Math.max(s / (to - from), 1e-18));
};
// Both sides through the noise reduction, in blocks of this many samples.
function reduce(amount: number, left: Float32Array, right: Float32Array = left, block = 128): [Float32Array, Float32Array] {
  const d = createDenoiser(RATE);
  d.set(amount);
  const l = left.slice();
  const r = right.slice();
  for (let at = 0; at < l.length; at += block) d.process(l.subarray(at, at + block), r.subarray(at, at + block));
  return [l, r];
}
const fx = (over: Partial<FxSettings>): FxSettings => ({ ...NO_FX, ...over });

describe("noise reduction", () => {
  it("turns steady noise down, more the more of it is asked for", () => {
    const noise = hiss(9, -40);
    const taken = (amount: number) => level(noise, 5, 8.9) - level(reduce(amount, noise)[0], 5, 8.9, LATE);
    const [light, half, full] = [taken(0.25), taken(0.5), taken(1)];
    expect(light).toBeGreaterThan(7);
    expect(half).toBeGreaterThan(12);
    expect(full).toBeGreaterThan(20);
    expect(light < half && half < full).toBe(true);
    // Never past the least it turns any pitch down to: what is left stays even.
    expect(full).toBeLessThan(30);
  });

  it("keeps a voice 14 dB above the noise to within a decibel, and clears the pauses between its words", () => {
    const voice = words(10);
    const mixed = sum(voice, hiss(10, -35));
    const [out] = reduce(0.5, mixed);
    // The eleventh word, and the pause after it.
    const word = [7.08, 7.3] as const;
    const pause = [7.42, 7.56] as const;
    expect(Math.abs(level(out, ...word, LATE) - level(voice, ...word))).toBeLessThan(1);
    expect(level(mixed, ...pause) - level(out, ...pause, LATE)).toBeGreaterThan(12);
  });

  it("lets a clip's first word through while it learns the noise", () => {
    // The clip starts on the word: there is no noise alone to learn from yet.
    const start = sum(words(3).slice(RATE), hiss(2, -50, 3));
    expect(Math.abs(level(reduce(0.5, start)[0], 0.05, 0.3, LATE) - level(start, 0.05, 0.3))).toBeLessThan(0.5);
    expect(Math.abs(level(reduce(1, start)[0], 0.05, 0.3, LATE) - level(start, 0.05, 0.3))).toBeLessThan(1);
  });

  it("gives a clean, changing sound back as it was, 512 samples late", () => {
    // A tone that never rests on one pitch, with next to no noise under it.
    const glide = Float32Array.from({ length: 3 * RATE }, (_, i) => 0.2 * Math.sin(2 * Math.PI * (300 + 200 * (i / RATE)) * (i / RATE)));
    const input = sum(glide, hiss(3, -100, 5));
    const [out] = reduce(0.5, input);
    let off = 0;
    for (let i = RATE; i < 2 * RATE; i++) off += (out[i + LATE] - input[i]) ** 2;
    const error = 10 * Math.log10(off / RATE);
    expect(error).toBeLessThan(level(input, 1, 2) - 30); // what differs is under a thousandth of the sound's power
    // And the sound's own start comes out 512 samples in: before that there is next to nothing.
    const early = Math.max(...out.slice(0, DENOISE_FRAME - 128).map(Math.abs));
    expect(early).toBeLessThan(1e-4);
  });

  it("gives the same sound whatever the size of the blocks it is handed", () => {
    const mixed = sum(words(3), hiss(3, -40));
    const [small] = reduce(0.5, mixed, mixed, 128);
    const [odd] = reduce(0.5, mixed, mixed, 1000);
    const [whole] = reduce(0.5, mixed, mixed, mixed.length);
    expect(odd).toEqual(small);
    expect(whole).toEqual(small);
  });

  it("turns both sides down together, so the sound stays where it was between them", () => {
    const mixed = sum(words(6), hiss(6, -40));
    const quieter = mixed.map((v) => v * 0.25); // the right side: the same sound, 12 dB down
    const [l, r] = reduce(0.5, mixed, quieter);
    expect(level(l, 4, 5.9, LATE) - level(r, 4, 5.9, LATE)).toBeCloseTo(12.04, 1);
  });

  it("gives silence for silence, and never anything that is not a number", () => {
    const [l, r] = reduce(1, new Float32Array(RATE));
    expect([...l, ...r].every((v) => v === 0)).toBe(true);
    const [loud] = reduce(1, Float32Array.from({ length: RATE }, (_, i) => (i % 2 ? 1 : -1)));
    expect(loud.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("takes a note held for seconds for noise, which is why it is made for a voice", () => {
    const held = sum(Float32Array.from({ length: 6 * RATE }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / RATE)), hiss(6, -60));
    const [out] = reduce(1, held);
    expect(level(held, 0.05, 0.3) - level(out, 0.05, 0.3, LATE)).toBeLessThan(1.5); // at first it is heard
    expect(level(held, 4, 5.9) - level(out, 4, 5.9, LATE)).toBeGreaterThan(10); // after two seconds of it, far less
  });
});

describe("noise reduction in a clip's clean-up", () => {
  const through = (settings: FxSettings, input: Float32Array) => {
    const chain = createChain(RATE);
    chain.set(settings);
    const left = input.slice();
    chain.process(left, input.slice());
    return left;
  };
  it("is one of the settings: on, the clip is no longer left as it was", () => {
    expect([isPlainFx(fx({ denoise: 0.3 })), isPlainFx(fx({ denoise: 0 })), isPlainFx(NO_FX)]).toEqual([false, true, true]);
    const noise = hiss(6, -40);
    expect(through(NO_FX, noise)).toEqual(noise);
    expect(level(noise, 4, 5.9) - level(through(fx({ denoise: 0.5 }), noise), 4, 5.9, LATE)).toBeGreaterThan(12);
  });
  it("comes first, so the compressor that follows lifts the voice and not the noise", () => {
    const noise = hiss(6, -40);
    const compressed = through(fx({ compress: 0.5 }), noise);
    const both = through(fx({ compress: 0.5, denoise: 0.5 }), noise);
    expect(level(compressed, 4, 5.9) - level(both, 4, 5.9, LATE)).toBeGreaterThan(12);
  });
  it("can be changed while the sound plays, and switched off again", () => {
    const chain = createChain(RATE);
    const noise = hiss(8, -40);
    const l = noise.slice();
    const r = noise.slice();
    chain.set(fx({ denoise: 0.25 }));
    chain.process(l.subarray(0, 4 * RATE), r.subarray(0, 4 * RATE));
    chain.set(fx({ denoise: 1 }));
    chain.process(l.subarray(4 * RATE, 7 * RATE), r.subarray(4 * RATE, 7 * RATE));
    chain.set(NO_FX);
    chain.process(l.subarray(7 * RATE), r.subarray(7 * RATE));
    const taken = (from: number, to: number, late = LATE) => level(noise, from, to) - level(l, from, to, late);
    expect(taken(5.5, 6.9)).toBeGreaterThan(taken(2.5, 3.9) + 6);
    expect(taken(7.2, 7.9, 0)).toBeCloseTo(0, 5); // off: as it was, and on time
  });
});
