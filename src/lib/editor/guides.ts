import type { Guide } from "@/lib/timeline";
import type { Point, Size } from "./board";

// Guides on the preview: lines a person places, kept with the project, that a moved clip snaps to. Here, where they
// are in project pixels and what a press or a drag means for them. Positions are shares of the frame.

// A drag that goes mostly sideways places a vertical guide (axis "x"), one that goes mostly up or down a horizontal one.
export function guideAxisOf(dx: number, dy: number): Guide["axis"] {
  return Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
}

// A guide being placed or moved snaps to the frame's edges and its centre line when it comes within snapPx project
// pixels of one, while snapping is on.
export function snapGuide(at: number, axis: Guide["axis"], frame: Size, snapPx: number, snapping: boolean): { at: number; snapped: boolean } {
  if (!snapping) return { at, snapped: false };
  const size = axis === "x" ? frame.width : frame.height;
  let best: { at: number; distance: number } | null = null;
  for (const line of [0, 0.5, 1]) {
    const distance = Math.abs(at - line) * size;
    if (distance <= snapPx && (!best || distance < best.distance)) best = { at: line, distance };
  }
  return best ? { at: best.at, snapped: true } : { at, snapped: false };
}

// The guide nearest a point in project pixels, if one is within slopPx of it.
export function guideAt(guides: readonly Guide[], point: Point, frame: Size, slopPx: number): Guide | null {
  let best: { guide: Guide; distance: number } | null = null;
  for (const guide of guides) {
    const distance = guide.axis === "x" ? Math.abs(point.x - guide.at * frame.width) : Math.abs(point.y - guide.at * frame.height);
    if (distance <= slopPx && (!best || distance < best.distance)) best = { guide, distance };
  }
  return best?.guide ?? null;
}

// A guide let go past the frame's edge is taken away.
export function offFrame(at: number): boolean {
  return at < 0 || at > 1;
}

// Each axis's guides, in project pixels.
export function guideLines(guides: readonly Guide[], frame: Size): { x: number[]; y: number[] } {
  return {
    x: guides.filter((g) => g.axis === "x").map((g) => g.at * frame.width),
    y: guides.filter((g) => g.axis === "y").map((g) => g.at * frame.height),
  };
}
