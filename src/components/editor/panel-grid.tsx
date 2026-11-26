"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { CHOSEN_EDGE, FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { Splitter } from "@/components/ui/splitter";
import { displayRows } from "@/lib/editor/geometry";
import { fitLayout, layoutStyle, sizeBounds, type Layout, type LayoutStore, type PanelId } from "@/lib/editor/layout";
import { viewDoc } from "@/lib/editor/store";
import { useEditor } from "./context";
import { useMediaDropState } from "./media/media-context";

const REGION = "relative min-h-0 min-w-0 overflow-hidden";

// While an edge is dragged its cursor holds over the whole editor, and no text is selected.
const RESIZE_CURSOR = "[&[data-resizing=col]_*]:cursor-col-resize [&[data-resizing=row]_*]:cursor-row-resize data-resizing:select-none";

// Each edge is a 9 px strip centred on the 1 px line between two regions, above the timeline's sticky ruler (z-30)
// and below menus (z-50). The side edges run from under the 44 px top row to above the timeline.
const EDGE = "absolute z-40";
const LEFT_EDGE = "top-[45px] bottom-[calc(var(--ed-timeline-h)+1px)] left-[calc(var(--ed-left-w)-4px)] w-[9px]";
const RIGHT_EDGE = "top-[45px] bottom-[calc(var(--ed-timeline-h)+1px)] right-[calc(var(--ed-right-w)-4px)] w-[9px]";
const TIMELINE_EDGE = "inset-x-0 bottom-[calc(var(--ed-timeline-h)-4px)] h-[9px]";

type PanelGridProps = {
  layout: LayoutStore;
  deleted?: boolean;
  top: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  bottom: ReactNode;
  overlay?: ReactNode;
};

// What the lower part of a phone's screen shows: one of the three at a time.
type PhoneTab = "timeline" | "add" | "details";
const PHONE_TABS: { id: PhoneTab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "add", label: "Add" },
  { id: "details", label: "Details" },
];
// Below the lg width a region sits in the fourth row when its tab is chosen, and is not shown otherwise. It stays
// mounted either way, so nothing in it starts over when the tab changes.
const phoneCell = (shown: boolean) => (shown ? "max-lg:row-start-4" : "max-lg:hidden");

// The editor's grid: the top row, then the add panel, preview and details side by side, then the timeline across the
// bottom, with an edge between them that resizes each panel. Sizes come from the layout store, fitted to the window,
// and are set as the grid's size variables, which the notice bar also reads. A deleted project shows only the top row
// and its message, with no edges.
// Below the lg width (a phone, a narrow window) the same regions stack: the top row, the preview, a row of three tabs,
// and under it the timeline, the add panel or the details, whichever tab is chosen. Only the grid's CSS differs, so
// the server's first paint is right at any width and nothing is mounted twice.
export function PanelGrid({ layout, deleted = false, top, left, center, right, bottom, overlay }: PanelGridProps) {
  const wanted = useStore(layout, (s) => s.wanted);
  const win = useStore(layout, (s) => s.window);
  const [resizing, setResizing] = useState<"col" | "row" | null>(null);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("timeline");
  // While something is dragged over the window, the edges let it through to the panels under them.
  const dragging = useMediaDropState((s) => s.incoming !== null, false);
  // The sizes wanted when a drag began. Escape puts them back, so a size the window had squeezed, or a timeline that
  // followed the window's height, is kept as it was rather than replaced by the size shown at the start.
  const beforeDrag = useRef<Layout | null>(null);
  const ids = { left: useId(), right: useId(), timeline: useId() };
  // The timeline's default height follows its track count, so a project with few tracks leaves the preview the room.
  const rows = useEditor((s) => displayRows(viewDoc(s)).length);
  const shown = fitLayout(wanted, win, rows);

  // The window's size bounds every panel; it is read before the first paint, so saved sizes that do not fit never show.
  useLayoutEffect(() => {
    const measure = () => layout.getState().setWindow({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [layout]);

  const edge = (which: PanelId, label: string, className: string) => {
    const { min, max } = sizeBounds(which, shown, win);
    const vertical = which !== "timeline";
    return (
      <Splitter
        label={label}
        orientation={vertical ? "vertical" : "horizontal"}
        value={shown[which]}
        min={min}
        max={max}
        grow={which === "left" ? 1 : -1}
        controls={ids[which]}
        onChange={(px) => layout.getState().resize(which, px)}
        onCommit={() => layout.getState().commit()}
        onReset={() => layout.getState().reset(which)}
        onCancel={() => {
          if (beforeDrag.current) layout.setState({ wanted: beforeDrag.current });
        }}
        onDraggingChange={(dragging) => {
          beforeDrag.current = dragging ? layout.getState().wanted : null;
          setResizing(dragging ? (vertical ? "col" : "row") : null);
        }}
        className={cx(EDGE, className, "max-lg:hidden", dragging && "pointer-events-none")}
      />
    );
  };

  return (
    <div
      data-resizing={resizing ?? undefined}
      style={layoutStyle(shown, rows)}
      // The 44px top row is TOP_BAR_PX in the layout module.
      className={cx(
        "relative grid h-full gap-px bg-ed-line-strong",
        "lg:grid-cols-[var(--ed-left-w)_minmax(0,1fr)_var(--ed-right-w)] lg:grid-rows-[44px_minmax(0,1fr)_var(--ed-timeline-h)]",
        "max-lg:grid-cols-[minmax(0,1fr)] max-lg:grid-rows-[44px_minmax(0,38dvh)_40px_minmax(0,1fr)]",
        RESIZE_CURSOR,
      )}
    >
      {top}
      {deleted ? (
        <main className="flex flex-col items-center justify-center gap-2 bg-ed-bg text-center max-lg:row-span-3 lg:col-span-3 lg:row-span-2">{center}</main>
      ) : (
        <>
          <aside id={ids.left} aria-label="Add" className={cx(REGION, "bg-ed-panel", phoneCell(phoneTab === "add"))}>
            {left}
          </aside>
          {edge("left", "Left panel width", LEFT_EDGE)}
          <main aria-label="Preview" className={cx(REGION, "bg-ed-bg max-lg:row-start-2")}>
            {center}
          </main>
          {edge("right", "Right panel width", RIGHT_EDGE)}
          <aside id={ids.right} aria-label="Details" className={cx(REGION, "bg-ed-panel", phoneCell(phoneTab === "details"))}>
            {right}
          </aside>
          {edge("timeline", "Timeline height", TIMELINE_EDGE)}
          <section id={ids.timeline} aria-label="Timeline" className={cx(REGION, "bg-ed-panel lg:col-span-3", phoneCell(phoneTab === "timeline"))}>
            {bottom}
          </section>
          {/* A phone's switch between the three. Not tabs to a screen reader: each region is a landmark it can go to by name. */}
          <nav aria-label="Show" className="flex items-stretch gap-1 bg-ed-panel px-2 py-1 max-lg:row-start-3 lg:hidden">
            {PHONE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={phoneTab === tab.id}
                className={cx(
                  "flex-1 rounded-md text-[13px] font-medium text-ed-muted select-none aria-pressed:bg-ed-accent-weak aria-pressed:text-ed-accent",
                  CHOSEN_EDGE.pressed,
                  FOCUS_RING,
                  FADE,
                )}
                onClick={() => setPhoneTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          {overlay}
        </>
      )}
    </div>
  );
}
