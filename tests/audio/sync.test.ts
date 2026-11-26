import { describe, expect, it } from "vitest";
import { ENVELOPE_RATE, isSure, matchSound, onsets } from "@/lib/audio/sync";

const RATE = 8000;
// A seeded stream of numbers from 0 to 1, so every run hears the same thing.
function random(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// What happened in the room: quiet, with short bursts of noise (words, claps) at uneven moments.
function take(seconds: number, seed: number): Float32Array {
  const next = random(seed);
  const out = new Float32Array(seconds * RATE);
  for (let at = 0; at < out.length; ) {
    at += Math.floor((0.1 + next() * 0.6) * RATE);
    const length = Math.floor((0.03 + next() * 0.15) * RATE);
    const loud = 0.2 + next() * 0.8;
    for (let i = at; i < Math.min(out.length, at + length); i++) out[i] = loud * (next() * 2 - 1);
    at += length;
  }
  return out;
}
// A microphone's recording of part of it: from `from` seconds for `seconds`, at its own level, with its own hiss.
function recording(room: Float32Array, from: number, seconds: number, gain: number, hiss: number, seed: number): Float32Array {
  const next = random(seed);
  return Float32Array.from({ length: seconds * RATE }, (_, i) => gain * (room[from * RATE + i] ?? 0) + hiss * (next() * 2 - 1));
}
const heard = (sound: Float32Array) => onsets([sound], RATE, 0, sound.length);

describe("where the sounds begin", () => {
  it("is a step every five thousandths of a second, with a mark only where the sound gets louder", () => {
    const sound = new Float32Array(RATE); // a second: quiet, a burst from 0.5 s to 0.6 s, quiet
    for (let i = RATE / 2; i < RATE * 0.6; i++) sound[i] = 0.5;
    const steps = heard(sound);
    expect(steps.length).toBe(ENVELOPE_RATE);
    const marked = [...steps].map((v, i) => (v > 0.01 ? i : -1)).filter((i) => i >= 0);
    expect(marked).toEqual([100]); // its start, and nothing for its end or its middle
  });
  it("has the same shape for a loud close microphone and a quiet far one", () => {
    const room = take(4, 1);
    const close = heard(room);
    const far = heard(room.map((v) => v * 0.05));
    let off = 0;
    for (let i = 0; i < close.length; i++) off = Math.max(off, Math.abs(close[i] - far[i]));
    expect(off).toBeLessThan(0.001);
    expect(Math.max(...close)).toBeGreaterThan(5);
  });
  it("takes only the part of the file asked for, and all the file's sides", () => {
    const room = take(4, 2);
    expect(onsets([room], RATE, RATE, 3 * RATE).length).toBe(2 * ENVELOPE_RATE);
    expect(onsets([room], RATE, 3 * RATE, 99 * RATE).length).toBe(ENVELOPE_RATE);
    expect(onsets([], RATE, 0, RATE).length).toBe(0);
    const silentSide = new Float32Array(room.length);
    expect(matchSound(heard(room), onsets([room, silentSide], RATE, 0, room.length))).toMatchObject({ seconds: 0 });
  });
});

describe("lining two recordings up", () => {
  const room = take(30, 7);
  it("finds how much later the second one started, to within a hundredth of a second", () => {
    // The camera ran from 2 s to 14 s; the microphone, quieter and hissing, from 5 s to 17 s.
    const camera = heard(recording(room, 2, 12, 1, 0.002, 11));
    const microphone = heard(recording(room, 5, 12, 0.2, 0.004, 12));
    const match = matchSound(camera, microphone)!;
    expect(match.seconds).toBeCloseTo(3, 2);
    expect(match.score).toBeGreaterThan(0.5);
    expect(match.overlap).toBeCloseTo(9, 1); // the nine seconds both recorded
    expect(isSure(match)).toBe(true);
  });
  it("finds one that started earlier, and a short one inside a long one", () => {
    const camera = heard(recording(room, 6, 10, 1, 0.002, 21));
    const early = matchSound(camera, heard(recording(room, 1.5, 12, 0.5, 0.002, 22)))!;
    expect(early.seconds).toBeCloseTo(-4.5, 2);
    const short = matchSound(heard(recording(room, 0, 25, 1, 0.002, 23)), heard(recording(room, 17.25, 5, 0.7, 0.002, 24)))!;
    expect(short.seconds).toBeCloseTo(17.25, 2);
    expect(short.score).toBeGreaterThan(0.5);
    expect([isSure(early), isSure(short)]).toEqual([true, true]);
  });
  it("is not sure of recordings of different moments, of any length, though each pair has a best place", () => {
    for (const [seconds, seed] of [[3, 99], [3, 150], [6, 100], [6, 151], [12, 101], [12, 152], [25, 102]]) {
      const other = take(30, seed);
      const match = matchSound(heard(recording(room, 2, seconds, 1, 0.002, seed + 1)), heard(recording(other, 2, seconds + 2, 1, 0.002, seed + 2)))!;
      expect(isSure(match)).toBe(false);
    }
    const silent = matchSound(heard(recording(room, 2, 12, 1, 0, 33)), heard(new Float32Array(12 * RATE)))!;
    expect([silent.score, isSure(silent)]).toEqual([0, false]);
  });
  it("is sure of the same moment from six seconds up, whatever it sounds like, and never of under four seconds", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const moment = take(40, seed * 13);
      const match = matchSound(heard(recording(moment, 5, 6, 1, 0.002, seed)), heard(recording(moment, 6.5, 8, 0.2, 0.01, seed + 50)))!;
      expect(match.seconds).toBeCloseTo(1.5, 2);
      expect(isSure(match)).toBe(true);
    }
    // The very same three seconds, twice: as alike as can be, and still too little to act on.
    const brief = matchSound(heard(recording(room, 4, 3, 1, 0, 60)), heard(recording(room, 4, 3, 1, 0, 61)))!;
    expect([brief.seconds, brief.score > 0.9, brief.overlap, isSure(brief)]).toEqual([0, true, 3, false]);
  });
  it("has nothing to say about less than a second of sound", () => {
    expect(matchSound(heard(recording(room, 2, 12, 1, 0, 41)), heard(new Float32Array(RATE / 2)))).toBeNull();
    expect(matchSound(new Float32Array(0), new Float32Array(0))).toBeNull();
  });
});
