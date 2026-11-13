"use client";

import { useId, useLayoutEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { cx } from "@/components/ui/cx";
import { Splitter } from "@/components/ui/splitter";
import { fitLayout, layoutStyle, sizeBounds, type LayoutStore, type PanelId } from "@/lib/editor/layout";

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

// The editor's grid: the top row, then the add panel, preview and details side by side, then the timeline across the
// bottom, with an edge between them that resizes each panel. Sizes come from the layout store, fitted to the window,
// and are set as the grid's size variables, which the notice bar also reads. Hidden below the lg width, where the
// editor shows its message instead. A deleted project shows only the top row and its message, with no edges.
export function PanelGrid({ layout, deleted = false, top, left, center, right, bottom, overlay }: PanelGridProps) {
  const wanted = useStore(layout, (s) => s.wanted);
  const win = useStore(layout, (s) => s.window);
  const [resizing, setResizing] = useState<"col" | "row" | null>(null);
  const ids = { left: useId(), right: useId(), timeline: useId() };
  const shown = fitLayout(wanted, win);

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
        onDraggingChange={(dragging) => setResizing(dragging ? (vertical ? "col" : "row") : null)}
        className={cx(EDGE, className)}
      />
    );
  };

  return (
    <div
      data-resizing={resizing ?? undefined}
      style={layoutStyle(shown)}
      // The 44px top row is TOP_BAR_PX in the layout module.
      className={cx(
        "relative hidden h-full grid-cols-[var(--ed-left-w)_minmax(0,1fr)_var(--ed-right-w)] grid-rows-[44px_minmax(0,1fr)_var(--ed-timeline-h)] gap-px bg-ed-line-strong lg:grid",
        RESIZE_CURSOR,
      )}
    >
      {top}
      {deleted ? (
        <main className="col-span-3 row-span-2 flex flex-col items-center justify-center gap-2 bg-ed-bg text-center">{center}</main>
      ) : (
        <>
          <aside id={ids.left} aria-label="Add" className={cx(REGION, "bg-ed-panel")}>
            {left}
          </aside>
          {edge("left", "Left panel width", LEFT_EDGE)}
          <main aria-label="Preview" className={cx(REGION, "bg-ed-bg")}>
            {center}
          </main>
          {edge("right", "Right panel width", RIGHT_EDGE)}
          <aside id={ids.right} aria-label="Details" className={cx(REGION, "bg-ed-panel")}>
            {right}
          </aside>
          {edge("timeline", "Timeline height", TIMELINE_EDGE)}
          <section id={ids.timeline} aria-label="Timeline" className={cx(REGION, "col-span-3 bg-ed-panel")}>
            {bottom}
          </section>
          {overlay}
        </>
      )}
    </div>
  );
}
