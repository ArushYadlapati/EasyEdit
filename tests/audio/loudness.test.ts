import { describe, expect, it } from "vitest";
import { CEILING_DB, TARGET_DB, gainLabel, levelVolume, measureLoudness } from "@/lib/audio/loudness";
import { fromDb } from "@/lib/audio/meter";

const RATE = 22_050;
// A sine at this peak amplitude: its loudness is 3.01 dB under its peak.
const tone = (seconds: number, amplitude: number, hz = 440) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE));
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const joined = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe("how loud a sound is", () => {
  it("keeps its target and ceiling", () => {
    expect([TARGET_DB, CEILING_DB]).toEqual([-20, -1]);
  });

  it("measures a steady tone at its power, and its loudest sample", () => {
    const m = measureLoudness([tone(2, 0.5)], RATE)!;
    expect(m.loudnessDb).toBeCloseTo(-9.03, 1); // 20·log10(0.5 / √2)
    expect(m.peak).toBeCloseTo(0.5, 3);
  });

  it("averages the sides, so one silent side halves the power", () => {
    const m = measureLoudness([tone(2, 0.5), silence(2)], RATE)!;
    expect(m.loudnessDb).toBeCloseTo(-12.04, 1);
    expect(m.peak).toBeCloseTo(0.5, 3);
  });

  it("leaves the pauses out, so speech with gaps measures as loud as the speech", () => {
    const steady = measureLoudness([tone(2, 0.5)], RATE)!.loudnessDb;
    const gappy = measureLoudness([joined(tone(2, 0.5), silence(4), tone(2, 0.5))], RATE)!.loudnessDb;
    expect(gappy).toBeCloseTo(steady, 0);
    // A stretch far quieter than the rest is left out too.
    const withWhisper = measureLoudness([joined(tone(2, 0.5), tone(4, 0.005))], RATE)!.loudnessDb;
    expect(withWhisper).toBeCloseTo(steady, 0);
  });

  it("measures only the part asked for", () => {
    const sound = joined(tone(2, 0.8), tone(2, 0.1));
    const loud = measureLoudness([sound], RATE, 0, 2 * RATE)!;
    const quiet = measureLoudness([sound], RATE, 2 * RATE, 4 * RATE)!;
    expect(loud.loudnessDb).toBeCloseTo(-4.95, 1);
    expect(quiet.loudnessDb).toBeCloseTo(-23.01, 1);
    expect(quiet.peak).toBeCloseTo(0.1, 3);
    // Past the end is cut to what there is.
    expect(measureLoudness([sound], RATE, 2 * RATE, 99 * RATE)!.loudnessDb).toBeCloseTo(-23.01, 1);
  });

  it("has nothing to say about silence, an empty part or no sides", () => {
    expect(measureLoudness([silence(2)], RATE)).toBeNull();
    expect(measureLoudness([tone(2, 0.5)], RATE, 500, 500)).toBeNull();
    expect(measureLoudness([tone(2, 0.5)], RATE, 9 * RATE, 10 * RATE)).toBeNull();
    expect(measureLoudness([], RATE)).toBeNull();
  });

  it("measures a sound shorter than one block as one block", () => {
    expect(measureLoudness([tone(0.1, 0.5)], RATE)!.loudnessDb).toBeCloseTo(-9.03, 0);
  });
});

describe("the volume that levels it", () => {
  it("turns a quiet sound up and a loud one down, to the same loudness", () => {
    expect(levelVolume({ loudnessDb: -32, peak: 0.05 })).toBeCloseTo(3.98, 2); // +12 dB
    expect(levelVolume({ loudnessDb: -26, peak: 0.1 })).toBeCloseTo(2, 2); // +6 dB
    expect(levelVolume({ loudnessDb: -20, peak: 0.3 })).toBe(1);
    expect(levelVolume({ loudnessDb: -8, peak: 0.9 })).toBeCloseTo(0.25, 2); // -12 dB
  });

  it("never turns a sound up so far that its loudest sample would distort", () => {
    // 12 dB short of the target, but a peak at 0.5 leaves room for just under 2×.
    const volume = levelVolume({ loudnessDb: -32, peak: 0.5 });
    expect(volume).toBeCloseTo(fromDb(CEILING_DB) / 0.5, 2);
    expect(volume * 0.5).toBeLessThan(1);
  });

  it("stops at the loudest a clip can be, in whole percents", () => {
    expect(levelVolume({ loudnessDb: -60, peak: 0.001 })).toBe(4);
    const volume = levelVolume({ loudnessDb: -23.7, peak: 0.1 });
    expect(Math.round(volume * 100) / 100).toBe(volume);
  });

  it("says how far a volume moves the sound", () => {
    expect([gainLabel(1), gainLabel(2), gainLabel(0.5), gainLabel(4), gainLabel(0)]).toEqual(["+0.0 dB", "+6.0 dB", "-6.0 dB", "+12.0 dB", "silent"]);
  });
});
