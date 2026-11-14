import { cropRect } from "@/lib/render/compositor";
import { NO_CROP, stretchOf } from "@/lib/timeline/presets";
import type { Crop, OpInput, TimelineDoc } from "@/lib/timeline";
import type { Point, Size } from "./board";
import { HANDLE_SIGNS, rectPoint, toLocal, toWorld, type CanvasItem, type Handle } from "./canvas-geometry";
import { CROP_MIN_SHOWN } from "./clip-box";
import { findClip } from "./store";

// Moving, turning, resizing and cropping a clip on the preview by hand. A drag records the clip as it was at the press;
// resolveCanvasDrag turns a pointer position (project pixels) and the modifier keys held now into ops, starting again
// from the press every time, so Shift, Alt and the free key can change mid-drag. Whether the ops may be applied is
// left to applyOps. Snapping only pulls a clip toward a centre line or a quarter turn it is closer to than at the
// press, so a clip that starts on one, or moves away from one, follows the pointer.

export const SCALE_MIN = 0.01, SCALE_MAX = 10, ROTATE_STEP = 15, ROTATE_SNAP_DEG = 3, SNAP_CSS_PX = 6;

export type Grip = Handle | "rotate" | "body";

export type CanvasDrag =
  | { type: "move"; clipId: string; grab: Point; from: { x: number; y: number }; frame: Size }
  | { type: "rotate"; clipId: string; grab: Point; center: Point; from: number }
  | { type: "resize"; clipId: string; handle: Handle; grab: Point; item: CanvasItem; frame: Size; from: { scale: number; stretch: number; crop: Crop }; drawn: Point | null };

// Null when the clip is gone or its track is locked. drawn: where a handle clamped into the pane was drawn, if it was.
export function beginCanvasDrag(doc: TimelineDoc, item: CanvasItem, grip: Grip, grab: Point, drawn?: Point): CanvasDrag | null {
  const found = findClip(doc, item.clipId);
  if (!found || found.track.locked) return null;
  const t = found.clip.transform;
  const frame = { width: doc.width, height: doc.height };
  if (grip === "body") return { type: "move", clipId: item.clipId, grab, from: { x: t.x, y: t.y }, frame };
  if (grip === "rotate") return { type: "rotate", clipId: item.clipId, grab, center: item.center, from: t.rotation };
  return {
    type: "resize",
    clipId: item.clipId,
    handle: grip,
    grab,
    item,
    frame,
    from: { scale: t.scale, stretch: stretchOf(t), crop: { ...(t.crop ?? NO_CROP) } },
    drawn: drawn ?? null,
  };
}

// pointer in project pixels; free: the free key is held (Cmd, or away from a Mac Ctrl or the Windows key), so a
// handle drag without Shift or Alt squashes or stretches; snapPx: how near the frame's centre lines a moved centre snaps, in project pixels.
export type CanvasDragInput = { pointer: Point; shift: boolean; alt: boolean; free: boolean; snapping: boolean; snapPx: number };

// guides: the frame's centre lines a moved clip's centre snapped onto, in project pixels.
export type CanvasDragResult = { ops: OpInput[]; label: "position change" | "size change" | "crop"; guides: { x: number | null; y: number | null } };

const NO_GUIDES = { x: null, y: null };

export function resolveCanvasDrag(drag: CanvasDrag, input: CanvasDragInput): CanvasDragResult {
  if (drag.type === "move") return resolveMove(drag, input);
  if (drag.type === "rotate") return resolveRotate(drag, input);
  return input.alt ? resolveCrop(drag, input) : resolveResize(drag, input);
}

const round4 = (n: number) => Number(n.toFixed(4)) + 0; // + 0 turns −0 into 0
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const degrees = (radians: number) => (radians * 180) / Math.PI;

function update(clipId: string, transform: Record<string, unknown>): OpInput[] {
  return [{ op: "update_clip", clipId, patch: { transform } }];
}

