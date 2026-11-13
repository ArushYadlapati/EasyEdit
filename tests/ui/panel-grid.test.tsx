// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { writeLayoutCookie } from "@/components/editor/browser-prefs";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import type { Layout } from "@/lib/editor/layout";
import type { EditorStore } from "@/lib/editor/store";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";
import { happyDOM } from "../helpers/layout";

beforeEach(() => happyDOM().setViewport({ width: 1024, height: 768 }));

function show({ store = makeStore(), initialLayout }: { store?: EditorStore; initialLayout?: Layout } = {}) {
  const saveLayout = vi.fn();
  const { unmount } = render(
    <EditorProvider store={store}>
      <EditorScreen initialLayout={initialLayout} saveLayout={saveLayout} />
    </EditorProvider>,
  );
  const bar = (name: string) => screen.getByRole("separator", { name });
  const grid = bar("Left panel width").parentElement!;
  const size = (name: string) => bar(name).getAttribute("aria-valuenow");
  const variable = (name: string) => grid.style.getPropertyValue(name);
  return { store, saveLayout, bar, grid, size, variable, unmount };
}

it("shows three named separators with their sizes", () => {
  const { bar, size } = show();
  expect(screen.getAllByRole("separator")).toHaveLength(3);
  expect([size("Left panel width"), size("Right panel width"), size("Timeline height")]).toEqual(["240", "280", "276"]);
  expect(bar("Left panel width").getAttribute("aria-orientation")).toBe("vertical");
  expect(bar("Timeline height").getAttribute("aria-orientation")).toBe("horizontal");
  // Each separator names the region it sizes.
  const controlled = (name: string) => document.getElementById(bar(name).getAttribute("aria-controls")!)?.getAttribute("aria-label");
  expect([controlled("Left panel width"), controlled("Right panel width"), controlled("Timeline height")]).toEqual(["Add", "Details", "Timeline"]);
});

it("an arrow key on a separator resizes the panel and does not move the playhead", () => {
  const { store, saveLayout, bar, size, variable } = show();
  bar("Left panel width").focus();
  expect(fireEvent.keyDown(bar("Left panel width"), { key: "ArrowRight" })).toBe(false);
  expect(size("Left panel width")).toBe("256");
  expect(variable("--ed-left-w")).toBe("256px");
  expect(saveLayout).toHaveBeenCalledWith({ left: 256, right: 280, timeline: null });
  expect(store.getState().playhead).toBe(0);
});

it("dragging a separator resizes and saves once", () => {
  const { saveLayout, bar, grid, size } = show();
  const left = bar("Left panel width");
  fireEvent.pointerDown(left, { button: 0, pointerId: 1, clientX: 240 });
  expect(grid.dataset.resizing).toBe("col");
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 260 });
  expect(size("Left panel width")).toBe("260");
  expect(saveLayout).not.toHaveBeenCalled();
  // Another pointer losing its capture leaves this drag running.
  fireEvent.lostPointerCapture(left, { pointerId: 2 });
  expect(grid.dataset.resizing).toBe("col");
  fireEvent.lostPointerCapture(left, { pointerId: 1 });
  expect(size("Left panel width")).toBe("260");
  expect(saveLayout).toHaveBeenCalledTimes(1);
  expect(grid.dataset.resizing).toBeUndefined();
});

it("a press with another button starts no drag", () => {
  const { bar, grid, size } = show();
  const left = bar("Left panel width");
  fireEvent.pointerDown(left, { button: 2, pointerId: 1, clientX: 240 });
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 300 });
  expect(size("Left panel width")).toBe("240");
  expect(grid.dataset.resizing).toBeUndefined();
});

it("dragging the timeline's edge up makes the timeline taller", () => {
  const { saveLayout, bar, grid, size, variable } = show();
  const edge = bar("Timeline height");
  fireEvent.pointerDown(edge, { button: 0, pointerId: 1, clientY: 492 });
  expect(grid.dataset.resizing).toBe("row");
  fireEvent.pointerMove(edge, { pointerId: 1, clientY: 432 });
  fireEvent.lostPointerCapture(edge, { pointerId: 1 });
  expect(size("Timeline height")).toBe("336");
  expect(variable("--ed-timeline-h")).toBe("336px");
  expect(saveLayout).toHaveBeenCalledTimes(1);
  expect(saveLayout).toHaveBeenCalledWith({ left: 240, right: 280, timeline: 336 });
});

it("Escape during a drag puts the size back", () => {
  const store = makeStore();
  store.getState().select(["x1"]);
  const { saveLayout, bar, grid, size } = show({ store });
  const left = bar("Left panel width");
  fireEvent.pointerDown(left, { button: 0, pointerId: 1, clientX: 240 });
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 260 });
  expect(size("Left panel width")).toBe("260");
  expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
  expect(size("Left panel width")).toBe("240");
  expect(grid.dataset.resizing).toBeUndefined();
  expect(left.hasPointerCapture(1)).toBe(false);
  // The drag is over: later moves and the capture's end do nothing.
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 300 });
  fireEvent.lostPointerCapture(left, { pointerId: 1 });
  expect(size("Left panel width")).toBe("240");
  expect(saveLayout).not.toHaveBeenCalled();
  expect(store.getState().selection.clipIds).toEqual(["x1"]);
  // With no drag running, Escape clears the selection as before.
  fireEvent.keyDown(window, { key: "Escape" });
  expect(store.getState().selection.clipIds).toEqual([]);
});

