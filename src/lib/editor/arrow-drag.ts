import { arrowEnds, arrowFromEnds } from "@/lib/timeline/shapes";
import type { OpInput, ShapeClip } from "@/lib/timeline";
import type { Point, Size } from "./board";

// The handles an arrow (or line) has on the preview instead of a box's: its two ends, and its middle, which bends it.
export type ArrowGrip = "tail" | "tip" | "bend";

const ANGLE_STEP = 15;
const round = (n: number, places: number) => Number(n.toFixed(places)) + 0;

// The change that puts the dragged end (or the middle) at p, in project pixels; the other end stays where it was.
// An end drag keeps the arrow's scale, so its length is the distance over the scale. Shift keeps the arrow's angle to
// 15° steps from the end that stays. The middle sets the bend: how far the curve's middle sits off the straight line,
// as a share of the arrow's length, between −0.5 and 0.5.
export function arrowEndOps(clip: ShapeClip, grip: ArrowGrip, p: Point, frame: Size, shift: boolean): OpInput[] {
  const t = clip.transform;
  const { tail, tip } = arrowEnds(clip, frame);
  if (grip === "bend") {
    const dx = tip.x - tail.x;
    const dy = tip.y - tail.y;
    const length = Math.hypot(dx, dy) || 1;
    const mid = { x: (tail.x + tip.x) / 2, y: (tail.y + tip.y) / 2 };
    // The arrow's own +y in project pixels: its direction turned a quarter clockwise.
    const nx = -dy / length;
    const ny = dx / length;
    const bend = Math.max(-0.5, Math.min(0.5, ((p.x - mid.x) * nx + (p.y - mid.y) * ny) / length));
    return [{ op: "update_clip", clipId: clip.id, patch: { bend: round(bend, 3) } }];
  }
  const fixed = grip === "tail" ? tip : tail;
  let moved = p;
  if (shift) {
    const length = Math.hypot(p.x - fixed.x, p.y - fixed.y);
    const step = (ANGLE_STEP * Math.PI) / 180;
    const angle = Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / step) * step;
    moved = { x: fixed.x + Math.cos(angle) * length, y: fixed.y + Math.sin(angle) * length };
  }
  const a = grip === "tail" ? arrowFromEnds(moved, fixed, frame) : arrowFromEnds(fixed, moved, frame);
  return [
    {
      op: "update_clip",
      clipId: clip.id,
      patch: {
        transform: { x: round(a.x, 4), y: round(a.y, 4), rotation: round(a.rotation, 2) },
        width: round(Math.max(1, a.width / t.scale), 2),
      },
    },
  ];
}
