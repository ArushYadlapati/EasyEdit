import { describe, expect, it } from "vitest";
import { EDGE_RAMP_SAMPLES, applyGain, edgeGain, mixParts } from "@/lib/export/mix";

const part = (at: number, left: number[], right: number[]) => ({ at, left: Float32Array.from(left), right: Float32Array.from(right) });
const rounded = (x: Float32Array) => [...x].map((v) => +v.toFixed(6));

describe("edges, gain and the sum", () => {
  it("ramps a voice in and out over 4 ms with a raised cosine", () => {
    expect(EDGE_RAMP_SAMPLES).toBe(192);
    const n = 48_000;
    expect([edgeGain(0, n), edgeGain(192, n), edgeGain(n - 1, n), edgeGain(n - 193, n)]).toEqual([0, 1, 0, 1]);
    expect(edgeGain(96, n)).toBeCloseTo(0.5, 12);
    expect(edgeGain(n - 97, n)).toBeCloseTo(0.5, 12);
    expect(edgeGain(191, n)).toBeGreaterThan(0.9999);
    for (let i = 1; i <= 192; i++) expect(edgeGain(i, n)).toBeGreaterThan(edgeGain(i - 1, n));
  });

  it("ramps a short voice over half its length each way, and a one-sample voice not at all", () => {
    expect(edgeGain(25, 100)).toBeCloseTo(0.5, 12);
    expect(edgeGain(74, 100)).toBeCloseTo(0.5, 12);
    expect([edgeGain(0, 100), edgeGain(99, 100), edgeGain(0, 1)]).toEqual([0, 0, 1]);
  });

  it("applies the voice's gain and its ramps where the part sits in the voice", () => {
    const p = { at: 0, left: new Float32Array(400).fill(0.8), right: new Float32Array(400).fill(-0.8) };
    applyGain(p, 0.5, 47_600, 48_000); // the voice's last 400 samples
    expect(p.left[0]).toBeCloseTo(0.4, 6);
    expect(p.left[399]).toBe(0);
    expect(p.right[300]).toBeCloseTo(-0.4 * edgeGain(47_900, 48_000), 6);
  });

  it("sums parts where they sit, clamps at ±1 and interleaves left and right", () => {
    const out = mixParts(4, [part(0, [0.7, 0.7, 0.25], [0, -0.7, -0.7]), part(1, [0.7, 0.1, 0.1], [-0.7, -0.1, 0.2])]);
    expect(rounded(out)).toEqual([0.7, 0, 1, -1, 0.35, -0.8, 0.1, 0.2]);
  });

  it("sums in the order given, so the same parts make the same file every time", () => {
    const tiny = 2 ** -25; // half a step of a float at 0.5: added to 0.5 alone it rounds away, added to its twin first it does not
    const parts = [part(0, [0.5], [0]), part(0, [tiny], [0]), part(0, [tiny], [0])];
    expect(mixParts(1, parts)[0]).toBe(0.5);
    expect(mixParts(1, [...parts].reverse())[0]).toBe(0.5 + 2 ** -24);
  });

  it("turns a sample that is not a number into silence, and clamps the infinities", () => {
    expect([...mixParts(3, [part(0, [Number.NaN, Infinity, -Infinity], [0, 0, 0])])]).toEqual([0, 0, 1, 0, -1, 0]);
  });

  it("gives silence for a block no voice reaches, in a fresh array each time", () => {
    const a = mixParts(3, []);
    expect([...a]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(mixParts(3, [])).not.toBe(a);
  });
});