// The keys whose value, rounded to 4 places, differs from the press: a value that only rounds the same stays as it was.
function changedKeys(next: Record<string, number>, from: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(next)) {
    const rounded = round4(value);
    if (rounded !== round4(from[key])) out[key] = rounded;
  }
  return out;
}

function resolveMove(drag: Extract<CanvasDrag, { type: "move" }>, input: CanvasDragInput): CanvasDragResult {
  const { width: W, height: H } = drag.frame;
  let dx = input.pointer.x - drag.grab.x;
  let dy = input.pointer.y - drag.grab.y;
  // Shift keeps the larger movement; the other axis is held where it was, and never snaps onto a centre line.
  let held: "x" | "y" | null = null;
  if (input.shift) {
    if (Math.abs(dx) >= Math.abs(dy)) [dy, held] = [0, "y"];
    else [dx, held] = [0, "x"];
  }
  let x = drag.from.x + dx / W;
  let y = drag.from.y + dy / H;
  // A centre snaps onto a centre line within snapPx of it, and only when it is closer to the line than at the press.
  const snaps = (now: number, from: number, size: number) =>
    input.snapping && Math.abs(now - 0.5) * size <= input.snapPx && Math.abs(now - 0.5) < Math.abs(from - 0.5);
  const guides: CanvasDragResult["guides"] = { x: null, y: null };
  if (held !== "x" && snaps(x, drag.from.x, W)) {
    x = 0.5;
    guides.x = W / 2;
  }
  if (held !== "y" && snaps(y, drag.from.y, H)) {
    y = 0.5;
    guides.y = H / 2;
  }
  const patch = changedKeys({ x, y }, drag.from);
  return { ops: Object.keys(patch).length ? update(drag.clipId, patch) : [], label: "position change", guides };
}

// Into (−180, 180], to a tenth of a degree.
function tenth(deg: number): number {
  const r = Math.round((deg - 360 * Math.ceil((deg - 180) / 360)) * 10) / 10;
  return (r <= -180 ? r + 360 : r) + 0;
}

