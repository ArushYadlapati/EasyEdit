import { cropRect } from "@/lib/render/compositor";
import { NO_CROP, stretchOf } from "@/lib/timeline/presets";
import type { Crop, OpInput, TimelineDoc } from "@/lib/timeline";
import type { Point, Size } from "./board";
import { HANDLE_SIGNS, corners, rectPoint, toLocal, toWorld, type CanvasItem, type Handle } from "./canvas-geometry";
import { CROP_MIN_SHOWN } from "./clip-box";
import { findClip } from "./store";

// Moving, turning, resizing and cropping a clip on the preview by hand. A drag records the clip as it was at the press;
// resolveCanvasDrag turns a pointer position (project pixels) and the modifier keys held now into ops, starting again
// from the press every time, so the keys can change mid-drag. Whether the ops may be applied is
// left to applyOps. Snapping only pulls a clip toward a line or a quarter turn it is closer to than at the press, so a
// clip that starts on one, or moves away from one, follows the pointer. A moved clip's sides and middle snap onto the
// frame's edges and centre lines, and onto the sides and middles of the other clips drawn: side to side, middle to
// middle.

export const SCALE_MIN = 0.01, SCALE_MAX = 10, ROTATE_STEP = 15, ROTATE_SNAP_DEG = 3, SNAP_CSS_PX = 6;

export type Grip = Handle | "rotate" | "body";

export type CanvasDrag =
  | { type: "move"; clipId: string; grab: Point; from: { x: number; y: number }; frame: Size; box: Box; lines: Lines }
  | { type: "rotate"; clipId: string; grab: Point; center: Point; from: number }
  | { type: "resize"; clipId: string; handle: Handle; grab: Point; item: CanvasItem; frame: Size; from: { scale: number; stretch: number; crop: Crop }; drawn: Point | null };

// What of a moved clip snaps, on each axis, as offsets in project pixels from its centre: the sides of the box its kept
// part fills on screen (turned, that box holds the corners), and its middles (the box's middle and the centre itself).
export type Box = { x: Parts; y: Parts };
// Where a moved clip may snap, in project pixels. Like snaps onto like: a side onto the frame's edges and the other
// clips' sides, a middle onto the other clips' middles; the frame's centre line takes either.
export type Lines = { x: Parts; y: Parts };
export type Parts = { sides: number[]; middles: number[] };

