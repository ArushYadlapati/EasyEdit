import { DEFAULT_TRANSFORM } from "./presets";
import type { ArrowHead, ArrowHeads, ShapeClip, ShapeKind } from "./types";

// What the editor offers: a line is an arrow with no heads.
export type ShapeTool = "rect" | "ellipse" | "line" | "arrow";
export const SHAPE_TOOLS: readonly ShapeTool[] = ["rect", "ellipse", "line", "arrow"];
export const SHAPE_TOOL_NAME: Record<ShapeTool, string> = { rect: "Rectangle", ellipse: "Ellipse", line: "Line", arrow: "Arrow" };

// The highlight yellow text emphasis already uses, for a space with no brand colour.
export const SHAPE_COLOR = "#FFD400";
export const ARROW_DEFAULTS = { heads: "end" as ArrowHeads, head: "triangle" as ArrowHead, headSize: 4, bend: 0 };
// The bend "Curved" sets on a straight arrow.
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

// "Rectangle", "Ellipse", "Line" or "Arrow".
export function shapeName(clip: ShapeClip): string {
  return SHAPE_TOOL_NAME[shapeToolOf(clip)];
}

export function shapeToolOf(clip: ShapeClip): ShapeTool {
  return clip.shape === "arrow" ? (isLine(clip) ? "line" : "arrow") : clip.shape;
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

// The middle control point of an arrow's curve, in its own units: endpoints at (±length/2, 0). A quadratic curve's
// middle sits halfway to its control point, so the control is twice the bend out.
export function arrowControlY(clip: ShapeClip): number {
  return 2 * arrowLook(clip).bend * clip.width;
}

// Where an arrow's curve is at t (0 tail .. 1 tip), in its own units.
export function arrowPoint(clip: ShapeClip, t: number): { x: number; y: number } {
  const half = clip.width / 2;
  const c = arrowControlY(clip);
  const u = 1 - t;
  return { x: -half * u * u + half * t * t, y: 2 * u * t * c };
}

// The arrow's direction of travel at t, as an angle in radians.
export function arrowAngle(clip: ShapeClip, t: number): number {
  const half = clip.width / 2;
  const c = arrowControlY(clip);
  const dx = 2 * (1 - t) * half + 2 * t * half; // derivative of x: constant L for a centred control
  const dy = 2 * (1 - 2 * t) * c;
  return Math.atan2(dy, dx);
}

// How far a head reaches across its line, each side: half its width.
export function headHalfWidth(clip: ShapeClip): number {
  const look = arrowLook(clip);
  if (clip.shape !== "arrow" || look.heads === "none") return clip.strokeWidth / 2;
  const length = look.headSize * clip.strokeWidth;
  return look.head === "bar" ? length / 2 : length * 0.6;
}

// The shape's box in its own units, centred on 0, 0: what selection outlines and hit tests use. A box or ellipse is
// its width by height; an arrow spans its length and reaches as far sideways as its curve and heads do.
export function shapeBox(clip: ShapeClip): { left: number; top: number; right: number; bottom: number } {
  if (clip.shape !== "arrow") return { left: -clip.width / 2, top: -clip.height / 2, right: clip.width / 2, bottom: clip.height / 2 };
  const reach = headHalfWidth(clip);
  const mid = arrowControlY(clip) / 2; // the curve's farthest point sideways
  return { left: -clip.width / 2, top: Math.min(0, mid) - reach, right: clip.width / 2, bottom: Math.max(0, mid) + reach };
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
