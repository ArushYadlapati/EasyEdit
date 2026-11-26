// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { HELD_EDIT_PAUSE_MS, holdsEdit, watchHeldEdits } from "@/lib/editor/held-edit";
import { findClip } from "@/lib/editor/store";
import { makeStore } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen } from "../helpers/dom";

// Every field that shows a value as it is typed or picked holds the edit the same way: it counts as unsaved, and a
// pause saves it under the label leaving the field would.
let stop: () => void = () => {};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop();
  cleanup();
  vi.useRealTimers();
});

function open() {
  const store = makeStore();
  store.getState().select(["x1"]);
  stop = watchHeldEdits(store);
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  return store;
}

it("the Text box", () => {
  const store = open();
  act(() => fireEvent.change(screen.getByLabelText("Text"), { target: { value: "GO" } }));
  expect(holdsEdit(store.getState())).toBe(true);
  act(() => vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS));
  expect(store.getState().queue).toMatchObject([{ label: "text edit", ops: [{ op: "update_clip", clipId: "x1", patch: { text: "GO" } }] }]);
  expect(holdsEdit(store.getState())).toBe(false);
});

it("a number being typed", () => {
  const store = open();
  act(() => fireEvent.change(screen.getByLabelText("Size"), { target: { value: "90" } }));
  expect(holdsEdit(store.getState())).toBe(true);
  act(() => vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS));
  expect(store.getState().queue).toMatchObject([{ label: "style change" }]);
  expect(findClip(store.getState().doc, "x1")!.clip).toMatchObject({ style: { fontSize: 90 } });
});

it("the colour picker while it moves, and the hex box", () => {
  const store = open();
  act(() => fireEvent.input(screen.getByLabelText("Color"), { target: { value: "#ff0000" } }));
  expect(holdsEdit(store.getState())).toBe(true);
  act(() => vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS));
  expect(store.getState().queue).toHaveLength(1);

  act(() => fireEvent.change(screen.getByLabelText("Hex color"), { target: { value: "#00ff00" } }));
  expect(holdsEdit(store.getState())).toBe(true);
  act(() => vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS));
  expect(store.getState().queue).toHaveLength(2);
  expect(findClip(store.getState().doc, "x1")!.clip).toMatchObject({ style: { color: "#00ff00" } });
});
