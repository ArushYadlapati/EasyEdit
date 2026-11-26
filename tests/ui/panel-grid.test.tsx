// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { writeLayoutCookie } from "@/components/editor/browser-prefs";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { layoutStyle, type Layout } from "@/lib/editor/layout";
import type { EditorStore } from "@/lib/editor/store";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { happyDOM } from "../helpers/layout";

beforeEach(() => happyDOM().setViewport({ width: 1024, height: 768 }));

function show({ store = makeStore(), initialLayout }: { store?: EditorStore; initialLayout?: Layout } = {}) {
  const saveLayout = vi.fn();
  const { unmount } = render(
    <EditorProvider store={store}>
      <EditorScreen spaceSlug="seattle-solvers" initialLayout={initialLayout} saveLayout={saveLayout} />
    </EditorProvider>,
  );
  const bar = (name: string) => screen.getByRole("separator", { name });
  const grid = bar("Left panel width").parentElement!;
  const size = (name: string) => bar(name).getAttribute("aria-valuenow");
  const variable = (name: string) => grid.style.getPropertyValue(name);
  return { store, saveLayout, bar, grid, size, variable, unmount };
}

it("shows three named separators with their sizes, beside the audio meter's own", () => {
  const { bar, size } = show();
  expect(screen.getAllByRole("separator").map((el) => el.getAttribute("aria-label"))).toEqual([
    "Left panel width", "Right panel width", "Timeline height", "Audio meter width",
  ]);
  // At 1024 px the side panels take their narrowest default widths, and the sample's four tracks fill the timeline's
  // default height.
  expect([size("Left panel width"), size("Right panel width"), size("Timeline height")]).toEqual(["218", "240", "276"]);
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
  expect(size("Left panel width")).toBe("234");
  expect(variable("--ed-left-w")).toBe("234px");
  // Only the size that was chosen is kept; the others go on following the window.
  expect(saveLayout).toHaveBeenCalledWith({ left: 234, right: null, timeline: null });
  expect(store.getState().playhead).toBe(0);
});

it("dragging a separator resizes and saves once", () => {
  const { saveLayout, bar, grid, size } = show();
  const left = bar("Left panel width");
  fireEvent.pointerDown(left, { button: 0, pointerId: 1, clientX: 218 });
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
  fireEvent.pointerDown(left, { button: 2, pointerId: 1, clientX: 218 });
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 300 });
  expect(size("Left panel width")).toBe("218");
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
  expect(saveLayout).toHaveBeenCalledWith({ left: null, right: null, timeline: 336 });
});

it("Escape during a drag puts the size back", () => {
  const store = makeStore();
  store.getState().select(["x1"]);
  const { saveLayout, bar, grid, size } = show({ store });
  const left = bar("Left panel width");
  fireEvent.pointerDown(left, { button: 0, pointerId: 1, clientX: 218 });
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 260 });
  expect(size("Left panel width")).toBe("260");
  expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
  expect(size("Left panel width")).toBe("218");
  expect(grid.dataset.resizing).toBeUndefined();
  expect(left.hasPointerCapture(1)).toBe(false);
  // The drag is over: later moves and the capture's end do nothing.
  fireEvent.pointerMove(left, { pointerId: 1, clientX: 300 });
  fireEvent.lostPointerCapture(left, { pointerId: 1 });
  expect(size("Left panel width")).toBe("218");
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
  // Still the default: a taller window gives it room up to what its four tracks need (277 px), and no more.
  act(() => happyDOM().setViewport({ width: 1024, height: 1000 }));
  expect(size("Timeline height")).toBe("277");
  expect(variable("--ed-timeline-h")).toBe("277px");
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
  expect(size("Left panel width")).toBe("218");
  expect(saveLayout).toHaveBeenCalledWith({ left: null, right: 240, timeline: 400 });
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
  expect(viewer.size("Right panel width")).toBe("256");
  expect(viewer.saveLayout).toHaveBeenCalledWith({ left: null, right: 256, timeline: null });
  viewer.unmount();

  const store = makeStore();
  store.getState().setStatus("deleted");
  render(
    <EditorProvider store={store}>
      <EditorScreen spaceSlug="seattle-solvers" saveLayout={vi.fn()} />
    </EditorProvider>,
  );
  expect(screen.getByText("This project was deleted.")).toBeTruthy();
  expect(screen.queryAllByRole("separator")).toEqual([]);
});

