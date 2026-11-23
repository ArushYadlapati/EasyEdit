import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIMIT_CEILING, NO_FX, createChain, createLimiter, isPlainFx, type FxSettings } from "@/lib/audio/clean-dsp";

const RATE = 48_000;
const fx = (over: Partial<FxSettings>): FxSettings => ({ ...NO_FX, ...over });
// A steady tone, a second long unless told otherwise.
const tone = (hz: number, level = 0.25, seconds = 1) => Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => level * Math.sin((2 * Math.PI * hz * i) / RATE));
// How loud the last half is, once a filter has settled.
const rms = (samples: Float32Array, from = Math.floor(samples.length / 2)) => {
  let sum = 0;
  for (let i = from; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length - from));
};
const db = (ratio: number) => 20 * Math.log10(ratio);
// One side through the chain with these settings; the other side gets the same sound.
function through(settings: FxSettings, input: Float32Array): Float32Array {
  const chain = createChain(RATE);
  chain.set(settings);
  const left = Float32Array.from(input);
  chain.process(left, Float32Array.from(input));
  return left;
}
// What a setting does to a tone's level, in dB.
const change = (settings: FxSettings, hz: number, level = 0.1) => db(rms(through(settings, tone(hz, level))) / rms(tone(hz, level)));

describe("a clip with no clean-up", () => {
  it("is not touched, bit for bit", () => {
    const input = tone(440);
    expect(through(NO_FX, input)).toEqual(input);
    expect(isPlainFx(NO_FX)).toBe(true);
    expect([{ lowCut: true }, { gate: 0.1 }, { bass: 1 }, { mid: -1 }, { treble: 0.5 }, { compress: 0.2 }].map((over) => isPlainFx(fx(over)))).toEqual([false, false, false, false, false, false]);
  });
});

describe("the rumble filter", () => {
  it("takes out what is below a voice and leaves the voice", () => {
    expect(change(fx({ lowCut: true }), 20)).toBeLessThan(-20);
    expect(change(fx({ lowCut: true }), 40)).toBeLessThan(-10);
    expect(Math.abs(change(fx({ lowCut: true }), 300))).toBeLessThan(0.5);
    expect(Math.abs(change(fx({ lowCut: true }), 3000))).toBeLessThan(0.1);
  });
});

describe("the three tone bands", () => {
  it("bass lifts or cuts the low end by what it says, and leaves the top alone", () => {
    expect(change(fx({ bass: 12 }), 50)).toBeCloseTo(12, 0);
    expect(change(fx({ bass: -12 }), 50)).toBeCloseTo(-12, 0);
    expect(change(fx({ bass: 6 }), 50)).toBeCloseTo(6, 0);
    expect(Math.abs(change(fx({ bass: 12 }), 5000))).toBeLessThan(0.5);
  });
  it("treble does the same for the top", () => {
    expect(change(fx({ treble: 12 }), 15_000)).toBeCloseTo(12, 0);
    expect(change(fx({ treble: -6 }), 15_000)).toBeCloseTo(-6, 0);
    expect(Math.abs(change(fx({ treble: 12 }), 200))).toBeLessThan(0.5);
  });
  it("the middle band lifts where speech is understood, and little either side", () => {
    expect(change(fx({ mid: 6 }), 2500)).toBeCloseTo(6, 0);
    expect(Math.abs(change(fx({ mid: 6 }), 100))).toBeLessThan(0.5);
    expect(Math.abs(change(fx({ mid: 6 }), 16_000))).toBeLessThan(1);
  });
});

