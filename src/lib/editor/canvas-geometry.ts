import { activeClips, type LocalRect } from "@/lib/render/compositor";
import { effectiveTransform } from "@/lib/timeline/keyframes";
import { stretchOf } from "@/lib/timeline/presets";
import type { ShapeClip, TimelineDoc } from "@/lib/timeline";
import { distanceToPath, distanceToStretch } from "@/lib/timeline/arrow-path";
import { arrowPath, headHalfWidth, shapeCorners } from "@/lib/timeline/shapes";
import type { Point, Size } from "./board";
import { clipRects, type Sizer } from "./clip-box";

// The preview's clips as boxes on the frame, and the mapping between project pixels, the screen and the overlay
// drawn over the board. Project pixels have y pointing down, so a positive rotation turns clockwise, as drawn.

// One clip as the compositor draws it: its centre, turn and drawn factors (sx = scale × stretch across, sy = scale
// down), its whole box and the part its crop keeps, both from the centre before scale, stretch and rotation.
export type CanvasItem = {
  clipId: string;
  trackId: string;
  type: "video" | "image" | "text" | "placeholder" | "shape" | "nest";
  slot?: string; // an empty slot's name
  shape?: ShapeClip; // a shape's clip, which picking and an arrow's end handles read
  locked: boolean;
  opacity: number;
  center: Point;
  rotation: number;
  sx: number;
  sy: number;
  full: LocalRect;
  rect: LocalRect;
};

// What is drawn at a frame, back to front: the last item is on top. Audio is never drawn.
export function canvasItems(doc: TimelineDoc, frame: number, sizer: Sizer): CanvasItem[] {
  const items: CanvasItem[] = [];
  for (const { track, clip } of activeClips(doc, frame)) {
    if (clip.type === "audio" || clip.type === "adjustment" || (clip.type === "placeholder" && clip.accepts === "audio")) continue;
    // Keyframes move the box with the picture, and a keyed crop cuts it. Transitions do not: they play for a moment
    // and the box stays at rest.
    const t = effectiveTransform(clip, frame);
    const rects = clipRects(doc, t === clip.transform ? clip : ({ ...clip, transform: t } as typeof clip), sizer);
    if (!rects) continue;
    items.push({
      clipId: clip.id,
      trackId: track.id,
      type: clip.type,
      ...(clip.type === "placeholder" && { slot: clip.slot.name }),
      ...(clip.type === "shape" && { shape: clip }),
      locked: track.locked,
      opacity: t.opacity,
      center: { x: t.x * doc.width, y: t.y * doc.height },
      rotation: t.rotation,
      sx: t.scale * stretchOf(t),
      sy: t.scale,
      full: rects.full,
      rect: rects.kept,
    });
  }
  return items;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

// A project point in the clip's own box: R(−θ)·(p − c), then x / sx and y / sy.
export function toLocal(item: CanvasItem, p: Point): Point {
  const a = radians(item.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - item.center.x;
  const dy = p.y - item.center.y;
  return { x: (dx * cos + dy * sin) / item.sx, y: (-dx * sin + dy * cos) / item.sy };
}

// A point of the clip's own box in project pixels: c + R(θ)·(sx·x, sy·y).
export function toWorld(item: CanvasItem, local: Point): Point {
  const a = radians(item.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const x = item.sx * local.x;
  const y = item.sy * local.y;
  return { x: item.center.x + x * cos - y * sin, y: item.center.y + x * sin + y * cos };
}

export type HitOptions = { includeLocked?: boolean; frame?: Size; keep?: readonly string[] };

// The top-most clip whose kept box, grown by slop project pixels on screen, holds the point. A clip at opacity 0 is
// never hit, and one on a locked track only with includeLocked. With frame given, a point outside the frame can hit
// only the clips in keep: the board there is drawn empty, so only a selected clip, whose outline shows, takes it.
export function hitTest(items: CanvasItem[], p: Point, slop = 0, opts: HitOptions = {}): CanvasItem | null {
  const { includeLocked = false, frame, keep = [] } = opts;
  const outside = frame !== undefined && (p.x < 0 || p.x > frame.width || p.y < 0 || p.y > frame.height);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.opacity === 0) continue;
    if (item.locked && !includeLocked) continue;
    if (outside && !keep.includes(item.clipId)) continue;
    const local = toLocal(item, p);
    const gx = slop / item.sx;
    const gy = slop / item.sy;
    const { left, top, right, bottom } = item.rect;
    if (local.x < left - gx || local.x > right + gx || local.y < top - gy || local.y > bottom + gy) continue;
    // A selected shape takes its whole box, so it can be dragged from anywhere in it.
    if (item.shape && !keep.includes(item.clipId) && !onShape(item.shape, local, gx)) continue;
    return item;
  }
  return null;
}

// Whether a point in a shape's own units lands on what it draws, within slop: an arrow's line or heads, wherever its
// points take it; a filled shape anywhere inside; an outline-only one only on its outline, so a box drawn round
// something leaves its middle to whatever is under it.
export function onShape(clip: ShapeClip, p: Point, slop: number): boolean {
  if (clip.shape === "arrow") {
    const reach = Math.max(clip.strokeWidth / 2, headHalfWidth(clip)) + slop;
    return distanceToPath(arrowPath(clip), p) <= reach;
  }
  const a = clip.width / 2;
  const b = clip.height / 2;
  const band = (clip.stroke ? clip.strokeWidth / 2 : 0) + slop;
  const corners = shapeCorners(clip);
  if (corners) {
    let toSide = Infinity;
    let inside = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
      const from = corners[j];
      const to = corners[i];
      toSide = Math.min(toSide, distanceToStretch(p, from, to));
      // A ray to the right crosses this side: an odd count of crossings is inside.
      if (from.y > p.y !== to.y > p.y && p.x < from.x + ((p.y - from.y) / (to.y - from.y)) * (to.x - from.x)) inside = !inside;
    }
    return toSide <= band || (inside && clip.fill != null);
  }
  if (clip.shape === "ellipse") {
    const r = Math.hypot(p.x / a, p.y / b);
    if (clip.fill) return r <= 1 + band / Math.min(a, b);
    return Math.abs(r - 1) * Math.min(a, b) <= band;
  }
  const outside = Math.max(Math.abs(p.x) - a, Math.abs(p.y) - b);
  if (clip.fill) return outside <= band;
  return Math.abs(outside) <= band;
}

