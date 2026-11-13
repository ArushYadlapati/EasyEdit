"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { useIsMac } from "@/components/editor/use-shortcuts";
import { RESIZE_STEP_PX } from "@/lib/editor/layout";
import { FADE, FOCUS_RING_INSET, cx } from "./cx";

export type SplitterProps = {
  label: string; // the accessible name
  orientation: "vertical" | "horizontal"; // the bar's own direction: a vertical bar moves along x
  value: number | null; // the pane's size in px; null before it is measured
  min: number;
  max: number;
  grow: 1 | -1; // 1: right or down makes the pane bigger; -1: left or up does
  controls: string; // the pane's id
  onChange(value: number): void; // during a drag, and for each key
  onCommit(): void; // at the end of a drag, and after each key
  onReset(): void; // a double-click
  onCancel?(): void; // Escape during a drag, after onChange(start): the caller puts back what it had before the drag
  onDraggingChange?(dragging: boolean): void;
  className?: string; // the caller places the bar, absolutely
  style?: CSSProperties;
};

type Drag = { pointerId: number; from: number; start: number; release(): void };

// Keys that move a bar, as a direction: on a vertical bar right is +1, on a horizontal one down is.
const DIRECTION: Record<SplitterProps["orientation"], Record<string, 1 | -1>> = {
  vertical: { ArrowRight: 1, ArrowLeft: -1 },
  horizontal: { ArrowDown: 1, ArrowUp: -1 },
};

// The edge between two panes (the APG window splitter). Dragged with the pointer, or moved from the keyboard: 16 px a
// press, 64 with Shift, Home and End to its ends. A double-click resets it, and Escape during a drag puts it back where
// the drag began. Works the same for everyone: a pane's size is not a change to the project.
export function Splitter({
  label,
  orientation,
  value,
  min,
  max,
  grow,
  controls,
  onChange,
  onCommit,
  onReset,
  onCancel,
  onDraggingChange,
  className,
  style,
}: SplitterProps) {
  const vertical = orientation === "vertical";
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const isMac = useIsMac();
  // The callbacks of the latest render, for Escape, which a window listener hears.
  const latest = useRef({ onChange, onCommit, onCancel, onDraggingChange });
  useLayoutEffect(() => {
    latest.current = { onChange, onCommit, onCancel, onDraggingChange };
  });
  // Unmounted mid-drag: the window listener goes with it.
  useEffect(() => () => drag.current?.release(), []);

  const limit = (px: number) => Math.min(max, Math.max(min, px));
  const along = (e: { clientX: number; clientY: number }) => (vertical ? e.clientX : e.clientY);

  function finish() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.release();
    setDragging(false);
    latest.current.onCommit();
    latest.current.onDraggingChange?.(false);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || value === null || drag.current) return;
    if (isMac && e.ctrlKey) return; // a right-click on a Mac
    const bar = e.currentTarget;
    const pointerId = e.pointerId;
    bar.setPointerCapture(pointerId);
    // Escape ends the drag before anything else hears it, so it does not also clear the selection.
    const onKey = (key: globalThis.KeyboardEvent) => {
      const d = drag.current;
      if (key.key !== "Escape" || !d) return;
      key.preventDefault();
      key.stopPropagation();
      latest.current.onChange(d.start);
      latest.current.onCancel?.();
      finish();
      try {
        if (bar.hasPointerCapture(pointerId)) bar.releasePointerCapture(pointerId);
      } catch {
        // Already released.
      }
    };
    window.addEventListener("keydown", onKey, true);
    drag.current = { pointerId, from: along(e), start: value, release: () => window.removeEventListener("keydown", onKey, true) };
    setDragging(true);
    onDraggingChange?.(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onChange(limit(d.start + grow * (along(e) - d.from)));
  }

  function onLostPointerCapture(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === e.pointerId) finish();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (value === null) return;
    const direction = DIRECTION[orientation][e.key];
    let next: number;
    if (direction !== undefined) next = limit(value + grow * direction * RESIZE_STEP_PX * (e.shiftKey ? 4 : 1));
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    onChange(next);
    onCommit();
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value ?? undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-controls={controls}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onLostPointerCapture={onLostPointerCapture}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onReset()}
      onContextMenu={(e) => e.preventDefault()}
      className={cx("group touch-none select-none", vertical ? "cursor-col-resize" : "cursor-row-resize", FOCUS_RING_INSET, className)}
      style={style}
    >
      {/* At rest only the 1 px gap between the panes shows; hover or a drag draws a 3 px line over it. */}
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute bg-ed-faint opacity-0 group-hover:opacity-100 group-data-dragging:opacity-100",
          vertical ? "inset-y-0 left-[3px] w-[3px]" : "inset-x-0 top-[3px] h-[3px]",
          FADE,
        )}
      />
    </div>
  );
}