it("a narrow window stacks the same regions, with a switch between the timeline, the add panel and the details", () => {
  const { grid } = show();
  expect(grid.classList.contains("grid")).toBe(true);
  expect(grid.classList.contains("hidden")).toBe(false);
  expect(screen.queryByText("The editor needs a wider window.")).toBeNull();
  const region = (name: string) => screen.getByRole(name === "Timeline" ? "region" : "complementary", { name });
  const shown = () => ["Timeline", "Add", "Details"].map((name) => !region(name).classList.contains("max-lg:hidden"));
  const tab = (name: string) => within(screen.getByRole("navigation", { name: "Show" })).getByRole("button", { name });
  expect(shown()).toEqual([true, false, false]);
  expect(tab("Timeline").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(tab("Details"));
  expect(shown()).toEqual([false, false, true]);
  expect([tab("Timeline"), tab("Details")].map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  fireEvent.click(tab("Add"));
  expect(shown()).toEqual([false, true, false]);
  // The switch, the edges and the phone's rows are for one width or the other, never both.
  expect(screen.getByRole("navigation", { name: "Show" }).className).toContain("lg:hidden");
  for (const edge of ["Left panel width", "Right panel width", "Timeline height"]) expect(screen.getByRole("separator", { name: edge }).className).toContain("max-lg:hidden");
  // Nothing is mounted twice: one preview, one timeline.
  expect(screen.getAllByRole("main")).toHaveLength(1);
});

it("writeLayoutCookie keeps the sizes for editor pages", () => {
  happyDOM().setURL("http://localhost:3000/s/seattle-solvers/editor/p1");
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

it("View → Reset panel sizes puts all three edges back and keeps them, and the audio meter's width with them", () => {
  const { store, saveLayout, size } = show({ initialLayout: { left: 260, right: 250, timeline: 300 } });
  act(() => store.getState().setAudioMeterWidth(140));
  expect([size("Left panel width"), size("Right panel width"), size("Timeline height"), size("Audio meter width")]).toEqual(["260", "250", "300", "140"]);
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset panel sizes" }));
  expect([size("Left panel width"), size("Right panel width"), size("Timeline height"), size("Audio meter width")]).toEqual(["218", "240", "276", "56"]);
  expect(saveLayout).toHaveBeenCalledWith({ left: null, right: null, timeline: null });
  expect(store.getState().audioMeterWidth).toBe(56);
});

it("with no sizes chosen, the side panels follow the window and the timeline its tracks", () => {
  act(() => happyDOM().setViewport({ width: 1440, height: 900 }));
  const { size } = show({ store: makeStore({ doc: { ...sampleDoc(), tracks: sampleDoc().tracks.slice(0, 2) } }) });
  // 15vw + 64 px and 19vw; two tracks, a spare row, the ruler and the control row need 197 px, so the least, 200.
  expect([size("Left panel width"), size("Right panel width"), size("Timeline height")]).toEqual(["280", "274", "200"]);
  act(() => happyDOM().setViewport({ width: 1920, height: 1080 }));
  expect([size("Left panel width"), size("Right panel width")]).toEqual(["300", "320"]);
});

it("a size someone chose wins over the default at every window size", () => {
  const { size } = show({ initialLayout: { left: 230, right: null, timeline: null } });
  act(() => happyDOM().setViewport({ width: 1920, height: 1080 }));
  expect([size("Left panel width"), size("Right panel width")]).toEqual(["230", "320"]);
});

it("before the window is measured the grid's sizes are the stylesheet's defaults", () => {
  expect(layoutStyle({ left: null, right: null, timeline: null }, 3)).toEqual({
    "--ed-left-w": "clamp(200px, calc(15vw + 64px), 300px)",
    "--ed-right-w": "clamp(240px, 19vw, 320px)",
    "--ed-timeline-h": "clamp(200px, 237px, clamp(220px, 36vh, 360px))",
  });
});
