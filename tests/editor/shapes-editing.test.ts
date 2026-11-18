import { describe, expect, it } from "vitest";
import { arrowEndOps } from "@/lib/editor/arrow-drag";
import { beginCanvasDrag, resolveCanvasDrag } from "@/lib/editor/canvas-drag";
import { canvasItems, hitTest, onShape } from "@/lib/editor/canvas-geometry";
import { newTrackIndex } from "@/lib/editor/placement";
import { drawnGeometry, placeShape, redrawShape, snapPoint } from "@/lib/editor/shape-draw";
import { DEFAULT_TRANSFORM, applyOps, prepareOps, arrowEnds, createEmptyDoc, newShapeClip, type OpInput, type ShapeClip, type TimelineDoc } from "@/lib/timeline";

const frame = { width: 1080, height: 1920 };
const keys = { shift: false, centre: false };
let n = 0;
const genId = () => `id${++n}`;
const sizer = { source: () => null, measure: () => 100 };

function shape(tool: "rect" | "ellipse" | "line" | "arrow", extra: Partial<ShapeClip> = {}): ShapeClip {
  return { id: "s", ...newShapeClip(tool, { start: 0, duration: 60, x: 0.5, y: 0.5, width: 400, height: 200 }, frame), ...extra };
}
function docWith(clip: ShapeClip): TimelineDoc {
  const doc = createEmptyDoc("short_9x16");
  return applyOps(doc, [
    { op: "add_track", track: { id: "s1", kind: "shape", name: "Shapes 1" }, index: 1 },
    { op: "add_clip", trackId: "s1", clip },
  ]).doc;
}

describe("drawing with the Shape tool", () => {
  it("a box spans the press and the pointer; Shift squares it; Alt draws it from its middle", () => {
    expect(drawnGeometry("rect", { x: 100, y: 100 }, { x: 300, y: 200 }, keys, frame)).toEqual({ x: round4(200 / 1080), y: round4(150 / 1920), width: 200, height: 100, rotation: 0 });
    expect(drawnGeometry("rect", { x: 100, y: 100 }, { x: 300, y: 200 }, { shift: true, centre: false }, frame)).toMatchObject({ width: 200, height: 200 });
    expect(drawnGeometry("ellipse", { x: 540, y: 960 }, { x: 640, y: 1010 }, { shift: false, centre: true }, frame)).toMatchObject({ x: 0.5, y: 0.5, width: 200, height: 100 });
    // Dragged up and left works the same way.
    expect(drawnGeometry("rect", { x: 300, y: 200 }, { x: 100, y: 100 }, keys, frame)).toMatchObject({ width: 200, height: 100 });
  });

  it("an arrow runs from the press to the pointer; Shift keeps it to 15° steps", () => {
    const g = drawnGeometry("arrow", { x: 100, y: 100 }, { x: 400, y: 500 }, keys, frame);
    expect(g).toMatchObject({ width: 500, height: 0 });
    expect(g.rotation).toBeCloseTo(53.13, 1);
    expect(drawnGeometry("arrow", { x: 100, y: 100 }, { x: 400, y: 120 }, { shift: true, centre: false }, frame).rotation).toBe(0);
  });

  it("snaps a point to the frame's edges, middle and the guides shown", () => {
    expect(snapPoint({ x: 543, y: 4 }, frame, [], 6)).toEqual({ x: 540, y: 0 });
    expect(snapPoint({ x: 300, y: 700 }, frame, [{ id: "g", axis: "x", at: 0.28 }], 6).x).toBeCloseTo(302.4);
    expect(snapPoint({ x: 300, y: 700 }, frame, [], 6)).toEqual({ x: 300, y: 700 });
  });

  it("the first shape makes a Shapes track just under the text track; the next one shares it", () => {
    const doc = createEmptyDoc("short_9x16"); // video, text, audio
    const g = drawnGeometry("rect", { x: 100, y: 100 }, { x: 300, y: 200 }, keys, frame);
    const placed = placeShape(doc, "rect", g, { start: 0, duration: 90, trackId: null }, genId);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const add = placed.ops[0] as Extract<OpInput, { op: "add_track" }>;
    expect(add).toMatchObject({ op: "add_track", track: { kind: "shape", name: "Shapes 1" }, index: 1 });
    const next = applyOps(doc, prepareOps(placed.ops)).doc;
    expect(next.tracks.map((t) => t.kind)).toEqual(["video", "shape", "text", "audio"]);
    const again = placeShape(next, "arrow", g, { start: 90, duration: 90, trackId: null }, genId);
    expect(again.ok && again.ops.map((o) => o.op)).toEqual(["add_clip"]);
  });

  it("with no text track, the first Shapes track goes in front of the pictures", () => {
    expect(newTrackIndex({ tracks: [{ kind: "video" }, { kind: "overlay" }, { kind: "audio" }] }, "shape")).toBe(2);
    expect(newTrackIndex({ tracks: [{ kind: "video" }, { kind: "shape" }, { kind: "text" }] }, "shape")).toBe(2);
  });

  it("redrawing keeps the chosen track and changes only the geometry", () => {
    const doc = createEmptyDoc("short_9x16");
    const g = drawnGeometry("arrow", { x: 100, y: 100 }, { x: 200, y: 100 }, keys, frame);
    const placed = placeShape(doc, "arrow", g, { start: 0, duration: 90, trackId: null, color: "#123456" }, genId);
    if (!placed.ok) throw new Error("no room");
    const redrawn = redrawShape(placed.ops, { x: 0.25, y: 0.25, width: 300, height: 0, rotation: 90 });
    const clip = (redrawn.find((o) => o.op === "add_clip") as Extract<OpInput, { op: "add_clip" }>).clip as ShapeClip;
    expect(clip).toMatchObject({ width: 300, height: 0, stroke: "#123456", transform: { x: 0.25, y: 0.25, rotation: 90 } });
    expect(redrawn[0]).toEqual(placed.ops[0]);
  });
});

