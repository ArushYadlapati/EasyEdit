// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EffectsPanel } from "@/components/editor/effects-panel";
import { Inspector } from "@/components/editor/inspector";
import { findClip, viewDoc } from "@/lib/editor/store";
import type { Clip, Keyframes, TimelineDoc } from "@/lib/timeline";
import { fireEvent, render, screen } from "../helpers/dom";
import { makeStore, sampleDoc } from "../editor/fixtures";

function withClip(doc: TimelineDoc, clipId: string, extra: Record<string, unknown>): TimelineDoc {
  for (const track of doc.tracks) track.clips = track.clips.map((c) => (c.id === clipId ? ({ ...c, ...extra } as Clip) : c));
  return doc;
}

function open(id: string, opts: { keyframes?: Keyframes; canEdit?: boolean; playhead?: number; image?: boolean; effects?: boolean } = {}) {
  let doc = sampleDoc();
  if (opts.keyframes) doc = withClip(doc, id, { keyframes: opts.keyframes });
  if (opts.image) doc = withClip(doc, id, { type: "image" });
  const store = makeStore({ doc, canEdit: opts.canEdit ?? true });
  store.getState().select([id]);
  store.getState().seek(opts.playhead ?? 10);
  render(<EditorProvider store={store}>{opts.effects ? <EffectsPanel /> : <Inspector />}</EditorProvider>);
  return store;
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

it("each keyframed property has a diamond", () => {
  open("x1");
  for (const name of ["Add X keyframe", "Add Y keyframe", "Add Scale keyframe", "Add Rotation keyframe", "Add Opacity keyframe"]) {
    expect(button(name).getAttribute("aria-pressed")).toBe("false");
  }
});

it("clicking the X diamond adds a keyframe at the playhead with the current value, as one edit", () => {
  const store = open("x1");
  fireEvent.click(button("Add X keyframe"));
  expect(store.getState().queue).toMatchObject([
    { label: "keyframe", ops: [{ op: "update_clip", clipId: "x1", patch: { keyframes: { x: [{ at: 10, value: 0.5 }] } } }] },
  ]);
  // Keyed at the playhead, the diamond is pressed and its name says what a click does now.
  expect(button("Remove X keyframe").getAttribute("aria-pressed")).toBe("true");
  // Clicked again it removes it, and the clip keeps its place.
  fireEvent.click(button("Remove X keyframe"));
  expect(findClip(viewDoc(store.getState()), "x1")!.clip).toMatchObject({ keyframes: { x: [] }, transform: { x: 0.5 } });
  expect(button("Add X keyframe").getAttribute("aria-pressed")).toBe("false");
});

it("a diamond keyframed elsewhere is not pressed and reads so", () => {
  open("x1", { keyframes: { y: [{ at: 0, value: 0.5 }] } });
  expect(button("Add Y keyframe").getAttribute("aria-pressed")).toBe("false");
  expect(button("Add Y keyframe").dataset.key).toBe("elsewhere");
  expect(button("Add X keyframe").dataset.key).toBe("none");
});

it("typing X on a keyframed clip writes a keyframe at the playhead", () => {
  const store = open("x1", { keyframes: { x: [{ at: 0, value: 0.5 }] } });
  const x = screen.getByLabelText("X");
  fireEvent.change(x, { target: { value: "270" } });
  fireEvent.blur(x);
  expect(store.getState().queue).toMatchObject([
    { label: "position change", ops: [{ op: "update_clip", clipId: "x1", patch: { keyframes: { x: [{ at: 0, value: 0.5 }, { at: 10, value: 0.25 }] } } }] },
  ]);
});

it("the arrows move the playhead to the clip's previous and next keyframe", () => {
  const store = open("x1", { keyframes: { x: [{ at: 4, value: 0.5 }], opacity: [{ at: 25, value: 1 }] } });
  fireEvent.click(button("Next keyframe"));
  expect(store.getState().playhead).toBe(25);
  expect(button("Next keyframe").disabled).toBe(true);
  fireEvent.click(button("Previous keyframe"));
  expect(store.getState().playhead).toBe(4);
  expect(button("Previous keyframe").disabled).toBe(true);
});

it("Ken Burns is offered for images only, in Effects, and keys the scale in one edit", () => {
  const store = open("c1", { image: true, effects: true });
  expect(button("Ken Burns").title).toBe("Slow zoom in across the clip (replaces its scale keyframes)");
  fireEvent.click(button("Ken Burns"));
  expect(store.getState().queue).toMatchObject([
    { label: "keyframe", ops: [{ op: "update_clip", clipId: "c1", patch: { keyframes: { scale: [{ at: 0, value: 1 }, { at: 29, value: 1.15 }] } } }] },
  ]);
  expect(store.getState().undoStack).toHaveLength(1);
});

it("a video or text clip has no Ken Burns, and Inspect has none", () => {
  open("c1", { effects: true });
  expect(screen.queryByRole("button", { name: "Ken Burns" })).toBeNull();
});

it("an image's Ken Burns is not in Inspect", () => {
  open("c1", { image: true });
  expect(screen.queryByRole("button", { name: "Ken Burns" })).toBeNull();
  expect(button("Add Scale keyframe")).toBeTruthy();
});

it("a viewer's Ken Burns is disabled", () => {
  open("c1", { canEdit: false, image: true, effects: true });
  expect(button("Ken Burns").disabled).toBe(true);
});

it("a viewer's diamonds are disabled, and the arrows still seek", () => {
  const store = open("c1", { canEdit: false, image: true, keyframes: { x: [{ at: 20, value: 0.5 }] } });
  expect(button("Add X keyframe").disabled).toBe(true);
  const next = button("Next keyframe");
  expect(next.disabled).toBe(false);
  expect(next.hasAttribute("data-edit-control")).toBe(false);
  expect(button("Previous keyframe").hasAttribute("data-edit-control")).toBe(false);
  fireEvent.click(next);
  expect(store.getState().playhead).toBe(20);
});
