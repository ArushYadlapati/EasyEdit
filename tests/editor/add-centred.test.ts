import { expect, it } from "vitest";
import { addGuideInMiddle, addShapeInMiddle } from "@/lib/editor/add-centred";
import { createClipboard } from "@/lib/editor/clipboard";
import { runCommand } from "@/lib/editor/run-command";
import { centredGeometry } from "@/lib/editor/shape-draw";
import { findClip } from "@/lib/editor/store";
import type { ShapeClip } from "@/lib/timeline";
import { makeStore } from "./fixtures";

const deps = { seconds: () => 2, color: () => "#ff0000" };
const selected = (store: ReturnType<typeof makeStore>) => findClip(store.getState().doc, store.getState().selection.clipIds[0])!.clip as ShapeClip;

it("puts a shape in the middle of the frame, a third of its shorter side across; a line across its middle third", () => {
  const frame = { width: 1080, height: 1920 };
  expect(centredGeometry("rect", frame)).toEqual({ x: 0.5, y: 0.5, width: 360, height: 360, rotation: 0 });
  expect(centredGeometry("arrow", frame)).toEqual({ x: 0.5, y: 0.5, width: 360, height: 0, rotation: 0 });
  // A triangle keeps its even-sided proportions.
  const triangle = centredGeometry("triangle", frame);
  expect(triangle.width).toBe(360);
  expect(triangle.height).toBeCloseTo(360 / (2 / Math.sqrt(3)), 1);
});

it("adds the Shape tool's shape at the playhead, selected, as one change, and goes back to Selection", () => {
  const store = makeStore();
  store.getState().setTool("shape");
  store.getState().setShapeTool("ellipse");
  store.getState().seek(15);
  expect(addShapeInMiddle(store, deps)).toBe(true);
  const clip = selected(store);
  expect(clip).toMatchObject({ type: "shape", shape: "ellipse", start: 15, duration: 60, transform: { x: 0.5, y: 0.5 } });
  expect(store.getState().queue.at(-1)?.label).toBe("add shape");
  expect(store.getState().tool).toBe("select");
});

it("adds the Line tool's line or arrow the same way", () => {
  const store = makeStore();
  store.getState().setTool("line");
  store.getState().setLineTool("arrow");
  expect(addShapeInMiddle(store, deps)).toBe(true);
  expect(selected(store)).toMatchObject({ shape: "arrow", width: 360, transform: { x: 0.5, y: 0.5, rotation: 0 } });
});

it("adds nothing for another tool or for someone who can't edit", () => {
  const store = makeStore();
  expect(addShapeInMiddle(store, deps)).toBe(false);
  const viewer = makeStore({ canEdit: false });
  viewer.getState().setTool("shape");
  expect(addShapeInMiddle(viewer, deps)).toBe(false);
  expect(viewer.getState().queue).toEqual([]);
});

it("adds a guide through the middle, selected and shown, and picks the one already there rather than a second", () => {
  const store = makeStore();
  store.getState().setShowGuides(false);
  expect(addGuideInMiddle(store, "x")).toBe(true);
  const [guide] = store.getState().doc.guides!;
  expect(guide).toMatchObject({ axis: "x", at: 0.5 });
  expect(store.getState().guideId).toBe(guide.id);
  expect(store.getState().showGuides).toBe(true);
  store.getState().selectGuide(null);
  expect(addGuideInMiddle(store, "x")).toBe(true);
  expect(store.getState().doc.guides).toHaveLength(1);
  expect(store.getState().guideId).toBe(guide.id);
  expect(addGuideInMiddle(store, "y")).toBe(true);
  expect(store.getState().doc.guides!.map((g) => g.axis)).toEqual(["x", "y"]);
});

it("Enter adds what the tool draws, and Shift+Enter a guide across, from the shortcut table", () => {
  const store = makeStore();
  const ctx = { store, clipboard: createClipboard(), openShortcuts: () => {}, drawing: deps };
  runCommand("add-in-middle", ctx);
  expect(store.getState().queue).toEqual([]); // Selection draws nothing
  store.getState().setTool("guide");
  runCommand("add-in-middle", ctx);
  runCommand("add-guide-across", ctx);
  expect(store.getState().doc.guides!.map((g) => g.axis)).toEqual(["x", "y"]);
  store.getState().setTool("shape");
  runCommand("add-in-middle", ctx);
  expect(selected(store).type).toBe("shape");
});
