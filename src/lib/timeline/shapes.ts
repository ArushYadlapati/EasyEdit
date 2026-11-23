import { LIMITS } from "@/lib/limits";
import { pathBounds, segmentsThrough, type Pt, type Segment } from "./arrow-path";
import { DEFAULT_TRANSFORM } from "./presets";
import type { ArrowHead, ArrowHeads, ArrowPoint, ShapeClip, ShapeKind } from "./types";

// What the editor offers to draw: every kind of shape, with a line as its own choice (an arrow with no heads).
export type ShapeTool = Exclude<ShapeKind, "arrow"> | "line" | "arrow";
// The Shape tool's own list: the shapes with an inside. A line and an arrow each have a tool of their own.
export type BoxShape = Exclude<ShapeKind, "arrow">;
export const BOX_SHAPES: readonly BoxShape[] = ["rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star"];
export const SHAPE_TOOLS: readonly ShapeTool[] = [...BOX_SHAPES, "line", "arrow"];
export const SHAPE_TOOL_NAME: Record<ShapeTool, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  diamond: "Diamond",
  pentagon: "Pentagon",
  hexagon: "Hexagon",
  star: "Star",
  line: "Line",
  arrow: "Arrow",
};

// The highlight yellow text emphasis already uses, for a space with no brand colour.
export const SHAPE_COLOR = "#FFD400";
export const ARROW_DEFAULTS = { heads: "end" as ArrowHeads, head: "triangle" as ArrowHead, headSize: 4, bend: 0 };
// How far to the side "Curved" puts a straight arrow's first point, in arrow lengths.
export const CURVED_BEND = 0.25;

export function arrowLook(clip: ShapeClip): typeof ARROW_DEFAULTS {
  return {
    heads: clip.heads ?? ARROW_DEFAULTS.heads,
    head: clip.head ?? ARROW_DEFAULTS.head,
    headSize: clip.headSize ?? ARROW_DEFAULTS.headSize,
    bend: clip.bend ?? ARROW_DEFAULTS.bend,
  };
}

export function isLine(clip: ShapeClip): boolean {
  return clip.shape === "arrow" && (clip.heads ?? ARROW_DEFAULTS.heads) === "none";
}

// "Rectangle", "Star", "Line", "Arrow" and so on.
export function shapeName(clip: ShapeClip): string {
  return SHAPE_TOOL_NAME[shapeToolOf(clip)];
}

export function shapeToolOf(clip: ShapeClip): ShapeTool {
  return clip.shape === "arrow" ? (isLine(clip) ? "line" : "arrow") : clip.shape;
}

// Whether a shape has corners to round: every one but an ellipse and an arrow.
export function takesRadius(kind: ShapeKind): boolean {
  return kind !== "ellipse" && kind !== "arrow";
}

// The stroke width a new shape gets: 1% of the frame's shorter side, at least 2 px.
export function defaultStrokeWidth(frame: { width: number; height: number }): number {
  return Math.max(2, Math.round(Math.min(frame.width, frame.height) / 100));
}

// The kind stored for a tool, and the fields only that tool sets.
function kindOf(tool: ShapeTool): ShapeKind {
  return tool === "line" ? "arrow" : tool;
}

// A new shape of this tool, centred at x, y (shares of the frame) with this size in project pixels. For a line or an
// arrow, width is its length and rotation (degrees) its direction from tail to tip.
export function newShapeClip(
  tool: ShapeTool,
  at: { start: number; duration: number; x: number; y: number; width: number; height: number; rotation?: number },
  frame: { width: number; height: number },
  color: string = SHAPE_COLOR,
): Omit<ShapeClip, "id"> {
  const kind = kindOf(tool);
  return {
    type: "shape",
    start: at.start,
    duration: at.duration,
    transform: { ...DEFAULT_TRANSFORM, x: at.x, y: at.y, rotation: at.rotation ?? 0 },
    shape: kind,
    width: Math.max(1, at.width),
    height: kind === "arrow" ? 0 : Math.max(1, at.height),
    stroke: color,
    strokeWidth: defaultStrokeWidth(frame),
    dash: "solid",
    ...(kind === "arrow" && { heads: tool === "line" ? "none" : ARROW_DEFAULTS.heads }),
  };
}

