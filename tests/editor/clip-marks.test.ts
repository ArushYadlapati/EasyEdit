import { expect, it } from "vitest";
import { clipMarks } from "@/lib/editor/clip-marks";
import { text, video } from "./fixtures";

it("merges keyframe frames across properties, drops those outside the clip, and sorts", () => {
  const clip = video("c", 0, 30, {
    keyframes: {
      x: [{ at: -5, value: 0 }, { at: 20, value: 1 }, { at: 40, value: 2 }],
      scale: [{ at: 0, value: 1 }, { at: 20, value: 2 }],
      opacity: [{ at: 29, value: 1 }, { at: 30, value: 0 }],
    },
  });
  expect(clipMarks(clip).keyframes).toEqual([0, 20, 29]);
});

it("reports no marks for a plain clip", () => {
  expect(clipMarks(video("c", 0, 30))).toEqual({ keyframes: [], inFrames: 0, outFrames: 0 });
});

it("reports transition windows for media and animation windows for text, cut to fit", () => {
  expect(clipMarks(video("c", 0, 60, { transitionIn: { kind: "fade", frames: 10 } }))).toMatchObject({ inFrames: 10, outFrames: 0 });
  expect(clipMarks(text("t", 0, 20, { animationIn: { kind: "fade", frames: 30 }, animationOut: { kind: "fade", frames: 30 } }))).toMatchObject({
    inFrames: 10,
    outFrames: 10,
  });
});
