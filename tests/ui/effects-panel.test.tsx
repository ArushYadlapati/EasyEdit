// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EffectsPanel } from "@/components/editor/effects-panel";
import { RightPanel } from "@/components/editor/right-panel";
import { clearKeyframesOps, deleteKeyframeOps, editKeyframeOps } from "@/lib/editor/keyframe-list";
import { createSettingsStore, DEFAULT_PREFS } from "@/lib/editor/settings";
import { findClip, type EditorStore } from "@/lib/editor/store";
import type { Clip, Keyframes, TimelineDoc } from "@/lib/timeline";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { makeStore, sampleDoc, video } from "../editor/fixtures";

function withClip(doc: TimelineDoc, clipId: string, extra: Record<string, unknown>): TimelineDoc {
  for (const track of doc.tracks) track.clips = track.clips.map((c) => (c.id === clipId ? ({ ...c, ...extra } as Clip) : c));
  return doc;
}

function storeWith(over: { [clipId: string]: Record<string, unknown> } = {}, canEdit = true): EditorStore {
  let doc = sampleDoc();
  for (const [id, extra] of Object.entries(over)) doc = withClip(doc, id, extra);
  return makeStore({ doc, canEdit });
}

function openEffects(store: EditorStore, ids: string[]) {
  store.getState().select(ids);
  return render(<EditorProvider store={store}><EffectsPanel /></EditorProvider>);
}

const SCALE: Keyframes = { scale: [{ at: 0, value: 1 }, { at: 60, value: 1.5, ease: "ease_in" }] };
const clipOf = (store: EditorStore, id: string) => findClip(store.getState().doc, id)!.clip;
const row = (name: string) => screen.getByRole("group", { name });
const box = (scope: HTMLElement, name: string) => within(scope).getByLabelText(name) as HTMLInputElement;

