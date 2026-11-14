import { describe, expect, it } from "vitest";
import { isBypass, reach, resampleInto, sincKernel } from "@/lib/export/resample";
import { fitTone, levelDb, maxDiff, peakIndex, tone } from "./audio-helpers";

const K = sincKernel();
const from = (src: Float32Array) => (i: number) => (i >= 0 && i < src.length ? src[i] : 0);
// One second of 48 kHz output from a source at `rate`, read `step` source frames per output frame.
function convert(src: Float32Array, rate: number, step = rate / 48_000, frames = 48_000): Float32Array {
  const out = new Float32Array(frames);
  resampleInto(out, frames, from(src), 0, step, K);
  return out;
}

describe("resampling to 48 kHz", () => {
  it("builds a 32-tap, 256-phase Kaiser kernel that widens when it reads faster than one frame a sample", () => {
    expect([K.zeros, K.phases]).toEqual([16, 256]);
    expect(K.table[0]).toBeCloseTo(0.92, 6);
    expect([reach(1, K), reach(44_100 / 48_000, K), reach(2, K), reach(4, K)]).toEqual([16, 16, 32, 64]);
  });

  it("keeps a constant at unity, up and down", () => {
    for (const rate of [44_100, 96_000, 22_050]) {
      const out = convert(new Float32Array(rate * 2).fill(0.5), rate);
      for (let i = 1_000; i < 47_000; i += 997) expect(Math.abs(out[i] - 0.5)).toBeLessThan(1e-4);
    }
  });

  it("converts 44.1 kHz cleanly: 1 kHz and 10 kHz keep their level, with everything else 80 dB under", () => {
    for (const freq of [1_000, 10_000]) {
      const { gainDb, residualDb } = fitTone(convert(tone(freq, 44_100, 88_200), 44_100), freq, 48_000, 0.5);
      expect(Math.abs(gainDb)).toBeLessThan(0.05);
      expect(residualDb).toBeLessThan(-80);
    }
  });

  it("removes what 48 kHz cannot hold: 30 kHz from a 96 kHz file, and 15 kHz read twice as fast", () => {
    const high = tone(30_000, 96_000, 192_000);
    expect(levelDb(convert(high, 96_000), 1_000, 47_000) - levelDb(high)).toBeLessThan(-60);
    const fast = tone(15_000, 44_100, 176_400);
    expect(levelDb(convert(fast, 44_100, (2 * 44_100) / 48_000), 1_000, 47_000) - levelDb(fast)).toBeLessThan(-60);
  });

  it("puts an impulse where its time says: file index j at output round(j × 48,000 / rate), down as well as up", () => {
    // 96 kHz takes the widened kernel (reach 32); an even j lands exactly, an odd one would tie between two outputs
    for (const [rate, j, at] of [[44_100, 4_410, 4_800], [44_100, 1_000, 1_088], [22_050, 1_000, 2_177], [96_000, 9_600, 4_800]] as const) {
      const src = new Float32Array(rate);
      src[j] = 1;
      expect(peakIndex(convert(src, rate)), `${rate} ${j}`).toBe(at);
    }
  });

  it("streams: any split of the output gives the same samples", () => {
    const src = tone(3_000, 44_100, 44_100);
    const step = 44_100 / 48_000;
    const whole = convert(src, 44_100);
    const parts = new Float32Array(48_000);
    let at = 0;
    for (const n of [1, 999, 47_000]) {
      const chunk = new Float32Array(n);
      resampleInto(chunk, n, from(src), at * step, step, K);
      parts.set(chunk, at);
      at += n;
    }
    expect(maxDiff(parts, whole)).toBeLessThan(1e-6);
  });

  it("takes each position from its own index, never by adding steps up: ten seconds in, a sample is what it is alone", () => {
    const step = 44_100 / 48_000;
    const read = from(tone(10_000, 44_100, 441_100));
    const run = new Float32Array(480_000);
    resampleInto(run, run.length, read, 0.25, step, K);
    const one = new Float32Array(1);
    for (let i = 0; i < run.length; i += 997) {
      resampleInto(one, 1, read, 0.25 + i * step, step, K);
      expect(run[i], `${i}`).toBe(one[0]);
    }
  });

  it("copies bit for bit at step 1 with a whole offset, and only then", () => {
    expect([isBypass(1_234, 1), isBypass(1_234.5, 1), isBypass(1_234, 44_100 / 48_000)]).toEqual([true, false, false]);
    const src = tone(1_000, 48_000, 4_000);
    const out = new Float32Array(100);
    resampleInto(out, 100, from(src), 1_234, 1, K);
    expect(out).toEqual(src.slice(1_234, 1_334));
  });

  it("writes exactly count samples and reads only within its reach", () => {
    const out = new Float32Array(10).fill(7);
    let lo = Infinity;
    let hi = -Infinity;
    resampleInto(out, 6, (i) => { lo = Math.min(lo, i); hi = Math.max(hi, i); return 0.5; }, 1_000, 0.9, K);
    expect([...out.slice(6)]).toEqual([7, 7, 7, 7]);
    expect([lo, hi]).toEqual([985, 1_020]); // floor(1,000) − 15 … floor(1,004.5) + 16
  });
});