// How far apart two turns are, the short way round, in degrees.
function apart(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

function resolveRotate(drag: Extract<CanvasDrag, { type: "rotate" }>, input: CanvasDragInput): CanvasDragResult {
  const { center: c, grab } = drag;
  const p = input.pointer;
  let theta = drag.from + degrees(Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(grab.y - c.y, grab.x - c.x));
  if (input.shift) {
    theta = Math.round(theta / ROTATE_STEP) * ROTATE_STEP;
  } else if (input.snapping) {
    // A turn snaps onto a quarter turn within ROTATE_SNAP_DEG of it, and only when closer to it than at the press.
    const quarter = Math.round(theta / 90) * 90;
    if (Math.abs(theta - quarter) <= ROTATE_SNAP_DEG && Math.abs(theta - quarter) < apart(drag.from, quarter)) theta = quarter;
  }
  const rotation = tenth(theta);
  const unchanged = rotation === drag.from || rotation === tenth(drag.from);
  return { ops: unchanged ? [] : update(drag.clipId, { rotation }), label: "position change", guides: NO_GUIDES };
}

// The clip's own axes on screen, y down: u across, v down.
function axes(rotation: number): { u: Point; v: Point } {
  const a = (rotation * Math.PI) / 180;
  return { u: { x: Math.cos(a), y: Math.sin(a) }, v: { x: -Math.sin(a), y: Math.cos(a) } };
}

// A drawn factor stays in [min(SCALE_MIN, now), max(SCALE_MAX, now)], so a clip already past a limit does not jump.
const factorRange = (now: number) => ({ lo: Math.min(SCALE_MIN, now), hi: Math.max(SCALE_MAX, now) });

type Resize = Extract<CanvasDrag, { type: "resize" }>;

// A side or corner moves, the opposite side or corner stays put in the clip's turned axes. The shape is kept unless
// the free key is held without Shift.
function resolveResize(drag: Resize, input: CanvasDragInput): CanvasDragResult {
  const { item, frame } = drag;
  const { hx, hy } = HANDLE_SIGNS[drag.handle];
  const { u, v } = axes(item.rotation);
  const d = { x: input.pointer.x - drag.grab.x, y: input.pointer.y - drag.grab.y };
  const K = item.rect;
  const kw = K.right - K.left;
  const kh = K.bottom - K.top;
  const { sx, sy } = item;
  const G = rectPoint(K, hx, hy);
  const A = rectPoint(K, -hx, -hy);
  const rangeX = factorRange(sx);
  const rangeY = factorRange(sy);

  // Each axis's factor as the dragged side alone would make it.
  const freeX = hx !== 0 ? (sx * kw + hx * dot(d, u)) / kw : sx;
  const freeY = hy !== 0 ? (sy * kh + hy * dot(d, v)) / kh : sy;

  let nx: number;
  let ny: number;
  if (input.shift || !input.free) {
    let k: number;
    if (hx !== 0 && hy !== 0) {
      // A corner: the pointer's movement projected onto the box's diagonal.
      const g = toWorld(item, G);
      const a = toWorld(item, A);
      const D = { x: g.x - a.x, y: g.y - a.y };
      k = dot({ x: D.x + d.x, y: D.y + d.y }, D) / dot(D, D);
    } else {
      k = hx !== 0 ? freeX / sx : freeY / sy;
    }
    k = clamp(k, Math.max(rangeX.lo / sx, rangeY.lo / sy), Math.min(rangeX.hi / sx, rangeY.hi / sy));
    nx = k * sx;
    ny = k * sy;
  } else {
    nx = clamp(freeX, rangeX.lo, rangeX.hi);
    ny = clamp(freeY, rangeY.lo, rangeY.hi);
  }

  // The new centre keeps the anchor where it was.
  const anchor = toWorld(item, A);
  const ax = nx * A.x;
  const ay = ny * A.y;
  const cx = anchor.x - (ax * u.x + ay * v.x);
  const cy = anchor.y - (ax * u.y + ay * v.y);
  const next = { x: cx / frame.width, y: cy / frame.height, scale: ny, stretch: nx / ny };
  const from = { x: item.center.x / frame.width, y: item.center.y / frame.height, scale: drag.from.scale, stretch: drag.from.stretch };
  const patch = changedKeys(next, from);
  return { ops: Object.keys(patch).length ? update(drag.clipId, patch) : [], label: "size change", guides: NO_GUIDES };
}

const SIDES = ["left", "top", "right", "bottom"] as const;
type Side = (typeof SIDES)[number];
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };

// The most a side may cut while the opposite side's cut stays: CROP_MIN_SHOWN of the clip is always kept.
const sideMax = (crop: Crop, side: Side) => Math.max(0, 1 - crop[OPPOSITE[side]] - CROP_MIN_SHOWN);

// The sides a handle moves: hx 1 the right, −1 the left; hy 1 the bottom, −1 the top.
const sideX = (hx: number): Side | null => (hx > 0 ? "right" : hx < 0 ? "left" : null);
const sideY = (hy: number): Side | null => (hy > 0 ? "bottom" : hy < 0 ? "top" : null);

// Where a handle drawn clamped into the pane cuts the clip's full box, side by side, never less than the press's cut.
function startWhereDrawn(drag: Resize, drawn: Point): Crop {
  const { item } = drag;
  const F = item.full;
  const fw = F.right - F.left;
  const fh = F.bottom - F.top;
  const local = toLocal(item, drawn);
  const at: Record<Side, number> = {
    left: (local.x - F.left) / fw,
    right: (F.right - local.x) / fw,
    top: (local.y - F.top) / fh,
    bottom: (F.bottom - local.y) / fh,
  };
  const { hx, hy } = HANDLE_SIGNS[drag.handle];
  const crop = { ...drag.from.crop };
  for (const side of [sideX(hx), sideY(hy)]) {
    if (side) crop[side] = Math.max(crop[side], Math.min(at[side], sideMax(crop, side)));
  }
  return crop;
}

