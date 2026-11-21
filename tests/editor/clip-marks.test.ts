import { expect, it } from "vitest";
import { clipMarks } from "@/lib/editor/clip-marks";
import type { Clip, Track } from "@/lib/timeline";
import { text, video } from "./fixtures";

const track = (...clips: Clip[]): Track => ({ id: "v1", kind: "video", name: "Video 1", muted: false, hidden: false, locked: false, clips });
const alone = (clip: Clip) => clipMarks(track(clip), clip);

it("merges keyframe frames across properties, drops those outside the clip, and sorts", () => {
  const clip = video("c", 0, 30, {
    keyframes: {
      x: [{ at: -5, value: 0 }, { at: 20, value: 1 }, { at: 40, value: 2 }],
      scale: [{ at: 0, value: 1 }, { at: 20, value: 2 }],
      opacity: [{ at: 29, value: 1 }, { at: 30, value: 0 }],
    },
  });
  expect(alone(clip).keyframes).toEqual([0, 20, 29]);
});

it("reports no marks for a plain clip", () => {
  expect(alone(video("c", 0, 30))).toEqual({ keyframes: [], inFrames: 0, outFrames: 0, fadeIn: 0, fadeOut: 0, volume: null });
});

it("reports a sounding clip's fades as heard, and its volume when it is not as recorded", () => {
  expect(alone(video("c", 0, 30, { fadeIn: 10, fadeOut: 5, volume: 1.5 }))).toMatchObject({ fadeIn: 10, fadeOut: 5, volume: 1.5 });
  // The fade in comes first, and the fade out gets what is left of the clip.
  expect(alone(video("c", 0, 30, { fadeIn: 25, fadeOut: 20, volume: 0 }))).toMatchObject({ fadeIn: 25, fadeOut: 5, volume: 0 });
  expect(alone(video("c", 0, 30, { type: "audio", fadeOut: 40 }))).toMatchObject({ fadeIn: 0, fadeOut: 30, volume: null });
  // A picture and a text have no sound, whatever their volume field says.
  expect(alone(video("c", 0, 30, { type: "image", volume: 0.5 }))).toMatchObject({ fadeIn: 0, fadeOut: 0, volume: null });
  expect(alone(text("t", 0, 30))).toMatchObject({ fadeIn: 0, fadeOut: 0, volume: null });
});

it("reports transition windows for media and animation windows for text, cut to fit", () => {
  expect(alone(video("c", 0, 60, { transitionIn: { kind: "fade", frames: 10 } }))).toMatchObject({ inFrames: 10, outFrames: 0 });
  expect(alone(text("t", 0, 20, { animationIn: { kind: "fade", frames: 30 }, animationOut: { kind: "fade", frames: 30 } }))).toMatchObject({
    inFrames: 10,
    outFrames: 10,
  });
});

it("shows no out window on a clip the next one crossfades in from, since the crossfade owns the cut", () => {
  const a = video("A", 0, 30, { transitionOut: { kind: "fade", frames: 10 } });
  const b = video("B", 30, 30, { transitionIn: { kind: "crossfade", frames: 10 } });
  expect(clipMarks(track(a, b), a)).toMatchObject({ inFrames: 0, outFrames: 0 });
  expect(clipMarks(track(a, b), b)).toMatchObject({ inFrames: 10, outFrames: 0 });
  // With no crossfade after it, A's fade out shows.
  expect(clipMarks(track(a), a)).toMatchObject({ outFrames: 10 });
});

it("marks an empty slot's keyframes and transitions too, since the clip that fills it keeps them", () => {
  const slot = {
    id: "s",
    type: "placeholder",
    start: 0,
    duration: 30,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, fit: "cover" },
    accepts: "visual",
    slot: { name: "hero_clip" },
    transitionIn: { kind: "fade", frames: 10 },
    transitionOut: { kind: "dip", frames: 5 },
    keyframes: { x: [{ at: 3, value: 0 }, { at: 12, value: 1 }] },
  } as Clip;
  expect(alone(slot)).toEqual({ keyframes: [3, 12], inFrames: 10, outFrames: 5, fadeIn: 0, fadeOut: 0, volume: null });
});
