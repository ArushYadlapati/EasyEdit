import { createStore, type StoreApi } from "zustand/vanilla";

import { RULER_HEIGHT, ROW_HEIGHT } from "./geometry";

// The three edges a person can move, and the sizes they chose. Sizes are kept per browser for every project, in a
// cookie the server reads, so the editor paints at the chosen sizes from the first frame. A size nobody chose follows
// the window (the side panels) or the project's tracks (the timeline), so the footage gets the room on a laptop.

export type PanelId = "left" | "right" | "timeline";
export type Layout = { left: number | null; right: number | null; timeline: number | null }; // px; null = the default
export type WindowSize = { width: number; height: number };

export const LAYOUT_COOKIE = "easyedit-layout";
export const TOP_BAR_PX = 44; // repeats the grid's 44px row
export const PANEL = {
  left: { min: 200, max: 480 },
  right: { min: 240, max: 480 },
  timeline: { min: 160, max: 1200 }, // the window sets the real max; this one only bounds a stored size
} as const;
// What the preview keeps: room for the transport row across, and for a picture above it.
export const CENTER_MIN_PX = 480;
export const PREVIEW_MIN_PX = 200;
export const RESIZE_STEP_PX = 16; // an arrow key on an edge; Shift moves four steps
const GAP_PX = 1; // the grid's gap-px line between two regions
export const DEFAULT_LAYOUT: Layout = { left: null, right: null, timeline: null };
// The sizes every panel had before they followed the window. A cookie from then holds them as numbers although
// nobody chose them (a timeline drag saved all three), so they are read as the default.
const OLD_DEFAULT = { left: 240, right: 280 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The side panels' default widths, as the stylesheet has them before the window is measured and in whole pixels
// after. The add panel (with the 44 px tool rail) is 218 px on a 1024 px window and 280 px at 1440 px, where its tabs
// have room for their names, up to 300 px; the details panel grows from 240 px to 320 px.
export const SIDE_CSS = { left: "clamp(200px, calc(15vw + 64px), 300px)", right: "clamp(240px, 19vw, 320px)" } as const;
export function defaultSide(which: "left" | "right", windowWidth: number): number {
  return which === "left" ? clamp(Math.round(0.15 * windowWidth + 64), 200, 300) : clamp(Math.round(0.19 * windowWidth), 240, 320);
}

// The timeline's default height: its control row, ruler, every track and one spare row to drop on, with room for a
// scroll bar, from 200 px up to the old default, 36% of the window between 220 and 360 px. Three tracks take 237 px,
// so an upright project's preview gets the rest. Without a track count, the old default.
const CONTROL_ROW_PX = 41; // the transport row and its line
const SCROLLBAR_PX = 12;
const TIMELINE_DEFAULT_MIN = 200;
const timelineNeed = (rows: number) => CONTROL_ROW_PX + RULER_HEIGHT + (rows + 1) * ROW_HEIGHT + SCROLLBAR_PX;
export function defaultTimelineHeight(windowHeight: number, rows?: number): number {
  const most = clamp(Math.round(0.36 * windowHeight), 220, 360);
  return rows === undefined ? most : clamp(timelineNeed(rows), TIMELINE_DEFAULT_MIN, most);
}
// The same before the window is measured.
export function timelineCss(rows: number): string {
  return `clamp(${TIMELINE_DEFAULT_MIN}px, ${timelineNeed(rows)}px, clamp(220px, 36vh, 360px))`;
}

// How far one edge can go with the other sizes as shown: the preview keeps CENTER_MIN_PX across and PREVIEW_MIN_PX
// down. The max is never below the min, so a window too small for every minimum still gets them.
export function sizeBounds(which: PanelId, shown: Layout, win: WindowSize | null): { min: number; max: number } {
  const fixed = PANEL[which];
  if (!win) return { min: fixed.min, max: fixed.max };
  const room =
    which === "timeline"
      ? win.height - TOP_BAR_PX - 2 * GAP_PX - PREVIEW_MIN_PX
      : win.width - 2 * GAP_PX - CENTER_MIN_PX - ((which === "left" ? shown.right : shown.left) ?? 0);
  return { min: fixed.min, max: Math.max(fixed.min, Math.min(fixed.max, room)) };
}

// The sizes to show for the sizes chosen, in this window: whole pixels, every one of them once the window is known.
// Before that, a size nobody chose stays null and the stylesheet's default (SIDE_CSS, timelineCss) stands. A narrow
// window takes from the right panel first, then the left; a wider one gives the chosen sizes back, since they are
// never overwritten here. rows: the timeline's track count, for its default height.
export function fitLayout(wanted: Layout, win: WindowSize | null, rows?: number): Layout {
  const side = (which: "left" | "right") => {
    const size = wanted[which] ?? (win ? defaultSide(which, win.width) : null);
    return size === null ? null : clamp(Math.round(size), PANEL[which].min, PANEL[which].max);
  };
  let left = side("left");
  let right = side("right");
  if (win && left !== null && right !== null) {
    const sides = win.width - 2 * GAP_PX - CENTER_MIN_PX;
    let over = left + right - sides;
    if (over > 0) {
      const fromRight = Math.min(over, right - PANEL.right.min);
      right -= fromRight;
      over -= fromRight;
      left -= Math.min(over, left - PANEL.left.min);
    }
  }
  let timeline: number | null = null;
  const chosen = wanted.timeline ?? (win ? defaultTimelineHeight(win.height, rows) : null);
  if (chosen !== null) {
    const { min, max } = sizeBounds("timeline", { left, right, timeline: null }, win);
    timeline = clamp(Math.round(clamp(chosen, PANEL.timeline.min, PANEL.timeline.max)), min, max);
  }
  return { left, right, timeline };
}

// The cookie's text: three whole numbers joined by "_", each one empty while its panel has the default. Only digits
// and "_", so the browser and the server read the same value with no encoding.
export function formatLayout(layout: Layout): string {
  const part = (px: number | null) => (px === null ? "" : String(Math.round(px)));
  return `${part(layout.left)}_${part(layout.right)}_${part(layout.timeline)}`;
}

const LAYOUT_TEXT = /^(\d{0,4})_(\d{0,4})_(\d{0,4})$/;

export function parseLayout(text: string | null | undefined): Layout {
  const match = text ? LAYOUT_TEXT.exec(text) : null;
  if (!match) return DEFAULT_LAYOUT;
  const side = (part: string, which: "left" | "right") =>
    part === "" || Number(part) === OLD_DEFAULT[which] ? null : clamp(Number(part), PANEL[which].min, PANEL[which].max);
  return {
    left: side(match[1], "left"),
    right: side(match[2], "right"),
    timeline: match[3] === "" ? null : clamp(Number(match[3]), PANEL.timeline.min, PANEL.timeline.max),
  };
}

// The grid's size variables. A size not known yet is the stylesheet's default: the sides' follow the window, and the
// timeline's its track count when given (else the editor's own default stands).
export function layoutStyle(shown: Layout, rows?: number): Record<string, string> {
  const style: Record<string, string> = {
    "--ed-left-w": shown.left === null ? SIDE_CSS.left : `${shown.left}px`,
    "--ed-right-w": shown.right === null ? SIDE_CSS.right : `${shown.right}px`,
  };
  if (shown.timeline !== null) style["--ed-timeline-h"] = `${shown.timeline}px`;
  else if (rows !== undefined) style["--ed-timeline-h"] = timelineCss(rows);
  return style;
}

export type LayoutState = {
  wanted: Layout;
  window: WindowSize | null;
  setWindow(win: WindowSize): void;
  resize(which: PanelId, px: number): void; // a drag or a key: whole pixels within the bounds; not saved
  commit(): void; // saves the sizes when they differ from the last ones saved
  reset(which?: PanelId): void; // one size, or all three, back to the default; saved
  load(layout: Layout): void; // sizes already kept elsewhere (a newer cookie): shown and taken as saved; not saved
};
export type LayoutStore = StoreApi<LayoutState>;

const sameLayout = (a: Layout, b: Layout) => a.left === b.left && a.right === b.right && a.timeline === b.timeline;

export function createLayoutStore(initial: Layout, save: (layout: Layout) => void): LayoutStore {
  let saved = initial;
  const remember = (wanted: Layout) => {
    saved = wanted;
    save(wanted);
  };
  return createStore<LayoutState>()((set, get) => ({
    wanted: initial,
    window: null,
    setWindow: (win) => {
      const now = get().window;
      if (now && now.width === win.width && now.height === win.height) return;
      set({ window: win });
    },
    resize: (which, px) => {
      const { wanted, window: win } = get();
      const { min, max } = sizeBounds(which, fitLayout(wanted, win), win); // no bound depends on the track count
      let next: number | null = clamp(Math.round(px), min, max);
      // A side dragged back to the width it has by default keeps following the window, unless a width was kept.
      if (which !== "timeline" && win && saved[which] === null && next === defaultSide(which, win.width)) next = null;
      if (next !== wanted[which]) set({ wanted: { ...wanted, [which]: next } });
    },
    commit: () => {
      const { wanted } = get();
      if (!sameLayout(wanted, saved)) remember(wanted);
    },
    reset: (which) => {
      const wanted = which ? { ...get().wanted, [which]: DEFAULT_LAYOUT[which] } : DEFAULT_LAYOUT;
      set({ wanted });
      remember(wanted);
    },
    load: (layout) => {
      saved = layout;
      set({ wanted: layout });
    },
  }));
}
