import { describe, expect, it } from "vitest";
import { PEAKS_PER_SECOND, peaksOf, waveColumns } from "@/lib/audio/peaks";

// One second at 100 samples a second: silent, then full scale, then half, then silent again.
const side = Float32Array.from({ length: 100 }, (_, i) => (i < 25 ? 0 : i < 50 ? (i % 2 ? 1 : -1) : i < 75 ? 0.5 : 0));

describe("a sound's peaks", () => {
  it("keeps the loudest moment of each stretch, whichever way the wave points", () => {
    const peaks = peaksOf([side], 100, 4);
    expect(peaks.perSecond).toBe(4);
    expect([...peaks.values]).toEqual([0, 255, 128, 0]);
    expect(PEAKS_PER_SECOND).toBe(50);
  });
  it("takes the louder side, and sides of different lengths", () => {
    const quiet = new Float32Array(50).fill(0.25);
    expect([...peaksOf([quiet, side], 100, 4).values]).toEqual([64, 255, 128, 0]);
    expect([...peaksOf([], 100, 4).values]).toEqual([]);
  });
  it("counts a last stretch that is not whole, and clips what is past full scale", () => {
    expect([...peaksOf([Float32Array.of(0, 0, 0, 2)], 3, 1).values]).toEqual([0, 255]);
  });
});

describe("the bars drawn for a clip", () => {
  const peaks = { perSecond: 4, values: Uint8Array.of(0, 255, 64, 0) };
  it("are the loudest stretch under each bar, on a square-root scale", () => {
    expect(waveColumns(peaks, 0, 1, 4)).toEqual([0, 1, Math.sqrt(64 / 255), 0]);
    expect(waveColumns(peaks, 0, 1, 2)).toEqual([1, Math.sqrt(64 / 255)]);
  });
  it("show only the part of the file the clip plays", () => {
    expect(waveColumns(peaks, 0.25, 0.5, 1)).toEqual([1]);
    expect(waveColumns(peaks, 0.5, 1, 2)).toEqual([Math.sqrt(64 / 255), 0]);
  });
  it("read backward for a clip that plays backward", () => {
    expect(waveColumns(peaks, 1, 0, 4)).toEqual([0, Math.sqrt(64 / 255), 1, 0]);
  });
  it("are silent outside the file, and each bar covers at least one stretch", () => {
    expect(waveColumns(peaks, 2, 3, 2)).toEqual([0, 0]);
    expect(waveColumns(peaks, 0.25, 0.5, 4)).toEqual([1, 1, 1, 1]);
    expect(waveColumns(peaks, 0, 1, 0)).toEqual([]);
  });
});
