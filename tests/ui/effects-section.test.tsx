// @vitest-environment happy-dom
// Transitions and Animation, in the Effects tab.
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EffectsPanel } from "@/components/editor/effects-panel";
import { SWATCH_BOX } from "@/components/ui/cx";
import { findClip, viewDoc } from "@/lib/editor/store";
import type { Clip, TextClip } from "@/lib/timeline";
import { fireEvent, render, screen } from "../helpers/dom";
import { makeStore, sampleDoc } from "../editor/fixtures";

// extra: fields put on x1, the first text clip, before the panel opens.
function open(id: string, canEdit = true, extra: Record<string, unknown> = {}) {
  const doc = sampleDoc();
  doc.tracks[1].clips = doc.tracks[1].clips.map((c) => (c.id === "x1" ? ({ ...c, ...extra } as Clip) : c));
  const store = makeStore({ canEdit, doc });
  store.getState().select([id]);
  render(<EditorProvider store={store}><EffectsPanel /></EditorProvider>);
  return store;
}

const options = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.textContent);
const emphasisOf = (store: ReturnType<typeof open>) => (findClip(viewDoc(store.getState()), "x1")!.clip as TextClip).emphasis;
function type(label: string, value: string) {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: "Enter" });
}

it("a video clip has Transitions, and choosing Fade sends the whole transition", () => {
  const store = open("c1");
  expect(screen.getByText("Transitions")).toBeTruthy();
  expect(screen.queryByLabelText("Emphasis")).toBeNull(); // text only
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

it("a text clip's section is called Transitions too, with its own presets and Emphasis", () => {
  const store = open("x1");
  expect(screen.getByRole("heading", { name: "Transitions" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Animation" })).toBeNull();
  expect([...(screen.getByLabelText("Transition in") as HTMLSelectElement).options].map((o) => o.textContent)).toContain("Typewriter");
  fireEvent.change(screen.getByLabelText("Transition in"), { target: { value: "pop" } });
  fireEvent.change(screen.getByLabelText("Emphasis"), { target: { value: "pulse" } });
  expect(store.getState().queue).toMatchObject([
    { label: "text animation", ops: [{ patch: { animationIn: { preset: "pop", frames: 15 } } }] },
    { label: "text animation", ops: [{ patch: { emphasis: { preset: "pulse" } } }] },
  ]);
});

it("Emphasis offers Shake and Pulse, and no longer Highlight word", () => {
  open("x1");
  expect(options("Emphasis")).toEqual(["None", "Shake", "Pulse"]);
  expect(screen.queryByLabelText("Highlight color")).toBeNull();
  expect(screen.queryByLabelText("Emphasis amount")).toBeNull();
});

it("a clip that already highlights its words shows it, with its color, until another emphasis replaces it", () => {
  const store = open("x1", true, { emphasis: { preset: "highlight_word", color: "#00ff00" } });
  expect(options("Emphasis")).toEqual(["None", "Shake", "Pulse", "Highlight word"]);
  expect((screen.getByLabelText("Emphasis") as HTMLSelectElement).value).toBe("highlight_word");
  expect(screen.getByText(/No longer offered/)).toBeTruthy();
  // The same color box as the inspector's and the brand kit's.
  expect(screen.getByLabelText("Highlight color").className).toBe(SWATCH_BOX);
  expect((screen.getByLabelText("Highlight color hex") as HTMLInputElement).value).toBe("#00ff00");
  // Its color can still be changed.
  type("Highlight color hex", "#ff0000");
  expect(emphasisOf(store)).toStrictEqual({ preset: "highlight_word", color: "#ff0000" });
  // A highlight has no amount or speed.
  expect(screen.queryByLabelText("Emphasis amount")).toBeNull();

  fireEvent.change(screen.getByLabelText("Emphasis"), { target: { value: "shake" } });
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "text animation", ops: [{ patch: { emphasis: { preset: "shake" } } }] });
  expect(emphasisOf(store)).toStrictEqual({ preset: "shake" });
  expect(options("Emphasis")).toEqual(["None", "Shake", "Pulse"]);
  expect(screen.queryByLabelText("Highlight color")).toBeNull();
  expect(screen.queryByText(/No longer offered/)).toBeNull();
});

it("a shake's amount and speed are percents of its own look, each one undo step, and 100% keeps no value", () => {
  const store = open("x1");
  fireEvent.change(screen.getByLabelText("Emphasis"), { target: { value: "shake" } });
  expect((screen.getByLabelText("Emphasis amount") as HTMLInputElement).value).toBe("100");
  expect((screen.getByLabelText("Emphasis speed") as HTMLInputElement).value).toBe("100");

  type("Emphasis amount", "50");
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "text animation", ops: [{ op: "update_clip", clipId: "x1", patch: { emphasis: { preset: "shake", amount: 0.5 } } }] });
  type("Emphasis speed", "200");
  expect(emphasisOf(store)).toStrictEqual({ preset: "shake", amount: 0.5, speed: 2 });
  expect((screen.getByLabelText("Emphasis amount") as HTMLInputElement).value).toBe("50");
  expect(store.getState().undoStack).toHaveLength(3);

  // Typed past its range, a field stops at its end; back at 100% the field is left out, as an older project has it.
  type("Emphasis speed", "900");
  expect(emphasisOf(store)).toStrictEqual({ preset: "shake", amount: 0.5, speed: 4 });
  type("Emphasis amount", "1");
  expect(emphasisOf(store)).toStrictEqual({ preset: "shake", amount: 0.1, speed: 4 });
  type("Emphasis amount", "100");
  type("Emphasis speed", "100");
  expect(emphasisOf(store)).toStrictEqual({ preset: "shake" });

  // A pulse takes them too, and a shake turned into one keeps them.
  type("Emphasis amount", "40");
  fireEvent.change(screen.getByLabelText("Emphasis"), { target: { value: "pulse" } });
  expect(emphasisOf(store)).toStrictEqual({ preset: "pulse", amount: 0.4 });
  expect((screen.getByLabelText("Emphasis amount") as HTMLInputElement).value).toBe("40");

  fireEvent.change(screen.getByLabelText("Emphasis"), { target: { value: "" } });
  expect(emphasisOf(store)).toBeNull();
  expect(screen.queryByLabelText("Emphasis amount")).toBeNull();
});

it("a viewer's controls are disabled", () => {
  open("c1", false);
  expect((screen.getByLabelText("Transition in") as HTMLSelectElement).disabled).toBe(true);
});

it("a viewer sees a text clip's emphasis, amount and speed, and can change none of them", () => {
  open("x1", false, { emphasis: { preset: "pulse", amount: 0.5, speed: 1.5 } });
  expect((screen.getByLabelText("Emphasis") as HTMLSelectElement).disabled).toBe(true);
  const amount = screen.getByLabelText("Emphasis amount") as HTMLInputElement;
  expect(amount.value).toBe("50");
  expect(amount.disabled).toBe(true);
  expect((screen.getByLabelText("Emphasis speed") as HTMLInputElement).value).toBe("150");
  expect((screen.getByLabelText("Emphasis speed") as HTMLInputElement).disabled).toBe(true);
});