// The box a clip's kept part fills on screen, straight.
function bounds(item: CanvasItem): { left: number; top: number; right: number; bottom: number } {
  const pts = corners(item);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

const unique = (ns: number[]) => [...new Set(ns.map((n) => round4(n)))];
const parts = (sides: number[], middles: number[]): Parts => ({ sides: unique(sides), middles: unique(middles) });

function boxOf(item: CanvasItem): Box {
  const b = bounds(item);
  const { x: cx, y: cy } = item.center;
  return {
    x: parts([b.left - cx, b.right - cx], [0, (b.left + b.right) / 2 - cx]),
    y: parts([b.top - cy, b.bottom - cy], [0, (b.top + b.bottom) / 2 - cy]),
  };
}

// others: the clips drawn now; the dragged one, and any not seen (opacity 0), are left out.
function linesOf(item: CanvasItem, frame: Size, others: readonly CanvasItem[]): Lines {
  const x = { sides: [0, frame.width / 2, frame.width], middles: [frame.width / 2] };
  const y = { sides: [0, frame.height / 2, frame.height], middles: [frame.height / 2] };
  for (const other of others) {
    if (other.clipId === item.clipId || other.opacity === 0) continue;
    const b = bounds(other);
    x.sides.push(b.left, b.right);
    x.middles.push((b.left + b.right) / 2);
    y.sides.push(b.top, b.bottom);
    y.middles.push((b.top + b.bottom) / 2);
  }
  return { x: parts(x.sides, x.middles), y: parts(y.sides, y.middles) };
}

// Null when the clip is gone or its track is locked. drawn: where a handle clamped into the pane was drawn, if it was.
// others: the clips drawn now, whose sides and middles a moved clip snaps onto.
export function beginCanvasDrag(
  doc: TimelineDoc,
  item: CanvasItem,
  grip: Grip,
  grab: Point,
  drawn?: Point,
  others: readonly CanvasItem[] = [],
): CanvasDrag | null {
  const found = findClip(doc, item.clipId);
  if (!found || found.track.locked) return null;
  const t = found.clip.transform;
  const frame = { width: doc.width, height: doc.height };
  if (grip === "body") {
    return { type: "move", clipId: item.clipId, grab, from: { x: t.x, y: t.y }, frame, box: boxOf(item), lines: linesOf(item, frame, others) };
  }
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

// pointer in project pixels. shift: a move keeps to one axis, a turn steps by 15°, a handle drag squashes or stretches,
// and a crop keeps the kept part's shape. crop: a handle drag crops instead of resizing (Ctrl, or the clip menu's
// Crop). centre: a handle drag resizes about the box's middle, so the opposite side moves too (Alt, or Option on a
// Mac). snapPx: how near a line a moved clip's side or middle snaps, in project pixels.
export type CanvasDragInput = { pointer: Point; shift: boolean; crop: boolean; centre: boolean; snapping: boolean; snapPx: number };

// guides: the lines a moved clip snapped onto, one across and one down at most, in project pixels.
export type CanvasDragResult = { ops: OpInput[]; label: "position change" | "size change" | "crop"; guides: { x: number | null; y: number | null } };

const NO_GUIDES = { x: null, y: null };

export function resolveCanvasDrag(drag: CanvasDrag, input: CanvasDragInput): CanvasDragResult {
  if (drag.type === "move") return resolveMove(drag, input);
  if (drag.type === "rotate") return resolveRotate(drag, input);
  return input.crop ? resolveCrop(drag, input) : resolveResize(drag, input);
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
  // Shift keeps the larger movement; the other axis is held where it was, and never snaps.
  let held: "x" | "y" | null = null;
  if (input.shift) {
    if (Math.abs(dx) >= Math.abs(dy)) [dy, held] = [0, "y"];
    else [dx, held] = [0, "x"];
  }
  let x = drag.from.x + dx / W;
  let y = drag.from.y + dy / H;
  const guides: CanvasDragResult["guides"] = { x: null, y: null };
  if (input.snapping && held !== "x") {
    const s = snapAxis(x * W, drag.from.x * W, drag.box.x, drag.lines.x, input.snapPx);
    if (s) [x, guides.x] = [s.centre / W, s.line];
  }
  if (input.snapping && held !== "y") {
    const s = snapAxis(y * H, drag.from.y * H, drag.box.y, drag.lines.y, input.snapPx);
    if (s) [y, guides.y] = [s.centre / H, s.line];
  }
  const patch = changedKeys({ x, y }, drag.from);
  return { ops: Object.keys(patch).length ? update(drag.clipId, patch) : [], label: "position change", guides };
}

// The nearest line one of the box's parts comes within px of, its sides onto side lines and its middles onto middle
// lines, from a centre now at c (at the press, from), and the centre that puts it there. A part snaps only onto a line
// it is closer to than at the press. A tie goes to the side, then to the line listed first: the frame's before the
// other clips'.
function snapAxis(c: number, from: number, box: Parts, lines: Parts, px: number): { centre: number; line: number } | null {
  let best: { centre: number; line: number; gap: number } | null = null;
  for (const kind of ["sides", "middles"] as const) {
    for (const line of lines[kind]) {
      for (const o of box[kind]) {
        const gap = Math.abs(c + o - line);
        if (gap > px || gap >= Math.abs(from + o - line)) continue;
        if (!best || gap < best.gap) best = { centre: line - o, line, gap };
      }
    }
  }
  return best && { centre: best.centre, line: best.line };
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

// A side or corner moves and the opposite side or corner stays put in the clip's turned axes; with centre the box's
// middle stays put instead, so the opposite side moves the other way as far. The shape is kept unless Shift is held.
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
  // What stays put: the opposite side or corner, or the middle. The dragged side is reach from it along each axis.
  const A = input.centre ? rectPoint(K, 0, 0) : rectPoint(K, -hx, -hy);
  const reachX = input.centre ? kw / 2 : kw;
  const reachY = input.centre ? kh / 2 : kh;
  const rangeX = factorRange(sx);
  const rangeY = factorRange(sy);

  // Each axis's factor as the dragged side alone would make it.
  const freeX = hx !== 0 ? (sx * reachX + hx * dot(d, u)) / reachX : sx;
  const freeY = hy !== 0 ? (sy * reachY + hy * dot(d, v)) / reachY : sy;

  let nx: number;
  let ny: number;
  if (!input.shift) {
    let k: number;
    if (hx !== 0 && hy !== 0) {
      // A corner: the pointer's movement projected onto the line from what stays put to the corner.
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

  // The new centre keeps what stays put where it was.
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

// crop: the dragged sides cut the clip, which stays where it is; with Shift the kept part keeps its shape.
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
  // crop with Shift's k already keeps every side in range.
  const next = { ...crop };
  for (const side of SIDES) next[side] = round4(crop[side] === base[side] ? crop[side] : clamp(crop[side], 0, sideMax(crop, side)));
  const same = SIDES.every((side) => next[side] === round4(drag.from.crop[side]));
  return { ops: same ? [] : update(drag.clipId, { crop: next }), label: "crop", guides: NO_GUIDES };
}
