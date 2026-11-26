"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "@/components/ui/cx";
import { editKeyframeOps } from "@/lib/editor/keyframe-list";
import { findClip } from "@/lib/editor/store";
import type { KeyframeCurve, KeyframeProp } from "@/lib/timeline";
import { useEditorStore } from "./context";
import { useLiveEdit } from "./use-live-edit";

const SIDE = 100; // the drawing's own units
// Room above and below the box, as a share of it, for a curve that overshoots.
const OVER = 0.5;
const yTo = (y: number) => (1 + OVER - y) * (SIDE / (1 + 2 * OVER));
const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// A keyframe's hand-shaped travel to the next one: time runs left to right and the value bottom to top, from this
// keyframe (bottom left) to the next (top right). Its two handles are dragged, or nudged with the arrow keys; a
// handle pulled past the top or under the bottom overshoots and comes back.
export function EaseCurve({ clipId, prop, at, curve, canEdit }: { clipId: string; prop: KeyframeProp; at: number; curve: KeyframeCurve; canEdit: boolean }) {
  const store = useEditorStore();
  const live = useLiveEdit(store, "keyframe");
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<0 | 1 | null>(null);
  const [x1, y1, x2, y2] = curve;

  const withHandle = (which: 0 | 1, x: number, y: number): KeyframeCurve => {
    const next: KeyframeCurve = [...curve];
    next[which * 2] = clamp(x, 0, 1);
    next[which * 2 + 1] = clamp(y, -OVER, 1 + OVER);
    return next;
  };
  const opsFor = (next: KeyframeCurve) => {
    const clip = findClip(store.getState().doc, clipId)?.clip;
    return clip ? editKeyframeOps(clip, prop, at, { curve: next }) : null;
  };
  function where(event: { clientX: number; clientY: number }) {
    const box = svg.current!.getBoundingClientRect();
    const x = (event.clientX - box.left) / (box.width || 1);
    const y = 1 + OVER - ((event.clientY - box.top) / (box.height || 1)) * (1 + 2 * OVER);
    return { x, y };
  }
  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!canEdit || event.button !== 0) return;
    const p = where(event);
    // The nearer handle is the one taken.
    dragging.current = Math.hypot(p.x - x1, p.y - y1) <= Math.hypot(p.x - x2, p.y - y2) ? 0 : 1;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    live.preview(opsFor(withHandle(dragging.current, p.x, p.y)));
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (dragging.current === null) return;
    const p = where(event);
    live.preview(opsFor(withHandle(dragging.current, p.x, p.y)));
  }
  function end() {
    dragging.current = null;
    live.finish();
  }
  function onKey(event: KeyboardEvent, which: 0 | 1) {
    const by = NUDGE[event.key];
    if (!canEdit || !by) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.02;
    const ops = opsFor(withHandle(which, curve[which * 2] + by[0] * step, curve[which * 2 + 1] + by[1] * step));
    if (ops && ops.length > 0) store.getState().edit(ops, "keyframe");
  }

  const px = (x: number) => x * SIDE;
  const handle = (which: 0 | 1, x: number, y: number, fromX: number, fromY: number) => (
    <g key={which}>
      <line x1={px(fromX)} y1={yTo(fromY)} x2={px(x)} y2={yTo(y)} stroke="currentColor" strokeWidth={1} className="text-ed-muted" vectorEffect="non-scaling-stroke" />
      <circle
        data-handle={which}
        role="slider"
        tabIndex={canEdit ? 0 : -1}
        aria-label={which === 0 ? "Start handle" : "End handle"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(x * 100)}
        aria-valuetext={`${Math.round(x * 100)}% of the time, ${Math.round(y * 100)}% of the way`}
        cx={px(x)}
        cy={yTo(y)}
        r={3}
        fill="#111"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        className="text-ed-accent outline-none focus-visible:[r:4]"
        onKeyDown={(event) => onKey(event, which)}
      />
    </g>
  );

  return (
    <svg
      ref={svg}
      role="group"
      aria-label="Ease curve"
      viewBox={`0 0 ${SIDE} ${SIDE}`}
      preserveAspectRatio="none"
      className={cx("h-28 w-full touch-none overflow-visible rounded-md border border-ed-line bg-ed-raised", canEdit ? "cursor-crosshair" : "opacity-40")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {/* The box the travel stays in unless it overshoots. */}
      <rect x={0} y={yTo(1)} width={SIDE} height={yTo(0) - yTo(1)} fill="none" stroke="currentColor" strokeWidth={0.5} strokeDasharray="2 2" className="text-ed-line" vectorEffect="non-scaling-stroke" />
      <path d={`M0 ${yTo(0)} C${px(x1)} ${yTo(y1)} ${px(x2)} ${yTo(y2)} ${SIDE} ${yTo(1)}`} fill="none" stroke="currentColor" strokeWidth={1.75} className="text-ed-accent" vectorEffect="non-scaling-stroke" />
      {handle(0, x1, y1, 0, 0)}
      {handle(1, x2, y2, 1, 1)}
    </svg>
  );
}
