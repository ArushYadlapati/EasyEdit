import { describe, expect, it } from "vitest";
import { fitTone, impulses, levelDb, maxDiff, peakIndex, peaks, planar, tone, zeroCrossHz } from "./audio-helpers";

describe("the sound test helpers measure what they say", () => {
  it("fit a known tone, and see a second tone 40 dB under it", () => {
    const x = tone(1_000, 48_000, 48_000, 0.5);
    expect(Math.abs(fitTone(x, 1_000, 48_000, 0.5).gainDb)).toBeLessThan(0.001);
    expect(fitTone(x, 1_000, 48_000, 0.5).residualDb).toBeLessThan(-120);
    const dirty = x.map((v, i) => v + 0.005 * Math.sin((2 * Math.PI * 3_000 * i) / 48_000));
    expect(fitTone(dirty, 1_000, 48_000, 0.5).residualDb).toBeCloseTo(-40, 0);
  });

  it("measure level, pitch and peaks", () => {
    expect(levelDb(tone(440, 48_000, 48_000, 1))).toBeCloseTo(-3.01, 2);
    expect(Math.abs(zeroCrossHz(tone(440, 48_000, 48_000), 48_000) - 440)).toBeLessThan(0.01);
    expect(peaks(impulses(10_000, 3_000, 500), 0.5)).toEqual([500, 3_500, 6_500, 9_500]);
    expect(peakIndex(Float32Array.of(0, -0.2, 0.9, -1, 0.3))).toBe(3);
    expect(maxDiff(Float32Array.of(1, 2), Float32Array.of(1, 2.5))).toBe(0.5);
    expect(planar([Float32Array.of(1, 2), Float32Array.of(3, 4)])).toEqual(Float32Array.of(1, 2, 3, 4));
  });

  it("look only where they say, and start from their defaults", () => {
    // Anything in the outer 20 % on each side is not measured; an offset is part of the fit, not left over.
    const edged = tone(1_000, 48_000, 48_000).map((v, i) => (i < 9_000 || i >= 39_000 ? 1 : v + 0.1));
    expect(Math.abs(fitTone(edged, 1_000, 48_000, 0.5).gainDb)).toBeLessThan(0.001);
    expect(fitTone(edged, 1_000, 48_000, 0.5).residualDb).toBeLessThan(-120);
    expect(Math.abs(zeroCrossHz(tone(440, 48_000, 48_000).map((v, i) => (i < 9_000 ? -v : v)), 48_000) - 440)).toBeLessThan(0.01);
    // A pulse wider than a sample is one peak, at its top; a flat top is found at its first sample.
    expect(peaks(Float32Array.of(0, 0.6, 0.8, 0.7, 0, -0.9, -0.9, 0), 0.5)).toEqual([2, 5]);
    expect(levelDb(Float32Array.of(1, 1, 0.5, -0.5), 2)).toBeCloseTo(-6.02, 2);
    expect(levelDb(Float32Array.of(0.5, -0.5, 1, 1), 0, 2)).toBeCloseTo(-6.02, 2);
    expect(levelDb(tone(440, 48_000, 48_000))).toBeCloseTo(-9.03, 2);
    expect(impulses(7, 3)).toEqual(Float32Array.of(1, 0, 0, 1, 0, 0, 1));
    expect(() => maxDiff(Float32Array.of(1, 2), Float32Array.of(1))).toThrow(RangeError);
  });
});
