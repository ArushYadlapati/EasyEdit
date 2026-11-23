import { describe, expect, it } from "vitest";
import { arrowGripOps, hasRoomForPoint, readGrip, removePointOps, straightenOps } from "@/lib/editor/arrow-drag";
import { beginCanvasDrag, resolveCanvasDrag } from "@/lib/editor/canvas-drag";
import { canvasItems, hitTest, onShape } from "@/lib/editor/canvas-geometry";
import { newTrackIndex } from "@/lib/editor/placement";
import { drawnGeometry, placeShape, redrawShape, snapPoint } from "@/lib/editor/shape-draw";
import { DEFAULT_TRANSFORM, applyOps, prepareOps, arrowEnds, arrowPlace, arrowThrough, createEmptyDoc, newShapeClip, type OpInput, type ShapeClip, type ShapeTool, type TimelineDoc } from "@/lib/timeline";

const frame = { width: 1080, height: 1920 };
const keys = { shift: false, centre: false };
let n = 0;
const genId = () => `id${++n}`;
const sizer = { source: () => null, measure: () => 100 };

function shape(tool: ShapeTool, extra: Partial<ShapeClip> = {}): ShapeClip {
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

  it("Shift draws a many-sided shape with even sides", () => {
    const shift = { shift: true, centre: false };
    const triangle = drawnGeometry("triangle", { x: 100, y: 100 }, { x: 300, y: 120 }, shift, frame);
    expect(triangle.width).toBe(200);
    expect(triangle.height).toBeCloseTo(173.21, 1); // equilateral: its height is √3 / 2 of its side
    const star = drawnGeometry("star", { x: 100, y: 100 }, { x: 120, y: 300 }, shift, frame);
    expect(star.height).toBeCloseTo(200, 1);
    expect(star.width).toBeCloseTo(210.29, 1);
    expect(drawnGeometry("diamond", { x: 100, y: 100 }, { x: 300, y: 200 }, shift, frame)).toMatchObject({ width: 200, height: 200 });
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
    const [op] = arrowGripOps(clip, "tip", { x: before.tail.x, y: before.tail.y + 300 }, frame, false) as Extract<OpInput, { op: "update_clip" }>[];
    const patch = op.patch as { transform: { x: number; y: number; rotation: number }; width: number };
    const after = arrowEnds({ ...clip, width: patch.width, transform: { ...clip.transform, ...patch.transform } }, frame);
    expect(after.tail.x).toBeCloseTo(before.tail.x, 0);
    expect(after.tail.y).toBeCloseTo(before.tail.y, 0);
    expect(after.tip.y).toBeCloseTo(before.tail.y + 300, 0);
    expect(patch.width).toBeCloseTo(300, 1);
  });

  // What a change does to the arrow, so a test can read where its points land on the frame.
  const after = (clip: ShapeClip, ops: OpInput[]): ShapeClip => {
    const doc = applyOps(docWith(clip), prepareOps(ops)).doc;
    return doc.tracks.find((t) => t.id === "s1")!.clips[0] as ShapeClip;
  };
  const placed = (clip: ShapeClip) => arrowThrough(clip).map((p) => arrowPlace(clip, frame, p));

  it("names its handles: the two ends, each point, and the gaps a point can be added in", () => {
    expect(readGrip("tail")).toEqual({ kind: "end", index: -1 });
    expect(readGrip("tip")).toEqual({ kind: "end", index: -1 });
    expect(readGrip("point:2")).toEqual({ kind: "point", index: 2 });
    expect(readGrip("add:0")).toEqual({ kind: "add", index: 0 });
  });

  it("dragging the small middle handle of a straight arrow adds a point right where the pointer is", () => {
    const clip = shape("arrow"); // 400 long, flat, centred at 540, 960
    expect(arrowGripOps(clip, "add:0", { x: 540, y: 1060 }, frame, false)).toEqual([{ op: "update_clip", clipId: "s", patch: { points: [{ x: 0, y: 0.25 }] } }]);
    // Anywhere: off to the side, past the tip, far below. Nothing holds it to the arrow's middle.
    expect(arrowGripOps(clip, "add:0", { x: 840, y: 360 }, frame, false)).toEqual([{ op: "update_clip", clipId: "s", patch: { points: [{ x: 0.75, y: -1.5 }] } }]);
    const next = after(clip, arrowGripOps(clip, "add:0", { x: 100, y: 1800 }, frame, false));
    expect(placed(next)[0].x).toBeCloseTo(100, 0);
    expect(placed(next)[0].y).toBeCloseTo(1800, 0);
  });

  it("a point follows the pointer and the others stay where they are", () => {
    const clip = shape("arrow", { points: [{ x: -0.25, y: 0.25 }, { x: 0.25, y: -0.25 }] });
    const [op] = arrowGripOps(clip, "point:1", { x: 700, y: 1200 }, frame, false) as Extract<OpInput, { op: "update_clip" }>[];
    expect(op.patch).toEqual({ points: [{ x: -0.25, y: 0.25 }, { x: 0.4, y: 0.6 }] });
    expect(arrowGripOps(clip, "point:5", { x: 700, y: 1200 }, frame, false)).toEqual([]);
  });

  it("a new point goes between the two it was dragged from", () => {
    const clip = shape("arrow", { points: [{ x: -0.25, y: 0.25 }, { x: 0.25, y: -0.25 }] });
    const patchOf = (grip: "add:0" | "add:1" | "add:2") =>
      (arrowGripOps(clip, grip, { x: 540, y: 960 }, frame, false)[0] as Extract<OpInput, { op: "update_clip" }>).patch.points;
    expect(patchOf("add:0")).toEqual([{ x: 0, y: 0 }, { x: -0.25, y: 0.25 }, { x: 0.25, y: -0.25 }]);
    expect(patchOf("add:1")).toEqual([{ x: -0.25, y: 0.25 }, { x: 0, y: 0 }, { x: 0.25, y: -0.25 }]);
    expect(patchOf("add:2")).toEqual([{ x: -0.25, y: 0.25 }, { x: 0.25, y: -0.25 }, { x: 0, y: 0 }]);
  });

  it("a point works the same on an arrow that is turned and scaled", () => {
    const clip = shape("arrow", { transform: { ...DEFAULT_TRANSFORM, x: 0.5, y: 0.5, rotation: 90, scale: 2 } });
    const next = after(clip, arrowGripOps(clip, "add:0", { x: 300, y: 500 }, frame, false));
    expect(placed(next)[0].x).toBeCloseTo(300, 0);
    expect(placed(next)[0].y).toBeCloseTo(500, 0);
  });

  it("an arrow curved by an older bend is moved over to points by its first drag", () => {
    const clip = shape("arrow", { bend: 0.25 });
    expect(arrowGripOps(clip, "point:0", { x: 640, y: 1160 }, frame, false)).toEqual([{ op: "update_clip", clipId: "s", patch: { points: [{ x: 0.25, y: 0.5 }], bend: 0 } }]);
    const next = after(clip, arrowGripOps(clip, "point:0", { x: 640, y: 1160 }, frame, false));
    expect(arrowThrough(next)).toEqual([{ x: 0.25, y: 0.5 }]);
  });

  it("moving an end leaves every point where it was on the frame", () => {
    const clip = shape("arrow", { points: [{ x: -0.25, y: 0.25 }, { x: 0.25, y: -0.5 }] });
    const before = placed(clip);
    const next = after(clip, arrowGripOps(clip, "tip", { x: 900, y: 1500 }, frame, false));
    expect(arrowEnds(next, frame).tip.x).toBeCloseTo(900, 0);
    expect(arrowEnds(next, frame).tail.x).toBeCloseTo(arrowEnds(clip, frame).tail.x, 0);
    placed(next).forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i].x, 0);
      expect(p.y).toBeCloseTo(before[i].y, 0);
    });
    // A straight arrow's end drag writes no points at all.
    const [plain] = arrowGripOps(shape("arrow"), "tip", { x: 900, y: 1500 }, frame, false) as Extract<OpInput, { op: "update_clip" }>[];
    expect(Object.keys(plain.patch).sort()).toEqual(["transform", "width"]);
  });

  it("holds a point within reach of the arrow, and stops adding at twelve", () => {
    const clip = shape("arrow", { width: 10 });
    const [op] = arrowGripOps(clip, "add:0", { x: 540, y: 1900 }, frame, false) as Extract<OpInput, { op: "update_clip" }>[];
    expect(op.patch.points).toEqual([{ x: 0, y: 10 }]);
    const full = shape("arrow", { points: Array.from({ length: 12 }, (_, i) => ({ x: i / 30, y: 0.1 })) });
    expect(hasRoomForPoint(full)).toBe(false);
    expect(hasRoomForPoint(clip)).toBe(true);
    expect(arrowGripOps(full, "add:3", { x: 540, y: 1000 }, frame, false)).toEqual([]);
  });

  it("removes one point, or all of them", () => {
    const clip = shape("arrow", { points: [{ x: -0.25, y: 0.25 }, { x: 0, y: 0.5 }, { x: 0.25, y: -0.25 }] });
    expect(removePointOps(clip, 1)).toEqual([{ op: "update_clip", clipId: "s", patch: { points: [{ x: -0.25, y: 0.25 }, { x: 0.25, y: -0.25 }] } }]);
    expect(removePointOps(clip, 7)).toEqual([]);
    expect(straightenOps(clip)).toEqual([{ op: "update_clip", clipId: "s", patch: { points: [] } }]);
    expect(straightenOps(shape("arrow", { bend: 0.2 }))).toEqual([{ op: "update_clip", clipId: "s", patch: { bend: 0 } }]);
    expect(removePointOps(shape("arrow", { bend: 0.2 }), 0)).toEqual([{ op: "update_clip", clipId: "s", patch: { points: [], bend: 0 } }]);
    expect(straightenOps(shape("arrow"))).toEqual([]);
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

  it("an arrow through points is picked along its curve, not along the straight run it left", () => {
    const curved = shape("line", { points: [{ x: 0, y: 0.5 }] }); // its middle 200 below
    expect(onShape(curved, { x: 0, y: 200 }, 2)).toBe(true);
    expect(onShape(curved, { x: 0, y: 0 }, 2)).toBe(false);
    const doc = docWith(curved);
    const items = canvasItems(doc, 10, sizer);
    expect(hitTest(items, { x: 540, y: 1160 }, 4)?.clipId).toBe("s");
    expect(hitTest(items, { x: 540, y: 960 }, 4)).toBeNull();
  });

  it("a triangle is picked on its sides, and inside only when it is filled", () => {
    const outline = shape("triangle"); // 400 × 200: top corner at 0, −100
    expect(onShape(outline, { x: 0, y: 40 }, 2)).toBe(false);
    expect(onShape(outline, { x: 0, y: 100 }, 2)).toBe(true); // its base
    expect(onShape(outline, { x: -100, y: 0 }, 2)).toBe(true); // halfway up its left side
    expect(onShape(shape("triangle", { fill: "#000000" }), { x: 0, y: 40 }, 2)).toBe(true);
    // The box's top corners are outside the triangle even when it is filled.
    expect(onShape(shape("triangle", { fill: "#000000" }), { x: -180, y: -80 }, 2)).toBe(false);
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