describe("the right panel", () => {
  it("has Inspect, Activity and Effects, in that order, and Effects shows the clip's effects", () => {
    const store = makeStore();
    store.getState().select(["c1"]);
    render(<EditorProvider store={store}><RightPanel /></EditorProvider>);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Inspect", "Activity", "Effects"]);
    // Inspect no longer has the effects, and keeps the diamonds.
    expect(screen.queryByRole("heading", { name: "Transitions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Scale keyframe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Effects" }));
    expect(screen.getByRole("tab", { name: "Effects" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Transitions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Keyframes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Scale keyframe" })).toBeNull();
  });

  it("a text clip's Transitions are in Effects, not Inspect", () => {
    const store = makeStore();
    store.getState().select(["x1"]);
    render(<EditorProvider store={store}><RightPanel /></EditorProvider>);
    expect(screen.queryByRole("heading", { name: "Transitions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Scale keyframe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Effects" }));
    expect(screen.getByRole("heading", { name: "Transitions" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Animation" })).toBeNull();
    expect(screen.getByLabelText("Emphasis")).toBeTruthy();
  });

  it("an image's Ken Burns is in Effects, not Inspect", () => {
    const store = storeWith({ c1: { type: "image" } });
    store.getState().select(["c1"]);
    render(<EditorProvider store={store}><RightPanel /></EditorProvider>);
    expect(screen.queryByRole("button", { name: "Ken Burns" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Effects" }));
    expect(screen.getByRole("button", { name: "Ken Burns" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Transitions" })).toBeTruthy();
  });
});

describe("what Effects says instead", () => {
  it("with nothing selected", () => {
    openEffects(makeStore(), []);
    expect(screen.getByText("Select a clip to see its effects.")).toBeTruthy();
  });

  it("with several clips selected", () => {
    openEffects(makeStore(), ["c1", "x1"]);
    expect(screen.getByText("Select one clip to see its effects.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Transitions" })).toBeNull();
  });

  it("for an audio clip", () => {
    const doc = sampleDoc();
    doc.tracks[3].clips = [video("au", 0, 30, { type: "audio" })];
    openEffects(makeStore({ doc }), ["au"]);
    // A sound has no picture to move or fade in, but its volume can be keyed.
    expect(screen.queryByRole("heading", { name: "Transitions" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Keyframes" })).toBeTruthy();
    expect(screen.getByText("No keyframes yet. Use the ◆ beside a field in Inspect to add one.")).toBeTruthy();
  });

  it("for a clip with no keyframes", () => {
    openEffects(makeStore(), ["c1"]);
    expect(screen.getByText("No keyframes yet. Use the ◆ beside a field in Inspect to add one.")).toBeTruthy();
  });
});

describe("the keyframe list", () => {
  it("lists each keyed property with its keyframes in time order", () => {
    const store = storeWith({ x1: { keyframes: { opacity: [{ at: 30, value: 0.25 }], scale: [SCALE.scale![1], SCALE.scale![0]] } } });
    openEffects(store, ["x1"]);
    // Properties in Inspect's order, Scale before Opacity.
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Scale", "Opacity"]);
    const first = row("Scale keyframe at 0.00s");
    const second = row("Scale keyframe at 2.00s");
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box(first, "Time").value).toBe("0");
    expect(box(second, "Time").value).toBe("2");
    expect(box(first, "Value").value).toBe("100");
    expect(box(second, "Value").value).toBe("150");
    expect(within(first).getByText("%")).toBeTruthy();
    expect((within(first).getByLabelText("Ease") as HTMLSelectElement).value).toBe("linear");
    expect((within(second).getByLabelText("Ease") as HTMLSelectElement).value).toBe("ease_in");
    expect([...(within(first).getByLabelText("Ease") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      "Linear",
      "Ease in",
      "Ease out",
      "Ease in-out",
      "Custom curve",
    ]);
    expect(box(row("Opacity keyframe at 1.00s"), "Value").value).toBe("25");
  });

  it("X and Y show in the unit Inspect uses", () => {
    const store = storeWith({ x1: { keyframes: { x: [{ at: 0, value: 0.25 }] } } });
    const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, units: "in" } });
    store.getState().select(["x1"]);
    render(<EditorProvider store={store} settings={settings}><EffectsPanel /></EditorProvider>);
    const x = row("X keyframe at 0.00s");
    // A quarter of 1080 px is 270 px, 2.81 in.
    expect(box(x, "Value").value).toBe("2.81");
    expect(within(x).getByText("in")).toBeTruthy();
    fireEvent.change(box(x, "Value"), { target: { value: "5" } });
    fireEvent.blur(box(x, "Value"));
    expect(store.getState().queue).toMatchObject([{ label: "keyframe", ops: [{ patch: { keyframes: { x: [{ at: 0, value: 0.444444 }] } } }] }]);
  });

  it("a typed time snaps to a whole frame and is one edit", () => {
    const store = storeWith({ x1: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    const before = clipOf(store, "x1");
    const time = box(row("Scale keyframe at 0.00s"), "Time");
    fireEvent.change(time, { target: { value: "1.5" } });
    fireEvent.blur(time);
    expect(store.getState().queue).toHaveLength(1);
    expect(store.getState().queue[0]).toMatchObject({ label: "keyframe", ops: editKeyframeOps(before, "scale", 0, { at: 45 }) });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(row("Scale keyframe at 1.50s")).toBeTruthy();
  });

  it("a time between frames goes to the nearest one", () => {
    const store = storeWith({ x1: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    const before = clipOf(store, "x1");
    const time = box(row("Scale keyframe at 0.00s"), "Time");
    fireEvent.change(time, { target: { value: "0.51" } });
    fireEvent.keyDown(time, { key: "Enter" });
    expect(store.getState().queue[0]).toMatchObject({ ops: editKeyframeOps(before, "scale", 0, { at: 15 }) });
  });

  it("the ease select changes the ease", () => {
    const store = storeWith({ x1: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    const before = clipOf(store, "x1");
    fireEvent.change(within(row("Scale keyframe at 0.00s")).getByLabelText("Ease"), { target: { value: "ease_out" } });
    expect(store.getState().queue).toMatchObject([{ label: "keyframe", ops: editKeyframeOps(before, "scale", 0, { ease: "ease_out" }) }]);
  });

  it("a typed value is saved in the doc's units", () => {
    const store = storeWith({ x1: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    const before = clipOf(store, "x1");
    const value = box(row("Scale keyframe at 0.00s"), "Value");
    fireEvent.change(value, { target: { value: "125" } });
    fireEvent.blur(value);
    expect(store.getState().queue).toMatchObject([{ label: "keyframe", ops: editKeyframeOps(before, "scale", 0, { value: 1.25 }) }]);
  });

  it("ignores empty, half-typed and odd input, and keeps scale above 0 and opacity within 0–100 %", () => {
    const store = storeWith({ x1: { keyframes: { ...SCALE, opacity: [{ at: 0, value: 0.5 }] } } });
    openEffects(store, ["x1"]);
    const scale = box(row("Scale keyframe at 0.00s"), "Value");
    for (const typed of ["", "-", "1e2", "abc", "0x10"]) {
      fireEvent.change(scale, { target: { value: typed } });
      fireEvent.blur(scale);
    }
    const time = box(row("Scale keyframe at 0.00s"), "Time");
    for (const typed of ["", ".", "-", "1e1"]) {
      fireEvent.change(time, { target: { value: typed } });
      fireEvent.blur(time);
    }
    expect(store.getState().queue).toEqual([]);
    expect(box(row("Scale keyframe at 0.00s"), "Value").value).toBe("100");
    // 0 % stops at the smallest scale Inspect takes.
    fireEvent.change(scale, { target: { value: "0" } });
    fireEvent.blur(scale);
    expect(clipOf(store, "x1").keyframes?.scale?.[0]).toEqual({ at: 0, value: 0.01 });
    const opacity = box(row("Opacity keyframe at 0.00s"), "Value");
    fireEvent.change(opacity, { target: { value: "150" } });
    fireEvent.blur(opacity);
    expect(clipOf(store, "x1").keyframes?.opacity).toEqual([{ at: 0, value: 1 }]);
    expect(store.getState().notice?.tone).not.toBe("error");
  });

  it("Delete removes a keyframe and Clear a property's keyframes, each one edit", () => {
    const store = storeWith({ x1: { keyframes: { ...SCALE, rotation: [{ at: 10, value: 45 }] } } });
    openEffects(store, ["x1"]);
    const before = clipOf(store, "x1");
    fireEvent.click(within(row("Scale keyframe at 2.00s")).getByRole("button", { name: "Delete" }));
    expect(store.getState().queue).toMatchObject([{ label: "keyframe", ops: deleteKeyframeOps(before, "scale", 60) }]);
    const middle = clipOf(store, "x1");
    fireEvent.click(within(screen.getByRole("group", { name: "Rotation" })).getByRole("button", { name: "Clear" }));
    expect(store.getState().queue[1]).toMatchObject({ label: "keyframe", ops: clearKeyframesOps(middle, "rotation") });
    expect(screen.queryByRole("group", { name: "Rotation" })).toBeNull();
    expect(store.getState().undoStack).toHaveLength(2);
  });

  it("Go to pauses and moves the playhead to the keyframe", () => {
    const store = storeWith({ x2: { keyframes: SCALE } });
    openEffects(store, ["x2"]);
    store.getState().seek(5);
    fireEvent.click(within(row("Scale keyframe at 2.00s")).getByRole("button", { name: "Go to" }));
    expect(store.getState().playhead).toBe(90 + 60);
    expect(store.getState().playing).toBe(false);
    expect(store.getState().queue).toEqual([]);
  });

  it("a field commits to the clip it belongs to", () => {
    const store = storeWith({ x1: { keyframes: SCALE }, x2: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    const before = clipOf(store, "x1");
    const time = box(row("Scale keyframe at 0.00s"), "Time");
    fireEvent.change(time, { target: { value: "1" } });
    // A click on a timeline clip selects it on pointerdown, before the field's blur.
    act(() => store.getState().select(["x2"]));
    expect(store.getState().queue).toHaveLength(1);
    expect(store.getState().queue[0]).toMatchObject({ label: "keyframe", ops: editKeyframeOps(before, "scale", 0, { at: 30 }) });
    fireEvent.blur(time);
    expect(store.getState().queue).toHaveLength(1);
    expect(clipOf(store, "x2").keyframes).toEqual(SCALE);
    // The new clip's fields start clean.
    expect(box(row("Scale keyframe at 0.00s"), "Time").value).toBe("0");
  });

  it("a value typed and left by selecting another clip is saved to its own clip", () => {
    const store = storeWith({ x1: { keyframes: SCALE }, x2: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    const before = clipOf(store, "x1");
    fireEvent.change(box(row("Scale keyframe at 2.00s"), "Value"), { target: { value: "125" } });
    act(() => store.getState().select(["x2"]));
    expect(store.getState().queue).toMatchObject([{ label: "keyframe", ops: editKeyframeOps(before, "scale", 60, { value: 1.25 }) }]);
    expect(clipOf(store, "x2").keyframes).toEqual(SCALE);
  });

  it("a half-typed value left by selecting another clip saves nothing", () => {
    const store = storeWith({ x1: { keyframes: SCALE }, x2: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    fireEvent.change(box(row("Scale keyframe at 0.00s"), "Value"), { target: { value: "1e" } });
    fireEvent.change(box(row("Scale keyframe at 0.00s"), "Time"), { target: { value: "-" } });
    act(() => store.getState().select(["x2"]));
    expect(store.getState().queue).toEqual([]);
  });

  it("the arrows step a keyframe's time a frame at a time, keeping the focus in the field", () => {
    const store = storeWith({ x1: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    store.getState().seek(20);
    const time = box(row("Scale keyframe at 0.00s"), "Time");
    time.focus();
    fireEvent.keyDown(time, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(clipOf(store, "x1").keyframes?.scale?.map((k) => k.at)).toEqual([2, 60]);
    expect(document.activeElement).toBe(time);
    expect(time.isConnected).toBe(true);
    expect(store.getState().playhead).toBe(20);
    expect(store.getState().undoStack).toHaveLength(2);
  });

  it("a keyframe moved past another keeps its row and the focus", () => {
    const store = storeWith({ x1: { keyframes: SCALE } });
    openEffects(store, ["x1"]);
    const time = box(row("Scale keyframe at 0.00s"), "Time");
    time.focus();
    fireEvent.change(time, { target: { value: "3" } });
    fireEvent.keyDown(time, { key: "Enter" });
    expect(clipOf(store, "x1").keyframes?.scale?.map((k) => k.at)).toEqual([60, 90]);
    expect(box(row("Scale keyframe at 3.00s"), "Time")).toBe(time);
    expect(document.activeElement).toBe(time);
    // A new keyframe at the old time gets a row of its own.
    act(() => {
      store.getState().edit([{ op: "update_clip", clipId: "x1", patch: { keyframes: { scale: [{ at: 0, value: 2 }, { at: 60, value: 1.5 }, { at: 90, value: 1 }] } } }], "keyframe");
    });
    expect(box(row("Scale keyframe at 0.00s"), "Value").value).toBe("200");
    expect(box(row("Scale keyframe at 3.00s"), "Time")).toBe(time);
  });

  it("after Delete the focus goes to the next row's Delete, else the property's Clear, else the next property's Clear", () => {
    const keyframes: Keyframes = { scale: [{ at: 0, value: 1 }, { at: 30, value: 1.2 }, { at: 60, value: 1.5 }], rotation: [{ at: 0, value: 0 }], opacity: [{ at: 0, value: 1 }] };
    const store = storeWith({ x1: { keyframes } });
    openEffects(store, ["x1"]);
    const del = (name: string) => within(row(name)).getByRole("button", { name: "Delete" });
    const clear = (prop: string) => within(screen.getByRole("group", { name: prop })).getByRole("button", { name: "Clear" });
    del("Scale keyframe at 0.00s").focus();
    fireEvent.click(del("Scale keyframe at 0.00s"));
    expect(document.activeElement).toBe(del("Scale keyframe at 1.00s"));
    fireEvent.click(del("Scale keyframe at 2.00s"));
    expect(document.activeElement).toBe(clear("Scale"));
    fireEvent.click(del("Rotation keyframe at 0.00s"));
    expect(document.activeElement).toBe(clear("Opacity"));
    fireEvent.click(del("Opacity keyframe at 0.00s"));
    expect(document.activeElement).toBe(clear("Scale"));
  });

  it("the ease says what it shapes", () => {
    openEffects(storeWith({ x1: { keyframes: SCALE } }), ["x1"]);
    expect(within(row("Scale keyframe at 2.00s")).getByLabelText("Ease").getAttribute("title")).toBe("Easing shapes the move to the next keyframe");
  });

  it("a viewer can only go to a keyframe", () => {
    const store = storeWith({ c1: { type: "image", keyframes: { ...SCALE, x: [{ at: 0, value: 0.5 }] }, transitionIn: { kind: "fade", frames: 15 } } }, false);
    const { container } = openEffects(store, ["c1"]);
    const all = [...container.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select, textarea")];
    const goTo = all.filter((c) => c.getAttribute("aria-label") === "Go to");
    expect(goTo).toHaveLength(3);
    for (const c of goTo) {
      expect(c.disabled).toBe(false);
      expect(c.hasAttribute("data-edit-control")).toBe(false);
    }
    const controls = all.filter((c) => !goTo.includes(c));
    expect(controls.length).toBeGreaterThan(10);
    for (const c of controls) {
      expect(c.disabled, c.outerHTML.slice(0, 120)).toBe(true);
      expect(c.hasAttribute("data-edit-control"), c.outerHTML.slice(0, 120)).toBe(true);
    }
    fireEvent.click(goTo[2]);
    expect(store.getState().playhead).toBe(60);
  });
});
