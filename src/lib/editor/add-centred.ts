import { nanoid } from "nanoid";
import { MESSAGES } from "./messages";
import { centredGeometry, placeShape } from "./shape-draw";
import type { EditorStore } from "./store";

// Adding with the keyboard what the Shape, Line and Guide tools otherwise draw with a drag: a shape, line or arrow
// in the middle of the frame, or a guide through it. What is added is selected, so the inspector (or the arrow keys,
// for a guide) can then size and place it.

export type DrawDeps = { seconds(): number; color(): string | undefined };

// The current Shape or Line tool's shape at the playhead, on a shapes track, lasting the length Settings gives new
// text. It is selected and the tool goes back to Selection, as after a drag. False when nothing was added.
export function addShapeInMiddle(store: EditorStore, deps: DrawDeps): boolean {
  const state = store.getState();
  if (!state.canEdit || state.gesture !== null) return false;
  const tool = state.tool === "shape" ? state.shapeTool : state.tool === "line" ? state.lineTool : null;
  if (!tool) return false;
  const { doc } = state;
  const placement = placeShape(
    doc,
    tool,
    centredGeometry(tool, { width: doc.width, height: doc.height }),
    { start: state.playhead, duration: Math.max(1, Math.round(deps.seconds() * doc.fps)), trackId: state.selection.trackId, color: deps.color() },
    () => nanoid(10),
  );
  if (!placement.ok) {
    state.notify("error", MESSAGES.noRoom);
    return false;
  }
  if (!state.edit(placement.ops, "add shape").ok) return false;
  const next = store.getState();
  next.select(placement.clipIds);
  next.setTool("select");
  return true;
}

// A guide through the middle of the frame: down it (axis x) or across it (axis y). It is selected, and the guides
// are shown. One already there is selected instead of a second on top of it. False when nothing was added or found.
export function addGuideInMiddle(store: EditorStore, axis: "x" | "y"): boolean {
  const state = store.getState();
  if (!state.canEdit || state.gesture !== null) return false;
  state.setShowGuides(true);
  const there = state.doc.guides?.find((g) => g.axis === axis && g.at === 0.5);
  if (there) {
    state.selectGuide(there.id);
    return true;
  }
  const id = nanoid(10);
  if (!state.edit([{ op: "add_guide", guide: { id, axis, at: 0.5 } }], "add guide").ok) return false;
  store.getState().selectGuide(id);
  return true;
}
