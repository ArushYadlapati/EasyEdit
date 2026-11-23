import { arrowFromEnds, newShapeClip, regularAspect, type ShapeTool } from "@/lib/timeline/shapes";
import type { Clip, Guide, OpInput, ShapeClip, TimelineDoc } from "@/lib/timeline";
import type { Point, Size } from "./board";
import { guideLines } from "./guides";
import { placeClips, type Placement } from "./placement";

// Drawing a shape with the Shape, Line or Arrow tool: a drag from where it was pressed to where the pointer is, in
// project pixels. A box, ellipse or many-sided shape spans the two points (Shift: its even-sided form, a square, a
// circle, a regular pentagon; centre: the press is its middle); a line or arrow runs from the press (its tail) to the
// pointer (its tip), Shift keeping its angle to 15° steps.

export type DrawnGeometry = { x: number; y: number; width: number; height: number; rotation: number };

const ANGLE_STEP = 15;

export function drawnGeometry(tool: ShapeTool, from: Point, to: Point, keys: { shift: boolean; centre: boolean }, frame: Size): DrawnGeometry {
  if (tool === "line" || tool === "arrow") {
    let tip = to;
    if (keys.shift) {
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const step = (ANGLE_STEP * Math.PI) / 180;
      const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
      tip = { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
    }
    const a = arrowFromEnds(from, tip, frame);
    return { x: round4(a.x), y: round4(a.y), width: round2(a.width), height: 0, rotation: round2(a.rotation) };
  }
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (keys.shift) {
    // The smallest box of the shape's even-sided proportions that holds the drag.
    const aspect = regularAspect(tool);
    const across = Math.max(Math.abs(dx), Math.abs(dy) * aspect);
    dx = (dx < 0 ? -1 : 1) * across;
    dy = (dy < 0 ? -1 : 1) * (across / aspect);
  }
  const centre = keys.centre ? from : { x: from.x + dx / 2, y: from.y + dy / 2 };
  const width = Math.abs(dx) * (keys.centre ? 2 : 1);
  const height = Math.abs(dy) * (keys.centre ? 2 : 1);
  return { x: round4(centre.x / frame.width), y: round4(centre.y / frame.height), width: round2(Math.max(1, width)), height: round2(Math.max(1, height)), rotation: 0 };
}

// A point pulled onto the frame's edges, its centre lines and the guides shown, each axis on its own, when one is
// within px project pixels.
export function snapPoint(p: Point, frame: Size, guides: readonly Guide[], px: number): Point {
  const placed = guideLines(guides, frame);
  const nearest = (v: number, lines: number[]) => {
    let best = v;
    let gap = px;
    for (const line of lines) {
      const d = Math.abs(line - v);
      if (d <= gap) {
        gap = d;
        best = line;
      }
    }
    return best;
  };
  return {
    x: nearest(p.x, [0, frame.width / 2, frame.width, ...placed.x]),
    y: nearest(p.y, [0, frame.height / 2, frame.height, ...placed.y]),
  };
}

// The ops that add the drawn shape at the playhead on a shapes track: the selected one when it has room, else the
// first one with room, else a new one (see newTrackIndex for where it goes).
export function placeShape(
  doc: TimelineDoc,
  tool: ShapeTool,
  geometry: DrawnGeometry,
  at: { start: number; duration: number; trackId: string | null; color?: string },
  genId: () => string,
): Placement {
  const clip = { id: "new", ...newShapeClip(tool, { start: at.start, duration: at.duration, ...geometry }, doc, at.color) } as Clip;
  const wished = doc.tracks.find((t) => t.id === at.trackId);
  return placeClips(doc, [{ clip, trackId: wished?.kind === "shape" ? wished.id : null, kind: "shape" }], genId);
}

// The same ops with the shape redrawn to new geometry: the track it goes on stays the one chosen at the start.
export function redrawShape(ops: OpInput[], geometry: DrawnGeometry): OpInput[] {
  return ops.map((op) => {
    if (op.op !== "add_clip" || op.clip.type !== "shape") return op;
    const clip = op.clip as ShapeClip;
    return {
      ...op,
      clip: {
        ...clip,
        width: geometry.width,
        height: clip.shape === "arrow" ? 0 : geometry.height,
        transform: { ...clip.transform, x: geometry.x, y: geometry.y, rotation: geometry.rotation },
      },
    };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