// The corners of a many-sided shape on a circle of radius 1, the first at the top, going clockwise. A star alternates
// its five tips with five inner corners.
const STAR_INNER = 0.382; // where a five-pointed star's inner corners sit when its sides run straight tip to tip
function unitCorners(kind: "triangle" | "diamond" | "pentagon" | "hexagon" | "star"): Pt[] {
  if (kind === "triangle") return [{ x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
  if (kind === "diamond") return [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  // A hexagon lies flat: a corner at each side, so its first corner is the top left one.
  const count = kind === "pentagon" ? 5 : kind === "hexagon" ? 6 : 10;
  const first = kind === "hexagon" ? -120 : -90;
  return Array.from({ length: count }, (_, i) => {
    const a = ((first + (360 / count) * i) * Math.PI) / 180;
    const r = kind === "star" && i % 2 === 1 ? STAR_INNER : 1;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

// A many-sided shape's corners in its own units, centred on 0, 0 and stretched to fill width by height exactly. Null
// for a rect, an ellipse and an arrow, which are not drawn corner to corner.
export function shapeCorners(clip: Pick<ShapeClip, "shape" | "width" | "height">): Pt[] | null {
  const kind = clip.shape;
  if (kind === "rect" || kind === "ellipse" || kind === "arrow") return null;
  const unit = unitCorners(kind);
  const xs = unit.map((p) => p.x);
  const ys = unit.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const w = Math.max(...xs) - left;
  const h = Math.max(...ys) - top;
  return unit.map((p) => ({ x: ((p.x - left) / w - 0.5) * clip.width, y: ((p.y - top) / h - 0.5) * clip.height }));
}

// A shape's width over its height when its sides are all the same length (a square, a circle, a regular pentagon):
// what Shift keeps while one is drawn.
export function regularAspect(tool: ShapeTool): number {
  if (tool === "triangle") return 2 / Math.sqrt(3);
  if (tool !== "pentagon" && tool !== "hexagon" && tool !== "star") return 1;
  const unit = unitCorners(tool);
  const xs = unit.map((p) => p.x);
  const ys = unit.map((p) => p.y);
  return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
}

// The points an arrow's line passes through between its tail and tip, in shares of its length: its own, else the one
// its bend stands for, else none.
export function arrowThrough(clip: ShapeClip): ArrowPoint[] {
  if (clip.points && clip.points.length > 0) return clip.points;
  const bend = clip.bend ?? 0;
  return bend === 0 ? [] : [{ x: 0, y: bend }];
}

// Every place the line passes through, tail and tip included, in the arrow's own units.
export function arrowKnots(clip: ShapeClip): Pt[] {
  const length = clip.width;
  return [{ x: -length / 2, y: 0 }, ...arrowThrough(clip).map((p) => ({ x: p.x * length, y: p.y * length })), { x: length / 2, y: 0 }];
}

// The arrow's line, tail to tip, in its own units.
export function arrowPath(clip: ShapeClip): Segment[] {
  return segmentsThrough(arrowKnots(clip));
}

// A point kept within reach of the arrow and to four decimals: about a twentieth of a pixel on a 500 px arrow.
export function arrowPointWithin(p: Pt): ArrowPoint {
  const hold = (v: number) => Number(Math.max(-LIMITS.arrowPointReach, Math.min(LIMITS.arrowPointReach, v)).toFixed(4)) + 0;
  return { x: hold(p.x), y: hold(p.y) };
}

// How far a head reaches across its line, each side: half its width.
export function headHalfWidth(clip: ShapeClip): number {
  const look = arrowLook(clip);
  if (clip.shape !== "arrow" || look.heads === "none") return clip.strokeWidth / 2;
  const length = look.headSize * clip.strokeWidth;
  return look.head === "bar" ? length / 2 : length * 0.6;
}

// The shape's box in its own units, centred on 0, 0: what selection outlines and hit tests use. A box, ellipse or
// many-sided shape is its width by height; an arrow spans its line, wherever its points take it, and reaches as far
// to the sides as its heads do.
export function shapeBox(clip: ShapeClip): { left: number; top: number; right: number; bottom: number } {
  if (clip.shape !== "arrow") return { left: -clip.width / 2, top: -clip.height / 2, right: clip.width / 2, bottom: clip.height / 2 };
  const reach = headHalfWidth(clip);
  const line = pathBounds(arrowPath(clip));
  return { left: line.left, top: line.top - reach, right: line.right, bottom: line.bottom + reach };
}

// An arrow from tail to tip, both in project pixels: its centre (shares of the frame), length and rotation.
export function arrowFromEnds(tail: { x: number; y: number }, tip: { x: number; y: number }, frame: { width: number; height: number }) {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  return {
    x: (tail.x + tip.x) / 2 / frame.width,
    y: (tail.y + tip.y) / 2 / frame.height,
    width: Math.max(1, Math.hypot(dx, dy)),
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

// An arrow's tail and tip in project pixels, from its centre, length, rotation and scale.
export function arrowEnds(clip: ShapeClip, frame: { width: number; height: number }, t = clip.transform) {
  const cx = t.x * frame.width;
  const cy = t.y * frame.height;
  const a = (t.rotation * Math.PI) / 180;
  const half = (clip.width / 2) * t.scale;
  const ux = Math.cos(a) * half;
  const uy = Math.sin(a) * half;
  return { tail: { x: cx - ux, y: cy - uy }, tip: { x: cx + ux, y: cy + uy } };
}

// A place given in arrow lengths from the arrow's middle (as its points are), in project pixels.
export function arrowPlace(clip: Pick<ShapeClip, "width" | "transform">, frame: { width: number; height: number }, p: Pt): Pt {
  const t = clip.transform;
  const a = (t.rotation * Math.PI) / 180;
  const x = p.x * clip.width * t.scale;
  const y = p.y * clip.width * t.scale;
  return { x: t.x * frame.width + x * Math.cos(a) - y * Math.sin(a), y: t.y * frame.height + x * Math.sin(a) + y * Math.cos(a) };
}

// The other way: a place in project pixels, in arrow lengths from the arrow's middle.
export function arrowShare(clip: Pick<ShapeClip, "width" | "transform">, frame: { width: number; height: number }, p: Pt): Pt {
  const t = clip.transform;
  const a = (t.rotation * Math.PI) / 180;
  const dx = p.x - t.x * frame.width;
  const dy = p.y - t.y * frame.height;
  const unit = clip.width * t.scale || 1;
  return { x: (dx * Math.cos(a) + dy * Math.sin(a)) / unit, y: (-dx * Math.sin(a) + dy * Math.cos(a)) / unit };
}
