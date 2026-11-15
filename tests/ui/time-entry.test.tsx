// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";

// sampleDoc runs at 30 fps and ends at frame 120 (0:04:00).
function show(over: Parameters<typeof makeStore>[0] = {}) {
  const store = makeStore(over);
  render(
    <EditorProvider store={store}>
      <EditorScreen spaceSlug="seattle-solvers" />
    </EditorProvider>,
  );
  return store;
}

const readout = () => screen.getByRole("button", { name: /^Current time/ });
const field = () => screen.queryByRole("textbox", { name: "Go to time" }) as HTMLInputElement | null;

function openField() {
  fireEvent.doubleClick(readout());
  const input = field();
  if (!input) throw new Error("no time field");
  return input;
}

it("double-clicking the time opens a field holding the current time, all selected", () => {
  const store = show();
  act(() => store.getState().seek(45));
  const input = openField();
  expect(input.value).toBe("0:01:15");
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
});

it("a single click does not open it", () => {
  show();
  fireEvent.click(readout(), { detail: 1 });
  expect(field()).toBeNull();
});

it("Enter jumps the playhead to the typed time and closes the field", () => {
  const store = show();
  const input = openField();
  fireEvent.change(input, { target: { value: "0:02:10" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(store.getState().playhead).toBe(70);
  expect(field()).toBeNull();
  expect(readout().textContent).toContain("0:02:10");
  expect(store.getState().queue).toHaveLength(0); // moving the playhead is not an edit
});

it("Escape closes the field and leaves the playhead where it was", () => {
  const store = show();
  act(() => store.getState().seek(10));
  const input = openField();
  fireEvent.change(input, { target: { value: "0:03:00" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(store.getState().playhead).toBe(10);
  expect(field()).toBeNull();
});

it("a time past the end stops at the end", () => {
  const store = show();
  const input = openField();
  fireEvent.change(input, { target: { value: "5:00" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(store.getState().playhead).toBe(120);
});

it("a time it cannot read stays open and is marked, and clicking away drops it", () => {
  const store = show();
  act(() => store.getState().seek(10));
  const input = openField();
  fireEvent.change(input, { target: { value: "soon" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(field()).not.toBeNull();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  fireEvent.blur(input);
  expect(field()).toBeNull();
  expect(store.getState().playhead).toBe(10);
});

it("clicking away with a good time goes there", () => {
  const store = show();
  const input = openField();
  fireEvent.change(input, { target: { value: "2" } });
  fireEvent.blur(input);
  expect(store.getState().playhead).toBe(60);
});

it("opening the field pauses playback", () => {
  const store = show();
  act(() => store.getState().play());
  openField();
  expect(store.getState().playing).toBe(false);
});

it("Space typed into the field does not start playback", () => {
  const store = show();
  const input = openField();
  fireEvent.keyDown(input, { key: " ", code: "Space" });
  expect(store.getState().playing).toBe(false);
});

it("from the keyboard, Enter on the focused time opens the field", () => {
  show();
  fireEvent.click(readout(), { detail: 0 }); // a keyboard press of a button has no click count
  expect(field()).not.toBeNull();
});

it("a viewer can type a time too, since moving the playhead is not an edit", () => {
  const store = show({ canEdit: false });
  const input = openField();
  fireEvent.change(input, { target: { value: "0:01:00" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(store.getState().playhead).toBe(30);
});
