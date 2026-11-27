import { BOARD_ZOOM_MAX, BOARD_ZOOM_MIN, type BoardZoom } from "./settings";

// The preview board: the frame at a zoom, inside a margin of empty board that scrolls when the frame is bigger
// than the pane. k is CSS pixels per project pixel. The pane is the scroll container's inside, scrollbars excluded.

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200] as const;
export const BOARD_PADDING_PX = 16; // the empty board kept around the frame on every side

export type BoardLayout = { k: number; frame: Size; content: Size; offset: Point };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Fill fits the frame inside the margin, never below 0; a percentage is that many CSS pixels per 100 project pixels.
export function boardScale(zoom: BoardZoom, doc: Size, pane: Size): number {
  if (zoom !== "fill") return zoom / 100;
  const room = 2 * BOARD_PADDING_PX;
  return Math.max(0, Math.min((pane.width - room) / doc.width, (pane.height - room) / doc.height));
}

// The content is the pane, or the frame plus its margin when that is bigger; the frame sits in its middle.
export function boardLayout(k: number, doc: Size, pane: Size): BoardLayout {
  const room = 2 * BOARD_PADDING_PX;
  const frame = { width: doc.width * k, height: doc.height * k };
  const content = { width: Math.max(pane.width, frame.width + room), height: Math.max(pane.height, frame.height + room) };
  return { k, frame, content, offset: { x: (content.width - frame.width) / 2, y: (content.height - frame.height) / 2 } };
}

// The project point at the pane's middle.
export function centreOf(layout: BoardLayout, pane: Size, scroll: { left: number; top: number }): Point {
  return {
    x: (scroll.left + pane.width / 2 - layout.offset.x) / layout.k,
    y: (scroll.top + pane.height / 2 - layout.offset.y) / layout.k,
  };
}

// The scroll that puts a project point back at the pane's middle, kept within what the content can scroll.
export function scrollFor(p: Point, layout: BoardLayout, pane: Size): { left: number; top: number } {
  return {
    left: clamp(layout.offset.x + p.x * layout.k - pane.width / 2, 0, layout.content.width - pane.width),
    top: clamp(layout.offset.y + p.y * layout.k - pane.height / 2, 0, layout.content.height - pane.height),
  };
}

// The project point under a spot of the pane (at: CSS pixels from the pane's top-left corner).
export function pointAt(layout: BoardLayout, scroll: { left: number; top: number }, at: Point): Point {
  return { x: (scroll.left + at.x - layout.offset.x) / layout.k, y: (scroll.top + at.y - layout.offset.y) / layout.k };
}

// The scroll that puts a project point back under that spot of the pane, kept within what the content can scroll.
export function scrollKeeping(p: Point, at: Point, layout: BoardLayout, pane: Size): { left: number; top: number } {
  return {
    left: clamp(layout.offset.x + p.x * layout.k - at.x, 0, Math.max(0, layout.content.width - pane.width)),
    top: clamp(layout.offset.y + p.y * layout.k - at.y, 0, Math.max(0, layout.content.height - pane.height)),
  };
}

// A pinch (or Ctrl/Cmd with the wheel) over the board: the zoom it comes to, from the one it was at, in percent and
// unrounded, so a slow pinch of many small steps adds up rather than rounding back each time. Up (negative) zooms in.
// One step is held to PINCH_STEP_MAX pixels, so a mouse wheel's notch moves it by about a quarter, not threefold.
export const PINCH_RATE = 0.01; // per pixel of wheel travel
const PINCH_STEP_MAX = 25;
export function pinchZoom(percent: number, deltaY: number): number {
  const step = clamp(deltaY, -PINCH_STEP_MAX, PINCH_STEP_MAX);
  return clamp(percent * Math.exp(-step * PINCH_RATE), BOARD_ZOOM_MIN, BOARD_ZOOM_MAX);
}

// The zoom button's text.
export function zoomLabel(zoom: BoardZoom): string {
  return zoom === "fill" ? "Fill" : `${zoom}%`;
}

// The zoom button's name.
export function zoomName(zoom: BoardZoom): string {
  return `Preview zoom: ${zoom === "fill" ? "Fill to size" : `${zoom}%`}`;
}
