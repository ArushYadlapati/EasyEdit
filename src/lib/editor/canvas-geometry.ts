import { activeClips, type LocalRect } from "@/lib/render/compositor";
import { stretchOf } from "@/lib/timeline/presets";
import type { TimelineDoc } from "@/lib/timeline";
import type { Point, Size } from "./board";
import { clipRects, type Sizer } from "./clip-box";

// The preview's clips as boxes on the frame, and the mapping between project pixels, the screen and the overlay
// drawn over the board. Project pixels have y pointing down, so a positive rotation turns clockwise, as drawn.

// One clip as the compositor draws it: its centre, turn and drawn factors (sx = scale × stretch across, sy = scale
// down), its whole box and the part its crop keeps, both from the centre before scale, stretch and rotation.
export type CanvasItem = {
  clipId: string;
  trackId: string;
  type: "video" | "image" | "text";
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
    if (clip.type === "audio") continue;
    const rects = clipRects(doc, clip, sizer);
    if (!rects) continue;
    const t = clip.transform;
    items.push({
      clipId: clip.id,
      trackId: track.id,
      type: clip.type,
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
    if (local.x >= left - gx && local.x <= right + gx && local.y >= top - gy && local.y <= bottom + gy) return item;
  }
  return null;
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
