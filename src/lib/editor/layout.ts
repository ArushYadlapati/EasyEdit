import { createStore, type StoreApi } from "zustand/vanilla";

// The three edges a person can move, and the sizes they chose. Sizes are kept per browser for every project, in a
// cookie the server reads, so the editor paints at the chosen sizes from the first frame.

export type PanelId = "left" | "right" | "timeline";
export type Layout = { left: number; right: number; timeline: number | null }; // px; timeline null = the CSS default
export type WindowSize = { width: number; height: number };

export const LAYOUT_COOKIE = "easyedit-layout";
export const TOP_BAR_PX = 44; // repeats the grid's 44px row
export const PANEL = {
  left: { initial: 240, min: 200, max: 480 },
  right: { initial: 280, min: 240, max: 480 },
  timeline: { min: 160, max: 1200 }, // the window sets the real max; this one only bounds a stored size
} as const;
// What the preview keeps: room for the transport row across, and for a picture above it.
export const CENTER_MIN_PX = 480;
export const PREVIEW_MIN_PX = 200;
export const RESIZE_STEP_PX = 16; // an arrow key on an edge; Shift moves four steps
const GAP_PX = 1; // the grid's gap-px line between two regions
export const DEFAULT_LAYOUT: Layout = { left: PANEL.left.initial, right: PANEL.right.initial, timeline: null };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// The editor's CSS default for the timeline, clamp(220px, 36vh, 360px), in whole pixels.
export function defaultTimelineHeight(windowHeight: number): number {
  return clamp(Math.round(0.36 * windowHeight), 220, 360);
}

// How far one edge can go with the other sizes as shown: the preview keeps CENTER_MIN_PX across and PREVIEW_MIN_PX
// down. The max is never below the min, so a window too small for every minimum still gets them.
export function sizeBounds(which: PanelId, shown: Layout, win: WindowSize | null): { min: number; max: number } {
  const fixed = PANEL[which];
  if (!win) return { min: fixed.min, max: fixed.max };
  const room =
    which === "timeline"
      ? win.height - TOP_BAR_PX - 2 * GAP_PX - PREVIEW_MIN_PX
      : win.width - 2 * GAP_PX - CENTER_MIN_PX - (which === "left" ? shown.right : shown.left);
  return { min: fixed.min, max: Math.max(fixed.min, Math.min(fixed.max, room)) };
}

// The sizes to show for the sizes chosen, in this window. A narrow window takes from the right panel first, then
// the left; a wider one gives the chosen sizes back, since they are never overwritten here.
export function fitLayout(wanted: Layout, win: WindowSize | null): Layout {
  let left = clamp(Math.round(wanted.left), PANEL.left.min, PANEL.left.max);
  let right = clamp(Math.round(wanted.right), PANEL.right.min, PANEL.right.max);
  let timeline: number | null = null;
  if (win) {
    const sides = win.width - 2 * GAP_PX - CENTER_MIN_PX;
    let over = left + right - sides;
    if (over > 0) {
      const fromRight = Math.min(over, right - PANEL.right.min);
      right -= fromRight;
      over -= fromRight;
      left -= Math.min(over, left - PANEL.left.min);
    }
  }
  const chosen = wanted.timeline ?? (win ? defaultTimelineHeight(win.height) : null);
  if (chosen !== null) {
    const { min, max } = sizeBounds("timeline", { left, right, timeline: null }, win);
    timeline = clamp(Math.round(clamp(chosen, PANEL.timeline.min, PANEL.timeline.max)), min, max);
  }
  return { left, right, timeline };
}

// The cookie's text: three whole numbers joined by "_", the last one empty while the timeline has the default.
// Only digits and "_", so the browser and the server read the same value with no encoding.
export function formatLayout(layout: Layout): string {
  return `${Math.round(layout.left)}_${Math.round(layout.right)}_${layout.timeline === null ? "" : Math.round(layout.timeline)}`;
}

const LAYOUT_TEXT = /^(\d{1,4})_(\d{1,4})_(\d{0,4})$/;

export function parseLayout(text: string | null | undefined): Layout {
  const match = text ? LAYOUT_TEXT.exec(text) : null;
  if (!match) return DEFAULT_LAYOUT;
  return {
    left: clamp(Number(match[1]), PANEL.left.min, PANEL.left.max),
    right: clamp(Number(match[2]), PANEL.right.min, PANEL.right.max),
    timeline: match[3] === "" ? null : clamp(Number(match[3]), PANEL.timeline.min, PANEL.timeline.max),
  };
}

// The grid's size variables. Without a timeline size the stylesheet's default stands.
export function layoutStyle(shown: Layout): Record<string, string> {
  const style: Record<string, string> = { "--ed-left-w": `${shown.left}px`, "--ed-right-w": `${shown.right}px` };
  if (shown.timeline !== null) style["--ed-timeline-h"] = `${shown.timeline}px`;
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
      const { min, max } = sizeBounds(which, fitLayout(wanted, win), win);
      const next = clamp(Math.round(px), min, max);
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
