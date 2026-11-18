// @vitest-environment happy-dom
// Transitions and Animation, in the Effects tab.
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EffectsPanel } from "@/components/editor/effects-panel";
import { findClip, viewDoc } from "@/lib/editor/store";
import { fireEvent, render, screen } from "../helpers/dom";
import { makeStore } from "../editor/fixtures";

function open(id: string, canEdit = true) {
  const store = makeStore({ canEdit });
  store.getState().select([id]);
  render(<EditorProvider store={store}><EffectsPanel /></EditorProvider>);
  return store;
}

it("a video clip has Transitions, and choosing Fade sends the whole transition", () => {
  const store = open("c1");
  expect(screen.getByText("Transitions")).toBeTruthy();
  expect(screen.queryByText("Animation")).toBeNull();
  fireEvent.change(screen.getByLabelText("Transition in"), { target: { value: "fade" } });
  expect(store.getState().queue).toMatchObject([
    { label: "transition", ops: [{ op: "update_clip", clipId: "c1", patch: { transitionIn: { kind: "fade", frames: 15 } } }] },
  ]);
});

it("Slide gets a direction, and Crossfade is not offered for Out", () => {
  const store = open("c1");
  fireEvent.change(screen.getByLabelText("Transition in"), { target: { value: "slide" } });
  expect(store.getState().queue[0]).toMatchObject({ ops: [{ patch: { transitionIn: { kind: "slide", frames: 15, direction: "left" } } }] });
  expect(screen.getByLabelText("In direction")).toBeTruthy();
  const out = screen.getByLabelText("Transition out") as HTMLSelectElement;
  expect([...out.options].map((o) => o.textContent)).not.toContain("Crossfade");
});

it("None sends null", () => {
  const store = open("c1");
  fireEvent.change(screen.getByLabelText("Transition in"), { target: { value: "fade" } });
  fireEvent.change(screen.getByLabelText("Transition in"), { target: { value: "" } });
  expect(findClip(viewDoc(store.getState()), "c1")!.clip).toMatchObject({ transitionIn: null });
});

it("a text clip has Animation and no Transitions", () => {
  const store = open("x1");
  expect(screen.getByText("Animation")).toBeTruthy();
  expect(screen.queryByText("Transitions")).toBeNull();
  fireEvent.change(screen.getByLabelText("Animation in"), { target: { value: "pop" } });
  fireEvent.change(screen.getByLabelText("Emphasis"), { target: { value: "highlight_word" } });
  expect(store.getState().queue).toMatchObject([
    { label: "text animation", ops: [{ patch: { animationIn: { preset: "pop", frames: 15 } } }] },
    { label: "text animation", ops: [{ patch: { emphasis: { preset: "highlight_word", color: "#FFD400" } } }] },
  ]);
  expect(screen.getByLabelText("Highlight color")).toBeTruthy();
});

it("a viewer's controls are disabled", () => {
  open("c1", false);
  expect((screen.getByLabelText("Transition in") as HTMLSelectElement).disabled).toBe(true);
});
