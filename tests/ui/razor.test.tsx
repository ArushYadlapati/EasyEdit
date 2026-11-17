// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { findClip } from "@/lib/editor/store";
import { act, fireEvent } from "../helpers/dom";
import { makeStore, sampleDoc, text } from "../editor/fixtures";
import { installTimelineStubs, renderTimeline, x, y } from "../helpers/timeline-harness";

installTimelineStubs();

const T1 = y(1);

// t1 holds x9 10-40 alone, with the playhead far away at 100.
function open(tool: "razor" | "select" = "razor") {
  const doc = sampleDoc();
  doc.tracks[1].clips = [text("x9", 10, 30)];
  const shown = renderTimeline(makeStore({ doc }));
  act(() => {
    shown.st().seek(100);
    shown.st().setTool(tool);
  });
  return shown;
}

it("the Razor cuts a clip where it is pressed, without selecting or moving it", () => {
  const { clip, press, release, st } = open();
  press(clip("x9"), x(25), T1);
  release(x(25), T1);
  expect(st().queue.map((e) => e.label)).toEqual(["split"]);
  expect(findClip(st().doc, "x9")!.clip).toMatchObject({ start: 10, duration: 15 });
  expect(st().selection.clipIds).toEqual([]);
});

it("the Razor shows where it would cut", () => {
  const { clip } = open();
  fireEvent.pointerMove(clip("x9"), { clientX: x(20), clientY: T1, pointerId: 1 });
  const line = clip("x9").querySelector<HTMLElement>("[data-razor-line]");
  expect(line?.style.left).toBe(`${(20 - 10) * 2}px`);
  expect(clip("x9").className).toMatch(/\bcursor-crosshair\b/);
});

it("a press on the clip's first frame cuts nothing and says nothing", () => {
  const { clip, press, release, st } = open();
  press(clip("x9"), x(10), T1);
  release(x(10), T1);
  expect(st().queue).toEqual([]);
  expect(st().notice).toBeNull();
});

it("with Selection a press still selects", () => {
  const { clip, press, release, st } = open("select");
  press(clip("x9"), x(25), T1);
  release(x(25), T1);
  expect(st().queue).toEqual([]);
  expect(st().selection.clipIds).toEqual(["x9"]);
});

it("a double-click with the Razor doesn't open the text for typing", () => {
  const { clip, st } = open();
  fireEvent.doubleClick(clip("x9"), { clientX: x(25), clientY: T1 });
  expect(st().textEditId).toBeNull();
  act(() => st().setTool("select"));
  fireEvent.doubleClick(clip("x9"), { clientX: x(25), clientY: T1 });
  expect(st().textEditId).toBe("x9");
});