// The kept box's corners in project pixels: nw, ne, se, sw.
export function corners(item: CanvasItem): [Point, Point, Point, Point] {
  const { left, top, right, bottom } = item.rect;
  return [
    toWorld(item, { x: left, y: top }),
    toWorld(item, { x: right, y: top }),
    toWorld(item, { x: right, y: bottom }),
    toWorld(item, { x: left, y: bottom }),
  ];
}

// The kept box's corners grown by cssPx screen pixels on every side, at k CSS pixels per project pixel: nw, ne, se,
// sw. The growth is divided by the clip's own scale on each axis, as hitTest's slop is, so a turned, stretched or
// cropped clip grows by the same screen distance all round. A clip scaled to nothing is left as it is.
export function outsetCorners(item: CanvasItem, cssPx: number, k: number): [Point, Point, Point, Point] {
  if (item.sx === 0 || item.sy === 0 || k === 0) return corners(item);
  const gx = cssPx / k / Math.abs(item.sx);
  const gy = cssPx / k / Math.abs(item.sy);
  const { left, top, right, bottom } = item.rect;
  return [
    toWorld(item, { x: left - gx, y: top - gy }),
    toWorld(item, { x: right + gx, y: top - gy }),
    toWorld(item, { x: right + gx, y: bottom + gy }),
    toWorld(item, { x: left - gx, y: bottom + gy }),
  ];
}

// The eight handles on a clip's kept box, by compass point, each with the way it points out of the box along the
// clip's own axes: hx across (−1 the left side, 1 the right), hy down (−1 the top, 1 the bottom), 0 the middle.
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLE_SIGNS: Record<Handle, { hx: -1 | 0 | 1; hy: -1 | 0 | 1 }> = {
  nw: { hx: -1, hy: -1 },
  n: { hx: 0, hy: -1 },
  ne: { hx: 1, hy: -1 },
  e: { hx: 1, hy: 0 },
  se: { hx: 1, hy: 1 },
  s: { hx: 0, hy: 1 },
  sw: { hx: -1, hy: 1 },
  w: { hx: -1, hy: 0 },
};

const HANDLES = Object.keys(HANDLE_SIGNS) as Handle[];

// The point of a box at a handle's signs: its right, left or middle across, and its bottom, top or middle down.
export function rectPoint(rect: LocalRect, hx: number, hy: number): Point {
  return {
    x: hx > 0 ? rect.right : hx < 0 ? rect.left : (rect.left + rect.right) / 2,
    y: hy > 0 ? rect.bottom : hy < 0 ? rect.top : (rect.top + rect.bottom) / 2,
  };
}

// The point of the kept box at a handle's signs, in project pixels, moved out by `out` along the clip's own axis
// through it: across for e and w, down for n and s. A corner is never moved.
function outFrom(item: CanvasItem, hx: number, hy: number, out: number): Point {
  const a = radians(item.rotation);
  const at = toWorld(item, rectPoint(item.rect, hx, hy));
  const by = hy === 0 ? hx * out : hx === 0 ? hy * out : 0;
  const axis = hy === 0 ? { x: Math.cos(a), y: Math.sin(a) } : { x: -Math.sin(a), y: Math.cos(a) };
  return { x: at.x + by * axis.x, y: at.y + by * axis.y };
}