it("Escape on the timeline's edge leaves it following the window height", () => {
  const { saveLayout, bar, size, variable } = show();
  const edge = bar("Timeline height");
  fireEvent.pointerDown(edge, { button: 0, pointerId: 1, clientY: 492 });
  fireEvent.pointerMove(edge, { pointerId: 1, clientY: 432 });
  expect(size("Timeline height")).toBe("336");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(size("Timeline height")).toBe("276");
  expect(saveLayout).not.toHaveBeenCalled();
  // Still the default: a taller window gives a taller timeline.
  act(() => happyDOM().setViewport({ width: 1024, height: 1000 }));
  expect(size("Timeline height")).toBe("360");
  expect(variable("--ed-timeline-h")).toBe("360px");
});

it("Escape in a narrow window puts back the size that was chosen, not the one shown", () => {
  const { saveLayout, bar, size } = show({ initialLayout: { left: 480, right: 480, timeline: null } });
  const left = bar("Left panel width");
  fireEvent.pointerDown(left, { button: 0, pointerId: 1, clientX: 302 });
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 280 });
  expect([size("Left panel width"), size("Right panel width")]).toEqual(["280", "262"]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect([size("Left panel width"), size("Right panel width")]).toEqual(["302", "240"]);
  expect(saveLayout).not.toHaveBeenCalled();
  act(() => happyDOM().setViewport({ width: 1600, height: 768 }));
  expect([size("Left panel width"), size("Right panel width")]).toEqual(["480", "480"]);
});

it("a double-click puts the default size back", () => {
  const { saveLayout, bar, size } = show({ initialLayout: { left: 300, right: 240, timeline: 400 } });
  fireEvent.doubleClick(bar("Left panel width"));
  expect(size("Left panel width")).toBe("240");
  expect(saveLayout).toHaveBeenCalledWith({ left: 240, right: 240, timeline: 400 });
});

it("starts from the saved sizes", () => {
  const { variable } = show({ initialLayout: { left: 300, right: 240, timeline: 400 } });
  expect(variable("--ed-left-w")).toBe("300px");
  expect(variable("--ed-right-w")).toBe("240px");
  expect(variable("--ed-timeline-h")).toBe("400px");
});

it("a narrower window gives way and a wider one brings the size back", () => {
  const { size } = show({ initialLayout: { left: 480, right: 480, timeline: null } });
  expect([size("Left panel width"), size("Right panel width")]).toEqual(["302", "240"]);
  act(() => happyDOM().setViewport({ width: 1600, height: 768 }));
  expect([size("Left panel width"), size("Right panel width")]).toEqual(["480", "480"]);
});

it("a viewer can resize, and a deleted project has no separators.", () => {
  const viewer = show({ store: makeStore({ canEdit: false }) });
  expect(fireEvent.keyDown(viewer.bar("Right panel width"), { key: "ArrowLeft" })).toBe(false);
  expect(viewer.size("Right panel width")).toBe("296");
  expect(viewer.saveLayout).toHaveBeenCalledWith({ left: 240, right: 296, timeline: null });
  viewer.unmount();

  const store = makeStore();
  store.getState().setStatus("deleted");
  render(
    <EditorProvider store={store}>
      <EditorScreen saveLayout={vi.fn()} />
    </EditorProvider>,
  );
  expect(screen.getByText("This project was deleted.")).toBeTruthy();
  expect(screen.queryAllByRole("separator")).toEqual([]);
});

it("a narrow window still gets its message", () => {
  const { grid } = show();
  expect(grid.classList.contains("hidden")).toBe(true);
  expect(grid.classList.contains("lg:grid")).toBe(true);
  expect(screen.getByText("The editor needs a wider window.")).toBeTruthy();
});

it("writeLayoutCookie keeps the sizes for editor pages", () => {
  happyDOM().setURL("http://localhost:3000/editor/p1");
  writeLayoutCookie({ left: 260, right: 300, timeline: null });
  expect(document.cookie).toContain("easyedit-layout=260_300_");
  // Other pages, and the API under them, do not get it.
  happyDOM().setURL("http://localhost:3000/dashboard");
  expect(document.cookie).not.toContain("easyedit-layout");
  // A browser that refuses the cookie changes nothing on the page.
  const refused = vi.spyOn(document, "cookie", "set").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => writeLayoutCookie({ left: 300, right: 300, timeline: 300 })).not.toThrow();
  expect(refused).toHaveBeenCalledTimes(1);
  refused.mockRestore();
});

it("View → Reset panel sizes puts all three edges back and keeps them", () => {
  const { saveLayout, size } = show({ initialLayout: { left: 260, right: 250, timeline: 300 } });
  expect([size("Left panel width"), size("Right panel width"), size("Timeline height")]).toEqual(["260", "250", "300"]);
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset panel sizes" }));
  expect([size("Left panel width"), size("Right panel width"), size("Timeline height")]).toEqual(["240", "280", "276"]);
  expect(saveLayout).toHaveBeenCalledWith({ left: 240, right: 280, timeline: null });
});
