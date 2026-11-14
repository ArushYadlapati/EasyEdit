import { describe, expect, it } from "vitest";
import { downmixInto } from "@/lib/export/downmix";

// One frame of the given channel values, written at index 1 of two three-sample planes filled with 9.
function mixed(values: number[]) {
  const left = new Float32Array(3).fill(9);
  const right = new Float32Array(3).fill(9);
  downmixInto(values.map((v) => Float32Array.of(v)), 1, left, right, 1);
  return { left: [...left], right: [...right] };
}

describe("folding any channel count to stereo", () => {
  it("plays mono on both sides, and passes stereo through", () => {
    expect(mixed([0.25])).toEqual({ left: [9, 0.25, 9], right: [9, 0.25, 9] });
    expect(mixed([0.25, -0.5])).toEqual({ left: [9, 0.25, 9], right: [9, -0.5, 9] });
  });

  it("folds quad: half of the front and the surround on each side", () => {
    const { left, right } = mixed([0.1, 0.2, 0.3, 0.4]);
    expect([left[1], right[1]].map((v) => +v.toFixed(6))).toEqual([0.2, 0.3]);
  });

  it("folds 5.1 by the speaker rules: centre and surround at √½, the LFE dropped, nothing normalised", () => {
    const { left, right } = mixed([0.1, 0.2, 0.3, 0.9, 0.4, 0.5]);
    expect(left[1]).toBeCloseTo(0.1 + Math.SQRT1_2 * (0.3 + 0.4), 6);
    expect(right[1]).toBeCloseTo(0.2 + Math.SQRT1_2 * (0.3 + 0.5), 6);
  });

  it("takes the first two channels of any other count", () => {
    expect(mixed([0.25, -0.5, 0.75])).toEqual({ left: [9, 0.25, 9], right: [9, -0.5, 9] });
    expect(mixed([0.25, -0.5, 1, 1, 1, 1, 1, 1])).toEqual({ left: [9, 0.25, 9], right: [9, -0.5, 9] });
  });
});