describe("an arrow's handles", () => {
  it("moving the tip keeps the tail where it was", () => {
    const clip = shape("arrow");
    const before = arrowEnds(clip, frame);
    const [op] = arrowEndOps(clip, "tip", { x: before.tail.x, y: before.tail.y + 300 }, frame, false) as Extract<OpInput, { op: "update_clip" }>[];
    const patch = op.patch as { transform: { x: number; y: number; rotation: number }; width: number };
    const after = arrowEnds({ ...clip, width: patch.width, transform: { ...clip.transform, ...patch.transform } }, frame);
    expect(after.tail.x).toBeCloseTo(before.tail.x, 0);
    expect(after.tail.y).toBeCloseTo(before.tail.y, 0);
    expect(after.tip.y).toBeCloseTo(before.tail.y + 300, 0);
    expect(patch.width).toBeCloseTo(300, 1);
  });

  it("the middle sets the bend as a share of the length, at most a half", () => {
    const clip = shape("arrow"); // 400 long, flat, centred at 540, 960
    expect(arrowEndOps(clip, "bend", { x: 540, y: 1060 }, frame, false)).toEqual([{ op: "update_clip", clipId: "s", patch: { bend: 0.25 } }]);
    expect(arrowEndOps(clip, "bend", { x: 540, y: 2000 }, frame, false)[0]).toMatchObject({ patch: { bend: 0.5 } });
  });
});

describe("picking shapes", () => {
  it("an outline-only box is picked on its outline, not in its middle, until it is selected", () => {
    const doc = docWith(shape("rect"));
    const items = canvasItems(doc, 10, sizer);
    expect(hitTest(items, { x: 540, y: 960 }, 4)).toBeNull();
    expect(hitTest(items, { x: 740, y: 960 }, 4)?.clipId).toBe("s"); // the right edge
    expect(hitTest(items, { x: 540, y: 960 }, 4, { keep: ["s"] })?.clipId).toBe("s");
  });

  it("a filled shape is picked anywhere inside", () => {
    expect(onShape(shape("ellipse", { fill: "#000000" }), { x: 0, y: 0 }, 0)).toBe(true);
    expect(onShape(shape("ellipse"), { x: 0, y: 0 }, 0)).toBe(false);
    expect(onShape(shape("ellipse"), { x: 200, y: 0 }, 0)).toBe(true);
  });

  it("an arrow is picked near its line, all along it", () => {
    const arrow = shape("arrow");
    expect(onShape(arrow, { x: -150, y: 3 }, 2)).toBe(true);
    expect(onShape(arrow, { x: 13, y: -4 }, 2)).toBe(true);
    expect(onShape(arrow, { x: 0, y: 60 }, 2)).toBe(false);
  });
});

describe("resizing a box", () => {
  it("changes its width and height, never its scale, so the outline keeps its thickness", () => {
    const doc = docWith(shape("rect"));
    const item = canvasItems(doc, 10, sizer)[0];
    const drag = beginCanvasDrag(doc, item, "e", { x: 740, y: 960 })!;
    const result = resolveCanvasDrag(drag, { pointer: { x: 840, y: 960 }, shift: false, crop: false, centre: false, snapping: false, snapPx: 0 });
    const op = result.ops[0] as Extract<OpInput, { op: "update_clip" }>;
    expect(op.patch).toMatchObject({ width: 500 });
    expect(op.patch).not.toHaveProperty("height");
    expect((op.patch.transform as Record<string, unknown>).scale).toBeUndefined();
    const next = applyOps(doc, prepareOps(result.ops)).doc;
    const clip = next.tracks[1].clips[0] as ShapeClip;
    expect(clip).toMatchObject({ width: 500, height: 200, strokeWidth: 11, transform: { ...DEFAULT_TRANSFORM, x: clip.transform.x } });
  });

  it("a corner resizes freely; Shift keeps the box's shape", () => {
    const doc = docWith(shape("rect"));
    const item = canvasItems(doc, 10, sizer)[0];
    const drag = beginCanvasDrag(doc, item, "se", { x: 740, y: 1060 })!;
    const free = resolveCanvasDrag(drag, { pointer: { x: 840, y: 1060 }, shift: false, crop: false, centre: false, snapping: false, snapPx: 0 });
    expect((free.ops[0] as Extract<OpInput, { op: "update_clip" }>).patch).toMatchObject({ width: 500 });
    expect((free.ops[0] as Extract<OpInput, { op: "update_clip" }>).patch).not.toHaveProperty("height");
    const kept = resolveCanvasDrag(drag, { pointer: { x: 840, y: 1060 }, shift: true, crop: false, centre: false, snapping: false, snapPx: 0 });
    const patch = (kept.ops[0] as Extract<OpInput, { op: "update_clip" }>).patch as { width: number; height: number };
    expect(patch.width / patch.height).toBeCloseTo(2, 2);
  });
});

function round4(v: number) {
  return Math.round(v * 10_000) / 10_000;
}
