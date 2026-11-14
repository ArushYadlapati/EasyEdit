import { describe, expect, it } from "vitest";
import { WSOLA, createStretcher } from "@/lib/export/wsola";
import { levelDb, maxDiff, tone, zeroCrossHz } from "./audio-helpers";

// 440 Hz at 0.5 for the first `n` stream samples (all of them by default), silence after; the same on both channels.
const a440 = (n = Infinity) => (_ch: 0 | 1, i: number) => (i >= 0 && i < n ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48_000) : 0);
function stretch(tempo: number, count: number, read = a440(), chunks = [count]) {
  const s = createStretcher(tempo, read);
  const out = { left: new Float32Array(count), right: new Float32Array(count) };
  let at = 0;
  for (const n of chunks) {
    const part = { left: new Float32Array(n), right: new Float32Array(n) };
    s.render(part, n);
    out.left.set(part.left, at);
    out.right.set(part.right, at);
    at += n;
  }
  return out;
}

describe("time-stretching that keeps the pitch", () => {
  it("uses 20 ms frames, half overlapped, searched 10 ms each way", () => {
    expect(WSOLA).toEqual({ frame: 960, hop: 480, search: 480 });
  });

  it("copies at tempo 1, reading each index once", () => {
    let reads = 0;
    const out = stretch(1, 2_000, (ch, i) => { reads += 1; return a440()(ch, i); }, [700, 1_300]);
    for (const i of [1, 699, 700, 1_999]) expect(out.left[i]).toBe(Math.fround(a440()(0, i)));
    expect(reads).toBe(4_000); // any search reads far more
  });

  it.each([0.0625, 0.25, 0.5, 2, 16])("keeps each moment on its time at tempo %s: a bump at input X is centred on output X / tempo", (tempo) => {
    // L = −R, so the mid the search reads is silent, every offset ties at 0, and each frame sits at its nominal place
    const bump = (i: number) => 0.5 * Math.exp(-(((i - 48_000 * tempo) / (4_800 * tempo)) ** 2) / 2);
    const out = stretch(tempo, 96_000, (ch, i) => (ch === 0 ? bump(i) : -bump(i))).left;
    let moment = 0;
    let sum = 0;
    for (let o = 0; o < out.length; o++) { moment += o * out[o]; sum += out[o]; }
    // frames placed at round(k·H·tempo) sit H·(1 − 1/tempo) off: −7,200 at 0.0625, −480 at 0.5, +240 at 2, +450 at 16
    expect(Math.abs(moment / sum - 48_000)).toBeLessThan(20);
  });

  it("places frame k from its index at a tempo that does not divide the hop", () => {
    let hi = -Infinity;
    stretch(1.001, 480_000, (_ch, i) => { hi = Math.max(hi, i); return 0; }); // silence: every offset ties at 0
    // frame 999 is the last one needed, at τ = round(1,000 × 480 × 1.001) − 480 = 480,000; adding round(480.48) per frame gives 479,520
    expect(hi).toBeGreaterThanOrEqual(480_959);
    expect(hi).toBeLessThan(481_440);
  });

  it.each([0.5, 1.5, 2])("keeps a 440 Hz tone at 440 Hz and at its level at tempo %s", (tempo) => {
    const out = stretch(tempo, 48_000);
    expect(Math.abs(zeroCrossHz(out.left, 48_000) - 440)).toBeLessThan(1);
    expect(Math.abs(levelDb(out.left, 2_000, 46_000) - levelDb(tone(440, 48_000, 48_000), 2_000, 46_000))).toBeLessThan(1);
  });

  it("keeps time: two seconds at tempo 2 fill one second, then silence", () => {
    const out = stretch(2, 60_000, a440(96_000));
    expect(Math.abs(levelDb(out.left, 2_000, 46_000) - -9.03)).toBeLessThan(1); // a sine at 0.5 is −9.03 dB
    expect(levelDb(out.left, 50_000, 60_000)).toBeLessThan(-60);
  });

  it("streams: any split of the output gives the same samples", () => {
    expect(maxDiff(stretch(1.5, 49_000).left, stretch(1.5, 49_000, a440(), [1, 999, 47_000, 1_000]).left)).toBeLessThan(1e-6);
  });

  it("moves both channels by one offset, found on their mid", () => {
    const same = stretch(1.5, 24_000);
    expect(same.right).toEqual(same.left);
    // two inputs with the same mid and different sides: one offset from the mid gives the same L + R; a search per channel does not
    const x = (i: number) => 0.4 * Math.sin((2 * Math.PI * 440 * i) / 48_000);
    const y = (i: number) => 0.3 * Math.sin((2 * Math.PI * 1_300 * i) / 48_000);
    const z = (i: number) => 0.3 * Math.sin((2 * Math.PI * 170 * i) / 48_000 + 1);
    const a = stretch(1.5, 24_000, (ch, i) => x(i) + (ch === 0 ? y(i) : -y(i)));
    const b = stretch(1.5, 24_000, (ch, i) => x(i) + (ch === 0 ? z(i) : -z(i)));
    const mid = (o: { left: Float32Array; right: Float32Array }) => o.left.map((v, i) => v + o.right[i]);
    expect(maxDiff(mid(a), mid(b))).toBeLessThan(1e-6);
    expect(maxDiff(a.left, b.left)).toBeGreaterThan(0.1); // the sides really differ
  });

  it.each([0.0625, 16])("at tempo %s writes exactly what is asked and reads only near each frame's place", (tempo) => {
    const out = { left: new Float32Array(4_810).fill(7), right: new Float32Array(4_810).fill(7) };
    let lo = Infinity;
    let hi = -Infinity;
    const s = createStretcher(tempo, (_ch, i) => { lo = Math.min(lo, i); hi = Math.max(hi, i); return 0.1; });
    // frames −1 … 9: from τ_{−1} − S = −960 to τ_9 + S + N = round(4,800 × tempo) + 960
    expect([s.keeps(), s.needs(4_800)]).toEqual([-960, Math.round(4_800 * tempo) + 960]);
    s.render(out, 4_800);
    expect([...out.left.slice(4_800)]).toEqual(Array(10).fill(7));
    expect(lo).toBeGreaterThanOrEqual(-960);
    expect(hi).toBeLessThan(Math.round(4_800 * tempo) + 960);
    expect(s.keeps()).toBe(Math.round(11 * 480 * tempo) - 960); // frame 10 is next: τ_10 − S
  });
});

