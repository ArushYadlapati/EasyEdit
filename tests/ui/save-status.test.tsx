// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { SaveStatus } from "@/components/editor/save-status";
import { makeStore } from "../editor/fixtures";
import { act, cleanup, render, screen } from "../helpers/dom";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const shown = () => screen.getByRole("status").textContent;

it("a held edit is not called saved", () => {
  const store = makeStore();
  render(<EditorProvider store={store}><SaveStatus /></EditorProvider>);
  expect(shown()).toBe("Saved");
  act(() => void store.getState().setGesture([{ op: "update_clip", clipId: "x1", patch: { text: "GO" } }], "text edit"));
  expect(shown()).toBe("Not saved yet");
  act(() => store.getState().saveHeldEdit());
  expect(shown()).toBe("Saved"); // the store's own status; the sync engine says Saving… once it sends
});

it("says EasyEdit can't be reached while the browser is online, and Offline once it is not", () => {
  const store = makeStore();
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  render(<EditorProvider store={store}><SaveStatus /></EditorProvider>);
  act(() => {
    store.getState().edit([{ op: "move_clip", clipId: "x2", start: 200 }], "move");
    store.getState().setStatus("offline");
  });
  expect(shown()).toBe("Can't reach EasyEdit. Your changes are kept here and will save when it answers.");
  online.mockReturnValue(false);
  act(() => void window.dispatchEvent(new Event("offline")));
  expect(shown()).toBe("Offline. Changes will save when you reconnect.");
});
