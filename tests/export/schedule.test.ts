import { expect, it } from "vitest";
import { audioBlocks, frameCount, frameTime, isKeyFrame } from "@/lib/export/schedule";
import { createEmptyDoc } from "@/lib/timeline";
import { sampleDoc } from "../editor/fixtures";

it("exports every frame from 0 up to, not including, the project's length", () => {
  expect(frameCount(sampleDoc())).toBe(120);
  expect(frameCount(createEmptyDoc("short_9x16"))).toBe(0);
});

it("times each frame from its number, so no error builds up", () => {
  expect(frameTime(0, 30)).toBe(0);
  expect(frameTime(45, 30)).toBe(1.5);
  expect(frameTime(1, 30)).toBe(1 / 30);
  for (const n of [1, 29, 31, 1_799, 107_999, 108_000]) expect(Math.round(frameTime(n, 30) * 30)).toBe(n);
  // in microseconds, as the encoder sees them: always rising, never more than half a microsecond off
  let previous = -1;
  for (let n = 0; n <= 3_600; n++) {
    const us = Math.round(frameTime(n, 30) * 1e6);
    expect(us).toBeGreaterThan(previous);
    expect(Math.abs(us - (n * 1e6) / 30)).toBeLessThanOrEqual(0.5);
    previous = us;
  }
});

it("asks for a keyframe at frame 0 and every two seconds after", () => {
  const keys = (fps: number, upTo: number) => Array.from({ length: upTo }, (_, n) => n).filter((n) => isKeyFrame(n, fps));
  expect(keys(30, 200)).toEqual([0, 60, 120, 180]);
  expect(keys(60, 250)).toEqual([0, 120, 240]);
});

it("cuts the sound into one block per second of picture, each written before that second's first frame", () => {
  expect(audioBlocks(45, 30, 48_000)).toEqual([
    { beforeFrame: 0, startSample: 0, sampleCount: 48_000 },
    { beforeFrame: 30, startSample: 48_000, sampleCount: 24_000 },
  ]);
  expect(audioBlocks(50, 30, 48_000).map((b) => b.sampleCount)).toEqual([48_000, 32_000]);
  expect(audioBlocks(60, 30, 48_000).map((b) => b.beforeFrame)).toEqual([0, 30]);
  expect(audioBlocks(1, 30, 48_000)).toEqual([{ beforeFrame: 0, startSample: 0, sampleCount: 1_600 }]);
  expect(audioBlocks(0, 30, 48_000)).toEqual([]);
});

it("makes the sound exactly as long as the picture, a part sample rounded up to a whole one", () => {
  const total = (blocks: ReturnType<typeof audioBlocks>) => blocks.reduce((sum, b) => sum + b.sampleCount, 0);
  // 55 frames at 11 fps are 240,000 samples: five whole seconds, with no stray sample after them
  expect(audioBlocks(55, 11, 48_000).map((b) => b.sampleCount)).toEqual([48_000, 48_000, 48_000, 48_000, 48_000]);
  // one frame at 7 fps is 6,857.14… samples
  expect(total(audioBlocks(1, 7, 48_000))).toBe(6_858);
  expect(total(audioBlocks(3_600, 30, 48_000))).toBe(5_760_000);
});