describe("the stretcher, rule by rule", () => {
  it("overlaps Hann frames that sum to one: a level stays level from the first sample, and a slope has no step", () => {
    // L = −R: every offset ties at 0, so each frame sits at its nominal place and only the tapers shape the output
    const level = stretch(1.5, 9_600, (ch) => (ch === 0 ? 0.25 : -0.25)).left;
    expect(maxDiff(level, new Float32Array(9_600).fill(0.25))).toBeLessThan(1e-6);
    // at tempo 2 neighbouring frames read 480 samples apart: untapered, each frame's edge would step by 480 / 48,000
    const slope = stretch(2, 9_600, (ch, i) => (ch === 0 ? i / 48_000 : -i / 48_000)).left;
    let step = 0;
    for (let o = 1; o < slope.length; o++) step = Math.max(step, Math.abs(slope[o] - slope[o - 1]));
    expect(step).toBeLessThan(1e-4);
  });

  it("continues the frame before exactly where it can: the match is found to the sample, by shape and not by loudness", () => {
    // Frame 0 sits at τ_0 = 722 − 480 = 242; its exact continuation of frame −1 is δ = −242, which the every-4th search
    // misses by 2. A ten times louder stretch after sample 480 would win on its products alone.
    const shape = (i: number) => (Math.sin((2 * Math.PI * 97 * i) / 48_000) + Math.sin((2 * Math.PI * 263 * i) / 48_000 + 1) + Math.sin((2 * Math.PI * 611 * i) / 48_000 + 2)) / 3;
    const x = (i: number) => (i < 480 ? 0.05 : 0.5) * shape(i);
    const out = stretch(1.505, 960, (_ch, i) => x(i)).left;
    expect(maxDiff(out.subarray(0, 480), Float32Array.from({ length: 480 }, (_, i) => x(i)))).toBeLessThan(1e-6);
  });

  it("breaks an exact tie toward the smaller offset, then the earlier one", () => {
    // A square wave of period 80 at tempo 1.25: frame 0's nominal place, 120, is out of phase, and δ = −40 and +40 tie
    // exactly (every product and square is ±0.25). Frame 0 at 80 reads up to 1,039, inside its search's 1,079; at 160 it
    // would read up to 1,119.
    let hi = -Infinity;
    const s = createStretcher(1.25, (_ch, i) => { hi = Math.max(hi, i); return Math.floor(i / 40) % 2 === 0 ? 0.5 : -0.5; });
    s.render({ left: new Float32Array(1), right: new Float32Array(1) }, 1);
    expect(hi).toBe(1_079);
  });
});
