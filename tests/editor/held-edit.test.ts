// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HELD_EDIT_PAUSE_MS, holdsEdit, watchHeldEdits } from "@/lib/editor/held-edit";
import type { Op } from "@/lib/timeline";
import { entry, makeStore } from "./fixtures";

const retext = (value: string): Op[] => [{ op: "update_clip", clipId: "x1", patch: { text: value } }];
let stop: () => void = () => {};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop();
  vi.useRealTimers();
});

function watched() {
  const store = makeStore();
  stop = watchHeldEdits(store);
  return store;
}

it("a labelled gesture is a held edit; a drag is not", () => {
  const store = makeStore();
  store.getState().setGesture(retext("Hi"));
  expect(holdsEdit(store.getState())).toBe(false);
  store.getState().setGesture(retext("Hi"), "text");
  expect(holdsEdit(store.getState())).toBe(true);
});

it("saves a held edit after a second without a change: one change per burst of typing", () => {
  const store = watched();
  store.getState().setGesture(retext("H"), "text");
  vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS - 100);
  store.getState().setGesture(retext("He"), "text");
  vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS - 100);
  expect(store.getState().queue).toEqual([]);
  vi.advanceTimersByTime(100);
  expect(store.getState().queue).toMatchObject([{ label: "text", ops: retext("He") }]);
  expect(store.getState().gesture).toBeNull();

  store.getState().setGesture(retext("Hello"), "text");
  vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS);
  expect(store.getState().queue).toHaveLength(2);
  expect(store.getState().undoStack.map((u) => u.label)).toEqual(["text", "text"]);
});

it("a teammate's change does not restart the wait", () => {
  const store = watched();
  store.getState().setGesture(retext("Hi"), "text");
  vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS - 100);
  store.getState().applyRemote([entry(6, [{ op: "move_clip", clipId: "x2", start: 200 }])]);
  vi.advanceTimersByTime(100);
  expect(store.getState().queue).toMatchObject([{ label: "text" }]);
});

it("does not save a drag, and a gesture ended before the pause saves nothing", () => {
  const store = watched();
  store.getState().setGesture(retext("Hi"));
  vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS * 2);
  store.getState().setGesture(retext("Hey"), "text");
  store.getState().setGesture(null);
  vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS * 2);
  expect(store.getState().queue).toEqual([]);
});

it("saves at once when the tab is hidden or the page goes away", () => {
  const store = watched();
  store.getState().setGesture(retext("Hi"), "text");
  const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(store.getState().queue).toHaveLength(1);
  hidden.mockRestore();

  store.getState().setGesture(retext("Hey"), "text");
  window.dispatchEvent(new Event("pagehide"));
  expect(store.getState().queue).toHaveLength(2);
  vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS * 2);
  expect(store.getState().queue).toHaveLength(2);
});

it("stops watching when stopped", () => {
  const store = makeStore();
  watchHeldEdits(store)();
  store.getState().setGesture(retext("Hi"), "text");
  window.dispatchEvent(new Event("pagehide"));
  vi.advanceTimersByTime(HELD_EDIT_PAUSE_MS * 2);
  expect(store.getState().queue).toEqual([]);
});
