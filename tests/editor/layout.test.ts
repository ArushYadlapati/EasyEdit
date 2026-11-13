import { expect, it, vi } from "vitest";
import {
  DEFAULT_LAYOUT,
  createLayoutStore,
  defaultTimelineHeight,
  fitLayout,
  formatLayout,
  layoutStyle,
  parseLayout,
  sizeBounds,
} from "@/lib/editor/layout";

const WINDOW = { width: 1024, height: 768 };

it("fits the default layout to a 1024 × 768 window", () => {
  expect(defaultTimelineHeight(768)).toBe(276);
  expect(fitLayout(DEFAULT_LAYOUT, WINDOW)).toEqual({ left: 240, right: 280, timeline: 276 });
});

it("follows the CSS default for the timeline's height: 36% of the window, from 220 to 360 px", () => {
  expect(defaultTimelineHeight(500)).toBe(220);
  expect(defaultTimelineHeight(1200)).toBe(360);
});

it("shrinks the right panel first when the window is narrow", () => {
  expect(fitLayout({ left: 480, right: 480, timeline: null }, WINDOW)).toEqual({ left: 302, right: 240, timeline: 276 });
});

it("keeps the preview at least 200 px tall", () => {
  expect(fitLayout({ left: 240, right: 280, timeline: 900 }, { width: 1024, height: 600 }).timeline).toBe(354);
  expect(fitLayout({ left: 240, right: 280, timeline: 900 }, { width: 1024, height: 300 }).timeline).toBe(160);
});

it("without a window only the fixed bounds apply", () => {
  expect(fitLayout({ left: 100, right: 900, timeline: null }, null)).toEqual({ left: 200, right: 480, timeline: null });
  expect(fitLayout({ left: 240, right: 280, timeline: 2000 }, null).timeline).toBe(1200);
});

it("fitting keeps whole pixels and never changes the wanted sizes", () => {
  const wanted = { left: 300.6, right: 260.2, timeline: 400.5 };
  expect(fitLayout(wanted, { width: 1600, height: 768 })).toEqual({ left: 301, right: 260, timeline: 401 });
  expect(wanted).toEqual({ left: 300.6, right: 260.2, timeline: 400.5 });
});

it("each edge's bounds leave the preview 480 px wide and 200 px tall", () => {
  const shown = { left: 240, right: 280, timeline: 276 };
  expect(sizeBounds("left", shown, WINDOW)).toEqual({ min: 200, max: 262 });
  expect(sizeBounds("right", shown, WINDOW)).toEqual({ min: 240, max: 302 });
  expect(sizeBounds("timeline", shown, WINDOW)).toEqual({ min: 160, max: 522 });
  expect(sizeBounds("left", shown, { width: 1600, height: 768 })).toEqual({ min: 200, max: 480 });
  // A window too small for every minimum: the max is never below the min.
  expect(sizeBounds("left", { left: 200, right: 480, timeline: 160 }, { width: 900, height: 300 })).toEqual({ min: 200, max: 200 });
  expect(sizeBounds("timeline", shown, { width: 1024, height: 300 })).toEqual({ min: 160, max: 160 });
  expect(sizeBounds("right", shown, null)).toEqual({ min: 240, max: 480 });
  expect(sizeBounds("timeline", shown, null)).toEqual({ min: 160, max: 1200 });
});

it("reads and writes the cookie text", () => {
  expect(formatLayout({ left: 260, right: 300, timeline: null })).toBe("260_300_");
  expect(formatLayout({ left: 260, right: 300, timeline: 420 })).toBe("260_300_420");
  expect(parseLayout("260_300_420")).toEqual({ left: 260, right: 300, timeline: 420 });
  expect(parseLayout("260_300_")).toEqual({ left: 260, right: 300, timeline: null });
  expect(parseLayout("100_900_50")).toEqual({ left: 200, right: 480, timeline: 160 });
  for (const bad of ["abc", "-1_2_3", "12345_1_1", undefined, null, ""]) expect(parseLayout(bad), String(bad)).toEqual(DEFAULT_LAYOUT);
});

it("the style sets the three sizes, and leaves the timeline to the CSS default while it has none", () => {
  expect(layoutStyle({ left: 260, right: 300, timeline: 420 })).toEqual({ "--ed-left-w": "260px", "--ed-right-w": "300px", "--ed-timeline-h": "420px" });
  expect(layoutStyle({ left: 260, right: 300, timeline: null })).toEqual({ "--ed-left-w": "260px", "--ed-right-w": "300px" });
});

it("the store clamps while dragging and saves once on commit", () => {
  const save = vi.fn();
  const layout = createLayoutStore(DEFAULT_LAYOUT, save);
  layout.getState().setWindow(WINDOW);
  layout.getState().resize("left", 1000);
  expect(layout.getState().wanted.left).toBe(262);
  expect(save).not.toHaveBeenCalled();
  layout.getState().commit();
  layout.getState().commit();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith({ left: 262, right: 280, timeline: null });
  layout.getState().reset("left");
  expect(save).toHaveBeenLastCalledWith({ left: 240, right: 280, timeline: null });
});

it("a resize rounds and stays within the bounds, and the timeline gets a size of its own", () => {
  const save = vi.fn();
  const layout = createLayoutStore(DEFAULT_LAYOUT, save);
  layout.getState().setWindow(WINDOW);
  layout.getState().resize("right", 100);
  layout.getState().resize("timeline", 300.4);
  expect(layout.getState().wanted).toEqual({ left: 240, right: 240, timeline: 300 });
  layout.getState().resize("timeline", 5000);
  expect(layout.getState().wanted.timeline).toBe(522);
});

it("reset with no panel puts every size back and saves", () => {
  const save = vi.fn();
  const layout = createLayoutStore({ left: 300, right: 300, timeline: 300 }, save);
  layout.getState().reset();
  expect(layout.getState().wanted).toEqual(DEFAULT_LAYOUT);
  expect(save).toHaveBeenCalledWith(DEFAULT_LAYOUT);
  layout.getState().reset("timeline");
  expect(save).toHaveBeenCalledTimes(2);
});

it("a resize back to the saved size saves nothing on commit", () => {
  const save = vi.fn();
  const layout = createLayoutStore(DEFAULT_LAYOUT, save);
  layout.getState().setWindow(WINDOW);
  layout.getState().resize("left", 260);
  layout.getState().resize("left", 240);
  layout.getState().commit();
  expect(save).not.toHaveBeenCalled();
});

it("a smaller window then a bigger one brings the chosen size back", () => {
  const layout = createLayoutStore({ left: 480, right: 480, timeline: null }, vi.fn());
  const shown = () => fitLayout(layout.getState().wanted, layout.getState().window);
  layout.getState().setWindow(WINDOW);
  expect(shown()).toMatchObject({ left: 302, right: 240 });
  layout.getState().setWindow({ width: 1600, height: 768 });
  expect(shown()).toMatchObject({ left: 480, right: 480 });
  expect(layout.getState().wanted).toEqual({ left: 480, right: 480, timeline: null });
});