// Alt: the dragged sides cut the clip, which stays where it is; Alt+Shift keeps the kept part's shape.
function resolveCrop(drag: Resize, input: CanvasDragInput): CanvasDragResult {
  const { item } = drag;
  const { hx, hy } = HANDLE_SIGNS[drag.handle];
  const { u, v } = axes(item.rotation);
  const d = { x: input.pointer.x - drag.grab.x, y: input.pointer.y - drag.grab.y };
  const moved = d.x !== 0 || d.y !== 0;
  const base = moved && drag.drawn ? startWhereDrawn(drag, drag.drawn) : drag.from.crop;
  const F = item.full;
  const fw = F.right - F.left;
  const fh = F.bottom - F.top;
  const dxShare = dot(d, u) / item.sx / fw;
  const dyShare = dot(d, v) / item.sy / fh;
  const xSide = sideX(hx);
  const ySide = sideY(hy);

  const crop = { ...base };
  if (!input.shift) {
    // e cuts right − δx, w left + δx, s bottom − δy, n top + δy.
    if (xSide) crop[xSide] = base[xSide] - hx * dxShare;
    if (ySide) crop[ySide] = base[ySide] - hy * dyShare;
  } else {
    // The kept part's shares, its middle on each axis, and the cut on the side opposite each dragged one.
    const kw = 1 - base.left - base.right;
    const kh = 1 - base.top - base.bottom;
    const mx = (base.left + 1 - base.right) / 2;
    const my = (base.top + 1 - base.bottom) / 2;
    const oppX = hx > 0 ? base.left : base.right;
    const oppY = hy > 0 ? base.top : base.bottom;
    let k: number;
    let hi: number;
    if (xSide && ySide) {
      // A corner: the movement projected onto the kept part's diagonal, in project pixels.
      const K = cropRect(F, base);
      const g = toWorld(item, rectPoint(K, hx, hy));
      const a = toWorld(item, rectPoint(K, -hx, -hy));
      const D = { x: g.x - a.x, y: g.y - a.y };
      k = dot({ x: D.x + d.x, y: D.y + d.y }, D) / dot(D, D);
      hi = Math.min((1 - oppX) / kw, (1 - oppY) / kh);
    } else if (xSide) {
      // A side: its own share's ratio; the other axis grows or shrinks about the kept middle, up to the full box.
      k = (kw + hx * dxShare) / kw;
      hi = Math.min((1 - oppX) / kw, (2 * my) / kh, (2 * (1 - my)) / kh);
    } else {
      k = (kh + hy * dyShare) / kh;
      hi = Math.min((1 - oppY) / kh, (2 * mx) / kw, (2 * (1 - mx)) / kw);
    }
    // Every side stays in range: at least CROP_MIN_SHOWN kept each way, never cut below 0.
    k = clamp(k, Math.min(hi, Math.max(CROP_MIN_SHOWN / kw, CROP_MIN_SHOWN / kh)), hi);
    if (xSide) crop[xSide] = 1 - oppX - k * kw;
    else {
      crop.left = mx - (k * kw) / 2;
      crop.right = 1 - mx - (k * kw) / 2;
    }
    if (ySide) crop[ySide] = 1 - oppY - k * kh;
    else {
      crop.top = my - (k * kh) / 2;
      crop.bottom = 1 - my - (k * kh) / 2;
    }
  }

  // Each side that moved stays in [0, 1 − opposite − CROP_MIN_SHOWN]. A free drag never moves a side's opposite, and
  // Alt+Shift's k already keeps every side in range.
  const next = { ...crop };
  for (const side of SIDES) next[side] = round4(crop[side] === base[side] ? crop[side] : clamp(crop[side], 0, sideMax(crop, side)));
  const same = SIDES.every((side) => next[side] === round4(drag.from.crop[side]));
  return { ops: same ? [] : update(drag.clipId, { crop: next }), label: "crop", guides: NO_GUIDES };
}