describe("the noise gate", () => {
  it("turns quiet stretches down and lets a voice through whole", () => {
    // Hiss at −54 dB, under the gate at half strength (−45 dB).
    expect(change(fx({ gate: 0.5 }), 1000, 0.002)).toBeLessThan(-18);
    expect(Math.abs(change(fx({ gate: 0.5 }), 1000, 0.25))).toBeLessThan(0.1);
  });
  it("opens at once for a word after silence, and closes slowly after it", () => {
    const quiet = tone(1000, 0.001, 0.5);
    const word = tone(1000, 0.25, 0.25);
    const input = new Float32Array(quiet.length * 2 + word.length);
    input.set(quiet, 0);
    input.set(word, quiet.length);
    input.set(quiet, quiet.length + word.length);
    const out = through(fx({ gate: 0.5 }), input);
    const at = (seconds: number, span = 0.02) => rms(out.subarray(Math.round(seconds * RATE), Math.round((seconds + span) * RATE)), 0);
    expect(at(0.4)).toBeLessThan(0.0002); // gated
    expect(at(0.52)).toBeGreaterThan(0.17); // the word, 20 ms in, is whole
    expect(at(0.76)).toBeGreaterThan(at(1.2)); // just after the word it is still closing
  });
  it("is stronger the more it is turned up", () => {
    expect(change(fx({ gate: 1 }), 1000, 0.002)).toBeLessThan(change(fx({ gate: 0.5 }), 1000, 0.002));
    expect(Math.abs(change(fx({ gate: 0.1 }), 1000, 0.01))).toBeLessThan(0.5); // above a light gate's threshold
  });
});

describe("the compressor", () => {
  it("brings loud and quiet closer together, and makes the whole louder", () => {
    const loud = change(fx({ compress: 0.5 }), 1000, 0.9);
    const quiet = change(fx({ compress: 0.5 }), 1000, 0.01);
    expect(quiet).toBeGreaterThan(5); // the make-up gain
    expect(loud).toBeLessThan(0); // a loud voice comes down
    expect(quiet - loud).toBeGreaterThan(8); // 39 dB apart going in, well under that coming out
  });
  it("does more the more it is turned up", () => {
    const spread = (amount: number) => change(fx({ compress: amount }), 1000, 0.01) - change(fx({ compress: amount }), 1000, 0.9);
    expect(spread(1)).toBeGreaterThan(spread(0.3));
  });
  it("turns both sides down together, so a sound does not wander", () => {
    const chain = createChain(RATE);
    chain.set(fx({ compress: 0.8 }));
    const left = tone(1000, 0.9);
    const right = tone(1000, 0.09);
    const before = rms(left) / rms(right);
    chain.process(left, right);
    expect(rms(left) / rms(right)).toBeCloseTo(before, 3);
  });
});

describe("a clip's sound given in blocks", () => {
  it("comes out the same as given whole: nothing is forgotten between blocks", () => {
    const settings = fx({ lowCut: true, gate: 0.4, bass: -2, mid: 3, treble: 2, compress: 0.5 });
    const input = Float32Array.from({ length: 20_000 }, (_, i) => 0.3 * Math.sin(i / 7) * Math.sin(i / 900) + 0.01 * Math.sin(i * 1.7));
    const whole = through(settings, input);
    const chain = createChain(RATE);
    chain.set(settings);
    const parts = Float32Array.from(input);
    for (let at = 0; at < parts.length; at += 128) {
      const piece = parts.subarray(at, Math.min(parts.length, at + 128));
      chain.process(piece, Float32Array.from(piece));
    }
    expect(parts).toEqual(whole);
  });
  it("a change of settings while it plays does not jump", () => {
    const chain = createChain(RATE);
    chain.set(fx({ bass: 6 }));
    const input = tone(100, 0.2, 0.2);
    const a = Float32Array.from(input.subarray(0, 4800));
    chain.process(a, Float32Array.from(a));
    chain.set(fx({ bass: 7 }));
    const b = Float32Array.from(input.subarray(4800));
    chain.process(b, Float32Array.from(b));
    expect(Math.abs(b[0] - a[a.length - 1])).toBeLessThan(0.02); // one sample on from the last, not a click
  });
});

