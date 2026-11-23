import { LIMITS } from "@/lib/limits";
import { arrowEnds, arrowFromEnds, arrowPlace, arrowPointWithin, arrowShare, arrowThrough } from "@/lib/timeline/shapes";
import type { ArrowPoint, OpInput, ShapeClip } from "@/lib/timeline";
import type { Point, Size } from "./board";

// The handles an arrow (or line) has on the preview instead of a box's: its two ends; one on each point its line
// passes through ("point:0" is the first after the tail); and a smaller one in the middle of each stretch between
// them, which adds a point there when dragged ("add:0" puts it first).
export type ArrowGrip = "tail" | "tip" | `point:${number}` | `add:${number}`;

export type ArrowGripKind = "end" | "point" | "add";

// What a grip is, and which point it names (for an "add" grip, where the new point goes).
export function readGrip(grip: ArrowGrip): { kind: ArrowGripKind; index: number } {
  if (grip === "tail" || grip === "tip") return { kind: "end", index: -1 };
  const [kind, index] = grip.split(":");
  return { kind: kind === "add" ? "add" : "point", index: Number(index) };
}

// Whether the arrow can take one more point.
export function hasRoomForPoint(clip: ShapeClip): boolean {
  return arrowThrough(clip).length < LIMITS.arrowPoints;
}

const ANGLE_STEP = 15;
const round = (n: number, places: number) => Number(n.toFixed(places)) + 0;

// What an update writes for the arrow's points. An arrow still curved by the older `bend` is moved over to points, so
// it never carries both.
function pointsPatch(clip: ShapeClip, points: ArrowPoint[]): Record<string, unknown> {
  return { points, ...((clip.bend ?? 0) !== 0 && { bend: 0 }) };
}

// The change that puts the dragged handle at p, in project pixels.
// A point goes exactly where the pointer is, anywhere on or off the frame, and the line passes through it; the other
// points and both ends stay where they are. An "add" grip puts a new point there, between its two neighbours.
// An end follows the pointer while the other end and every point stay put on the frame (Shift keeps the straight run
// between the two ends to 15° steps). The arrow keeps its scale, so its length is the distance over the scale.
export function arrowGripOps(clip: ShapeClip, grip: ArrowGrip, p: Point, frame: Size, shift: boolean): OpInput[] {
  const t = clip.transform;
  const through = arrowThrough(clip);
  const { kind, index } = readGrip(grip);
  if (kind !== "end") {
    const at = arrowPointWithin(arrowShare(clip, frame, p));
    const points = [...through];
    if (kind === "add") {
      if (!hasRoomForPoint(clip)) return [];
      points.splice(Math.max(0, Math.min(points.length, index)), 0, at);
    } else {
      if (index < 0 || index >= points.length) return [];
      points[index] = at;
    }
    return [{ op: "update_clip", clipId: clip.id, patch: pointsPatch(clip, points) }];
  }
  const { tail, tip } = arrowEnds(clip, frame);
  const fixed = grip === "tail" ? tip : tail;
  let moved = p;
  if (shift) {
    const length = Math.hypot(p.x - fixed.x, p.y - fixed.y);
    const step = (ANGLE_STEP * Math.PI) / 180;
    const angle = Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / step) * step;
    moved = { x: fixed.x + Math.cos(angle) * length, y: fixed.y + Math.sin(angle) * length };
  }
  const a = grip === "tail" ? arrowFromEnds(moved, fixed, frame) : arrowFromEnds(fixed, moved, frame);
  const transform = { x: round(a.x, 4), y: round(a.y, 4), rotation: round(a.rotation, 2) };
  const width = round(Math.max(1, a.width / t.scale), 2);
  // Points are kept in arrow lengths from the arrow's middle, so each is worked out again for the arrow as it will be.
  const next = { width, transform: { ...t, ...transform } };
  const points = through.map((q) => arrowPointWithin(arrowShare(next, frame, arrowPlace(clip, frame, q))));
  return [{ op: "update_clip", clipId: clip.id, patch: { transform, width, ...(points.length > 0 && pointsPatch(clip, points)) } }];
}

// The change that takes one point off the line; the rest stay where they are.
export function removePointOps(clip: ShapeClip, index: number): OpInput[] {
  const through = arrowThrough(clip);
  if (index < 0 || index >= through.length) return [];
  return [{ op: "update_clip", clipId: clip.id, patch: pointsPatch(clip, through.filter((_, i) => i !== index)) }];
}

// The change that makes the line straight again: no points, no bend. Nothing when it already is.
export function straightenOps(clip: ShapeClip): OpInput[] {
  if (arrowThrough(clip).length === 0) return [];
  return [{ op: "update_clip", clipId: clip.id, patch: { ...((clip.points?.length ?? 0) > 0 && { points: [] }), ...((clip.bend ?? 0) !== 0 && { bend: 0 }) } }];
}
