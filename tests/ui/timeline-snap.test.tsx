// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { act } from "../helpers/dom";
import { makeStore, sampleDoc, text } from "../editor/fixtures";
import { installTimelineStubs, renderTimeline, x, y } from "../helpers/timeline-harness";

installTimelineStubs();

const T1 = y(1);

// t1 holds x1 0-60 and x2 100-130, with the playhead on x2's start, as after adding x2 at the playhead.
function open() {
  const doc = sampleDoc();
  doc.tracks[1].clips = [text("x1", 0, 60), text("x2", 100, 30)];
  const shown = renderTimeline(makeStore({ doc }));
  act(() => shown.st().seek(100));
  const guide = () => shown.view.container.querySelector<HTMLElement>("[data-snap-guide]");
  return { ...shown, guide };
}

it("a clip that starts on the playhead moves when dragged a few pixels right", () => {
  const { clip, press, move, release, frame, startOf, shownStart, guide } = open();
  press(clip("x2"), x(110), T1);
  move(x(113), T1);
  frame();
  expect(shownStart("x2")).toBe(103);
  expect(guide()).toBeNull();
  release(x(113), T1);
  expect(startOf("x2")).toBe(103);
});

it("a clip that starts on the playhead moves when dragged a few pixels left", () => {
  const { clip, press, move, release, frame, startOf, guide } = open();
  press(clip("x2"), x(110), T1);
  move(x(107), T1);
  frame();
  expect(guide()).toBeNull();
  release(x(107), T1);
  expect(startOf("x2")).toBe(97);
});

it("a clip dragged toward the playhead snaps onto it, with a guide", () => {
  const { st, clip, press, move, release, frame, startOf, guide } = open();
  act(() => st().seek(106));
  press(clip("x2"), x(110), T1);
  move(x(113), T1);
  frame();
  expect(guide()).not.toBeNull();
  release(x(113), T1);
  expect(startOf("x2")).toBe(106);
});

it("a clip dragged away and back near the playhead it started on lands where it is let go", () => {
  const { clip, press, move, release, frame, startOf, guide } = open();
  press(clip("x2"), x(110), T1);
  move(x(130), T1);
  frame();
  move(x(112), T1); // the start, at 102, is no closer to the playhead than at the press
  frame();
  expect(guide()).toBeNull();
  release(x(112), T1);
  expect(startOf("x2")).toBe(102);
});