describe("the limiter on the mix", () => {
  it("never lets a sample past the ceiling, and holds a loud passage, not just its peaks", () => {
    const limiter = createLimiter(RATE);
    const left = tone(440, 2);
    const right = tone(440, 2);
    limiter.process(left, right);
    expect(Math.max(...left.map(Math.abs))).toBeLessThanOrEqual(LIMIT_CEILING + 1e-6);
    // Once it has caught the passage, the wave keeps its shape: its level is that of a tone at the ceiling.
    expect(rms(left)).toBeCloseTo(LIMIT_CEILING * Math.SQRT1_2, 1);
    expect(LIMIT_CEILING).toBe(0.891);
  });
  it("does not touch a mix that stays under the ceiling", () => {
    const limiter = createLimiter(RATE);
    const input = tone(440, 0.8);
    const left = Float32Array.from(input);
    limiter.process(left, Float32Array.from(input));
    expect(left).toEqual(input);
  });
  it("comes back up after a loud moment, to exactly untouched", () => {
    const limiter = createLimiter(RATE);
    expect(limiter.gainFor(1.782)).toBeCloseTo(0.5);
    let gain = 0;
    for (let i = 0; i < RATE; i++) gain = limiter.gainFor(0.1);
    expect(gain).toBe(1);
  });
  it("treats the two sides as one, laid out together or apart", () => {
    const apart = createLimiter(RATE);
    const left = tone(300, 1.5, 0.1);
    const right = tone(500, 0.4, 0.1);
    const together = Float32Array.from({ length: left.length * 2 }, (_, i) => (i % 2 === 0 ? left[i >> 1] : right[i >> 1]));
    apart.process(left, right);
    createLimiter(RATE).processInterleaved(together);
    expect(together.filter((_, i) => i % 2 === 0)).toEqual(left);
    expect(together.filter((_, i) => i % 2 === 1)).toEqual(right);
  });
});

describe("the worklet's copy", () => {
  it("is exactly what the script makes from the source", async () => {
    const { TARGET, made } = (await import("../../scripts/make-worklet.mjs")) as { TARGET: string; made(): string };
    expect(readFileSync(TARGET, "utf8"), "run: node scripts/make-worklet.mjs").toBe(made());
  });

  it("gives the same sound as the source, sample for sample", async () => {
    const copy = (await import("../../public/audio/clean-dsp.js")) as typeof import("@/lib/audio/clean-dsp");
    const settings = fx({ lowCut: true, gate: 0.4, bass: -2, mid: 3, treble: 2, compress: 0.5 });
    const input = Float32Array.from({ length: 9600 }, (_, i) => 0.6 * Math.sin(i / 5) * Math.sin(i / 700));
    const theirs = copy.createChain(RATE);
    theirs.set(settings);
    const out = Float32Array.from(input);
    theirs.process(out, Float32Array.from(input));
    expect(out).toEqual(through(settings, input));
  });

  it("the processor cleans a clip to the settings it is sent, and limits the mix in its other mode", async () => {
    const registered: Record<string, new (options?: unknown) => { port: { onmessage: ((e: { data: FxSettings }) => void) | null }; process(i: Float32Array[][], o: Float32Array[][]): boolean }> = {};
    Object.assign(globalThis, {
      sampleRate: RATE,
      AudioWorkletProcessor: class { port = { onmessage: null }; },
      registerProcessor: (name: string, made: (typeof registered)[string]) => { registered[name] = made; },
    });
    await import("../../public/audio/clean-worklet.js");
    const Processor = registered["easyedit-clean"];
    const run = (node: InstanceType<typeof Processor>, input: Float32Array[]) => {
      const output = [new Float32Array(input[0].length), new Float32Array(input[0].length)];
      expect(node.process([input], [output])).toBe(true);
      return output;
    };
    const input = tone(60, 0.2, 0.05);
    expect(run(new Processor(), [input, input])[0]).toEqual(input); // no settings sent yet: untouched
    const clip = new Processor();
    clip.port.onmessage!({ data: fx({ bass: 12 }) });
    const lifted = run(clip, [input]);
    expect(lifted[0]).toEqual(through(fx({ bass: 12 }), input));
    expect(lifted[1]).toEqual(lifted[0]); // a one-sided sound comes out on both
    const limit = new Processor({ processorOptions: { mode: "limit" } });
    const loud = tone(440, 2, 0.05);
    expect(Math.max(...run(limit, [loud, loud])[0].map(Math.abs))).toBeLessThanOrEqual(LIMIT_CEILING + 1e-6);
    // Nothing connected yet: it keeps running and writes nothing.
    const idle = [new Float32Array(8), new Float32Array(8)];
    expect(new Processor().process([[]], [idle])).toBe(true);
    expect(idle[0]).toEqual(new Float32Array(8));
  });
});
