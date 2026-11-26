// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EffectsPanel } from "@/components/editor/effects-panel";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider } from "@/components/editor/media/media-context";
import { findClip, type EditorStore } from "@/lib/editor/store";
import type { Clip } from "@/lib/timeline";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { assetView, pretendMediaServices } from "../helpers/media-services";

function storeWith(extra: Record<string, unknown>, canEdit = true): EditorStore {
  const doc = sampleDoc();
  doc.tracks[0].clips = doc.tracks[0].clips.map((c) => (c.id === "c1" ? ({ ...c, ...extra } as Clip) : c));
  const store = makeStore({ doc, canEdit });
  store.getState().select(["c1"]);
  return store;
}
const first = (store: EditorStore, prop = "scale") => (findClip(store.getState().doc, "c1")!.clip.keyframes as Record<string, { curve?: number[]; ease?: string }[]>)[prop][0];
const SCALE = { scale: [{ at: 0, value: 1 }, { at: 60, value: 1.5 }] };
// The curve's drawing, 200 px wide and 200 tall at the page's corner: half the height is the box, a quarter above
// and below is room to overshoot.
function boxed<T extends Element>(el: T): T {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

it("Custom curve in the Ease menu gives the keyframe a curve to shape, and a named ease takes it off", () => {
  const store = storeWith({ keyframes: SCALE });
  render(<EditorProvider store={store}><EffectsPanel /></EditorProvider>);
  const row = screen.getByRole("group", { name: "Scale keyframe at 0.00s" });
  expect(within(row).queryByRole("group", { name: "Ease curve" })).toBeNull();
  fireEvent.change(within(row).getByLabelText("Ease"), { target: { value: "custom" } });
  expect(first(store).curve).toEqual([0.4, 0, 0.2, 1]);
  expect((within(row).getByLabelText("Ease") as HTMLSelectElement).value).toBe("custom");
  expect(within(row).getByRole("group", { name: "Ease curve" })).toBeTruthy();
  fireEvent.change(within(row).getByLabelText("Ease"), { target: { value: "ease_out" } });
  expect(first(store)).toEqual({ at: 0, value: 1, ease: "ease_out" });
  expect(within(row).queryByRole("group", { name: "Ease curve" })).toBeNull();
});

it("dragging a handle shows the curve as it goes and saves one change; the arrow keys nudge it", () => {
  const store = storeWith({ keyframes: { scale: [{ at: 0, value: 1, curve: [0.4, 0, 0.2, 1] }, { at: 60, value: 1.5 }] } });
  render(<EditorProvider store={store}><EffectsPanel /></EditorProvider>);
  const svg = boxed(screen.getByRole("group", { name: "Ease curve" }));
  const before = store.getState().queue.length;
  // A press near the first handle (40% across, at the bottom of the box) takes that one.
  fireEvent.pointerDown(svg, { button: 0, clientX: 80, clientY: 148, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: 100, clientY: 100, pointerId: 1 });
  expect(store.getState().queue.length).toBe(before); // shown, not yet saved
  fireEvent.pointerUp(svg, { pointerId: 1 });
  // Half across; half way down the drawing is the middle of the box: 50% of the way.
  expect(first(store).curve).toEqual([0.5, 0.5, 0.2, 1]);
  expect(store.getState().queue.length).toBe(before + 1);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "keyframe" });
  // Pulled above the box it overshoots, and stops at the room there is.
  fireEvent.pointerDown(svg, { button: 0, clientX: 44, clientY: 52, pointerId: 2 });
  fireEvent.pointerMove(svg, { clientX: 60, clientY: -500, pointerId: 2 });
  fireEvent.pointerUp(svg, { pointerId: 2 });
  expect(first(store).curve).toEqual([0.5, 0.5, 0.3, 1.5]);
  fireEvent.keyDown(screen.getByRole("slider", { name: "Start handle" }), { key: "ArrowLeft", shiftKey: true });
  fireEvent.keyDown(screen.getByRole("slider", { name: "Start handle" }), { key: "ArrowDown" });
  expect(first(store).curve).toEqual([0.4, 0.48, 0.3, 1.5]);
  store.getState().undo();
  expect(first(store).curve).toEqual([0.4, 0.5, 0.3, 1.5]);
});

it("a viewer sees the curve and cannot move it", () => {
  const store = storeWith({ keyframes: { scale: [{ at: 0, value: 1, curve: [0.4, 0, 0.2, 1] }, { at: 60, value: 1.5 }] } }, false);
  render(<EditorProvider store={store}><EffectsPanel /></EditorProvider>);
  const svg = boxed(screen.getByRole("group", { name: "Ease curve" }));
  fireEvent.pointerDown(svg, { button: 0, clientX: 80, clientY: 148, pointerId: 1 });
  fireEvent.pointerMove(svg, { clientX: 150, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  fireEvent.keyDown(screen.getByRole("slider", { name: "End handle" }), { key: "ArrowUp" });
  expect(first(store).curve).toEqual([0.4, 0, 0.2, 1]);
  expect(store.getState().gesture).toBeNull();
});

it("each side of a crop has a keyframe diamond, and Reset crop clears keyed sides", () => {
  const store = storeWith({});
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([assetView()])}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  const start = findClip(store.getState().doc, "c1")!.clip.start;
  act(() => store.getState().seek(start + 6));
  const left = screen.getByLabelText("Crop left") as HTMLInputElement;
  fireEvent.change(left, { target: { value: "20" } });
  fireEvent.blur(left);
  for (const side of ["left", "top", "right", "bottom"]) expect(screen.getByRole("button", { name: `Add Crop ${side} keyframe` })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add Crop left keyframe" }));
  expect(first(store, "cropLeft")).toEqual({ at: 6, value: 0.2 });
  // The Effects tab lists it as a percent.
  fireEvent.click(screen.getByRole("button", { name: "Reset crop" }));
  const clip = findClip(store.getState().doc, "c1")!.clip;
  expect(clip.transform.crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  expect(clip.keyframes).toEqual({ cropLeft: [] });
  expect((screen.getByRole("button", { name: "Reset crop" }) as HTMLButtonElement).disabled).toBe(true);
});