// Where each handle is in project pixels: the eight on the kept box, then rotate, rotateOffset above the middle of the
// box's top edge along its up. push moves the side handles out along the clip's axes (e and w by push.ew, n and s by
// push.ns), so a thin box's side handles can sit just outside it; corners never move.
export function handlePoints(item: CanvasItem, rotateOffset: number, push = { ew: 0, ns: 0 }): { grip: Handle | "rotate"; at: Point }[] {
  const points: { grip: Handle | "rotate"; at: Point }[] = HANDLES.map((grip) => {
    const { hx, hy } = HANDLE_SIGNS[grip];
    return { grip, at: outFrom(item, hx, hy, hy === 0 ? push.ew : push.ns) };
  });
  points.push({ grip: "rotate", at: outFrom(item, 0, -1, rotateOffset) });
  return points;
}

// The spots the rotate handle may take, in project pixels, in the order they are tried: past the middle of the box's
// top edge, then its bottom edge, its right side and its left side, each along the clip's own axes. ns is how far past
// the top or bottom, ew how far past a side.
export function rotateSpots(item: CanvasItem, offset: { ns: number; ew: number }): Point[] {
  return (["n", "s", "e", "w"] as const).map((grip) => {
    const { hx, hy } = HANDLE_SIGNS[grip];
    return outFrom(item, hx, hy, hy === 0 ? offset.ew : offset.ns);
  });
}

// A point outside the box moves to inset pixels inside the edge it is past, on each axis; one inside stays.
export function clampInto(p: Point, box: Box, inset: number): Point {
  const x = p.x < box.left ? box.left + inset : p.x > box.right ? box.right - inset : p.x;
  const y = p.y < box.top ? box.top + inset : p.y > box.bottom ? box.bottom - inset : p.y;
  return { x, y };
}

const CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

// The resize cursor along the way a handle points on screen once the clip is turned, to the nearest 45°.
export function cursorFor(handle: Handle, rotation: number): (typeof CURSORS)[number] {
  const { hx, hy } = HANDLE_SIGNS[handle];
  const angle = rotation + (Math.atan2(hy, hx) * 180) / Math.PI;
  const i = Math.round(angle / 45) % 4;
  return CURSORS[(i + 4) % 4];
}

// Where the canvas is on screen, in client pixels, and k CSS pixels per project pixel. It is read from the canvas's
// live client rect, so the board's zoom and scroll are already in it: no zoom factor is ever added.
export type View = { left: number; top: number; k: number };

export function viewOf(canvasRect: { left: number; top: number; width: number }, docWidth: number): View {
  return { left: canvasRect.left, top: canvasRect.top, k: canvasRect.width / docWidth };
}

export function toScreen(v: View, p: Point): Point {
  return { x: v.left + p.x * v.k, y: v.top + p.y * v.k };
}

export function fromScreen(v: View, clientX: number, clientY: number): Point {
  return { x: (clientX - v.left) / v.k, y: (clientY - v.top) / v.k };
}

// A project point in the overlay's own pixels: on screen, less the overlay's client corner.
export function toOverlay(v: View, overlay: { left: number; top: number }, p: Point): Point {
  const s = toScreen(v, p);
  return { x: s.x - overlay.left, y: s.y - overlay.top };
}

export type Box = { left: number; top: number; right: number; bottom: number };

// The part of the board the pane shows (its inside, scrollbars excluded), in the overlay's pixels.
export function visibleBox(pane: { left: number; top: number; width: number; height: number }, overlay: { left: number; top: number }): Box {
  const left = pane.left - overlay.left;
  const top = pane.top - overlay.top;
  return { left, top, right: left + pane.width, bottom: top + pane.height };
}

// What the preview tells its overlay: the clips drawn now, where the canvas is, and what the pane shows, read when
// asked, with a call after every draw and every change to the board's layout or scroll.
export type PreviewSurface = {
  items(): CanvasItem[];
  view(): View | null;
  visible(): Box | null;
  onChange(listener: () => void): () => void;
};

type Live = { items(): CanvasItem[]; view(): View | null; visible(): Box | null };
export type LiveSurface = PreviewSurface & { attach(live: Live): () => void; changed(): void };

// A surface that has nothing to give ([] and null) until the preview attaches what it draws with.
export function createPreviewSurface(): LiveSurface {
  let live: Live | null = null;
  const listeners = new Set<() => void>();
  return {
    items: () => live?.items() ?? [],
    view: () => live?.view() ?? null,
    visible: () => live?.visible() ?? null,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach(next) {
      live = next;
      return () => {
        if (live === next) live = null;
      };
    },
    changed() {
      for (const listener of [...listeners]) listener();
    },
  };
}
