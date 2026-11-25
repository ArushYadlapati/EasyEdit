"use client";

import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DISABLED, FOCUS_RING, cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { CUBE_BYTES_MAX } from "@/lib/color/cube";
import { curveFn, isCurveSet, type CurvePoint } from "@/lib/color/grade";
import {
  CURVES,
  WHEELS,
  addPoint,
  curveOf,
  curveOps,
  importLutOps,
  lutOfClip,
  movePoint,
  pickLutOps,
  puckAt,
  puckName,
  readCubeFile,
  removeLutOps,
  removePoint,
  wheelBackground,
  wheelOf,
  wheelOps,
  type CurveKey,
  type WheelKey,
} from "@/lib/editor/grade";
import type { ClipField } from "@/lib/editor/inspector-fields";
import { MESSAGES } from "@/lib/editor/messages";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import { isColorClip, type ColorClip, type Op, type OpInput } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";

const CAPTION = "text-xs font-medium text-ed-muted";
const LABEL = "color grade";

// A drag that shows each value as it goes and saves one change when let go. The store holds the drag's ops; this
// keeps the ones it started, so a drag someone else's change ended is never saved under this label. Leaving the
// screen mid-drag saves what was shown.
function useLiveEdit(store: EditorStore, label: string) {
  const own = useRef<Op[] | null>(null);
  const finish = useCallback(() => {
    const state = store.getState();
    if (own.current !== null && state.gesture?.ops === own.current) state.commitGesture(label);
    own.current = null;
  }, [store, label]);
  useEffect(() => finish, [finish]);
  return {
    preview(ops: OpInput[] | null) {
      const change = ops !== null && ops.length > 0 ? ops : null;
      store.getState().setGesture(change);
      own.current = change ? (store.getState().gesture?.ops ?? null) : null;
    },
    finish,
  };
}

// The clip as it is saved, which is what a change is worked out against: the clip a component is given may already
// show a drag in progress.
const savedClip = (store: EditorStore, clipId: string) => findClip(store.getState().doc, clipId)?.clip;

const WHEEL_BACKGROUND = wheelBackground();

const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

// One colour wheel. Its puck is dragged towards a colour to push the picture's shadows, middle tones or highlights
// that way; a double click, or Delete, puts it back in the middle. The arrow keys nudge it.
function WheelPad({ clip, wheelKey, label, canEdit }: { clip: ColorClip; wheelKey: WheelKey; label: string; canEdit: boolean }) {
  const store = useEditorStore();
  const live = useLiveEdit(store, LABEL);
  const pad = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const wheel = wheelOf(clip.grade, wheelKey);

  function place(event: PointerEvent) {
    const box = pad.current!.getBoundingClientRect();
    const r = box.width / 2 || 1;
    const saved = savedClip(store, clip.id);
    if (!saved) return;
    live.preview(wheelOps(saved, wheelKey, puckAt((event.clientX - box.left - r) / r, -(event.clientY - box.top - r) / r)));
  }
  function set(to: { x: number; y: number }) {
    const saved = savedClip(store, clip.id);
    const ops = saved ? wheelOps(saved, wheelKey, to) : null;
    if (ops && ops.length > 0) store.getState().edit(ops, LABEL);
  }
  function onKeyDown(event: KeyboardEvent) {
    if (!canEdit) return;
    const by = NUDGE[event.key];
    if (by) {
      event.preventDefault();
      const saved = savedClip(store, clip.id);
      const now = wheelOf(isColorClip(saved) ? saved.grade : undefined, wheelKey);
      const step = event.shiftKey ? 0.2 : 0.05;
      // A nudge out of the middle is a whole step, so the pull to the middle never swallows it.
      const next = puckAt(now.x + by[0] * step, now.y + by[1] * step);
      set(next.x === 0 && next.y === 0 && now.x === 0 && now.y === 0 ? { x: by[0] * 0.05, y: by[1] * 0.05 } : next);
    } else if (event.key === "Delete" || event.key === "Backspace" || event.key === "Home") {
      event.preventDefault();
      set({ x: 0, y: 0 });
    }
  }

  return (
    <div
      ref={pad}
      role="slider"
      tabIndex={canEdit ? 0 : -1}
      data-edit-control
      aria-label={`${label} color`}
      aria-disabled={!canEdit || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.hypot(wheel.x, wheel.y) * 100)}
      aria-valuetext={puckName(wheel)}
      className={cx("relative aspect-square w-full touch-none rounded-full border border-ed-line", FOCUS_RING, canEdit ? "cursor-crosshair" : "opacity-40")}
      style={{ background: WHEEL_BACKGROUND }}
      onPointerDown={(event) => {
        if (!canEdit || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragging.current = true;
        place(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) place(event);
      }}
      onPointerUp={() => {
        dragging.current = false;
        live.finish();
      }}
      onPointerCancel={() => {
        dragging.current = false;
        live.finish();
      }}
      onDoubleClick={() => canEdit && set({ x: 0, y: 0 })}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 h-px w-2 -translate-x-1/2 bg-white/50" />
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 h-2 w-px -translate-y-1/2 bg-white/50" />
      <span
        aria-hidden
        data-puck
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow-[0_0_0_1px_rgb(0_0_0/0.6)]"
        style={{ left: `${50 + wheel.x * 50}%`, top: `${50 - wheel.y * 50}%` }}
      />
    </div>
  );
}

const SIDE = 100; // the curve drawing's own units, a square
const GRID = [25, 50, 75];

// The curve editor: one curve for all three colours and one each for red, green and blue. A press on the line adds a
// point and drags it; a press on a point drags that one; a double click on a point, or Delete with it in focus, takes
// it out. Up is brighter: the line starts as the diagonal, which changes nothing.
function CurveEditor({ clip, canEdit }: { clip: ColorClip; canEdit: boolean }) {
  const store = useEditorStore();
  const live = useLiveEdit(store, LABEL);
  const [key, setKey] = useState<CurveKey>("curve");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ from: readonly CurvePoint[]; index: number } | null>(null);
  const points = curveOf(clip.grade, key);
  const color = CURVES.find((c) => c.key === key)!.color;

  const path = useMemo(() => {
    const f = curveFn(points);
    let d = "";
    for (let i = 0; i <= 64; i++) d += `${i ? "L" : "M"}${((i / 64) * SIDE).toFixed(2)} ${((1 - f(i / 64)) * SIDE).toFixed(2)}`;
    return d;
  }, [points]);

  const saved = () => {
    const clipNow = savedClip(store, clip.id);
    return isColorClip(clipNow) ? { clip: clipNow, points: curveOf(clipNow.grade, key) } : null;
  };
  function where(event: { clientX: number; clientY: number }) {
    const box = svg.current!.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return { x: clamp((event.clientX - box.left) / (box.width || 1)), y: clamp(1 - (event.clientY - box.top) / (box.height || 1)) };
  }
  // The point a press lands on: the nearest within reach, a fifteenth of the square.
  function hit(of: readonly CurvePoint[], at: { x: number; y: number }): number {
    let best = -1;
    let nearest = 0.066;
    of.forEach((p, i) => {
      const far = Math.hypot(p.x - at.x, p.y - at.y);
      if (far < nearest) {
        nearest = far;
        best = i;
      }
    });
    return best;
  }
  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!canEdit || event.button !== 0) return;
    const now = saved();
    if (!now) return;
    const at = where(event);
    let index = hit(now.points, at);
    let from = now.points;
    if (index === -1) {
      const added = addPoint(now.points, at.x, at.y);
      if (!added) return;
      from = added.points;
      index = added.index;
      live.preview(curveOps(now.clip, key, from));
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { from, index };
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const now = saved();
    if (!drag.current || !now) return;
    const at = where(event);
    live.preview(curveOps(now.clip, key, movePoint(drag.current.from, drag.current.index, at.x, at.y)));
  }
  function end() {
    drag.current = null;
    live.finish();
  }
  function change(next: readonly CurvePoint[] | null) {
    const now = saved();
    const ops = now && next ? curveOps(now.clip, key, next) : null;
    if (ops && ops.length > 0) store.getState().edit(ops, LABEL);
  }
  function onPointKey(event: KeyboardEvent, index: number) {
    if (!canEdit) return;
    const now = saved();
    if (!now) return;
    const by = NUDGE[event.key];
    if (by) {
      event.preventDefault();
      const step = event.shiftKey ? 0.1 : 0.02;
      const p = now.points[index];
      if (p) change(movePoint(now.points, index, p.x + by[0] * step, p.y + by[1] * step));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      change(removePoint(now.points, index));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Segmented<CurveKey>
          label="Curve"
          data-edit-control
          className="flex-1"
          value={key}
          options={CURVES.map((c) => ({ value: c.key, label: c.label }))}
          onChange={setKey}
        />
        <Button data-edit-control size="sm" variant="ghost" disabled={!canEdit || !isCurveSet(clip.grade?.[key])} onClick={() => change([])}>
          Reset curve
        </Button>
      </div>
      <svg
        ref={svg}
        role="group"
        aria-label={`${CURVES.find((c) => c.key === key)!.label} curve`}
        viewBox={`0 0 ${SIDE} ${SIDE}`}
        preserveAspectRatio="none"
        className={cx("aspect-square w-full touch-none rounded-md border border-ed-line bg-ed-raised", canEdit ? "cursor-crosshair" : "opacity-40")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(event) => {
          const now = saved();
          if (!canEdit || !now) return;
          const index = hit(now.points, where(event));
          if (index !== -1) change(removePoint(now.points, index));
        }}
      >
        {GRID.map((at) => (
          <g key={at} stroke="currentColor" strokeWidth={0.4} className="text-ed-line" vectorEffect="non-scaling-stroke">
            <line x1={at} y1={0} x2={at} y2={SIDE} vectorEffect="non-scaling-stroke" />
            <line x1={0} y1={at} x2={SIDE} y2={at} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        <line x1={0} y1={SIDE} x2={SIDE} y2={0} stroke="currentColor" strokeWidth={1} strokeDasharray="2 2" className="text-ed-muted" vectorEffect="non-scaling-stroke" opacity={0.5} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle
            // Its place in the list is what a point is: two points never swap, and a moved one is the same one.
            key={i}
            data-point={i}
            role="slider"
            tabIndex={canEdit ? 0 : -1}
            aria-label={`Point ${i + 1} of ${points.length}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p.y * 100)}
            aria-valuetext={`${Math.round(p.x * 100)}% in, ${Math.round(p.y * 100)}% out`}
            cx={p.x * SIDE}
            cy={(1 - p.y) * SIDE}
            r={2.6}
            fill="#111"
            stroke={color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            className={cx("outline-none focus-visible:[r:3.6]", DISABLED)}
            onKeyDown={(event) => onPointKey(event, i)}
          />
        ))}
      </svg>
    </div>
  );
}

// The picture's look-up table (LUT): one of the project's, picked from a menu, or a new one read from a .cube file.
// amount: the field for how much of it is mixed in, shown while the picture has one.
function LutPicker({ clip, canEdit, amount }: { clip: ColorClip; canEdit: boolean; amount: ReactNode }) {
  const store = useEditorStore();
  const luts = useEditor((s) => viewDoc(s).luts);
  const current = useEditor((s) => lutOfClip(viewDoc(s), clip));
  const file = useRef<HTMLInputElement>(null);

  function pick(id: string) {
    const saved = savedClip(store, clip.id);
    const ops = saved ? pickLutOps(saved, id === "" ? null : id) : null;
    if (ops && ops.length > 0) store.getState().edit(ops, LABEL);
  }
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = ""; // so the same file can be chosen again
    if (!chosen) return;
    const state = store.getState();
    if (chosen.size > CUBE_BYTES_MAX) return state.notify("error", MESSAGES.lutTooLarge);
    const read = readCubeFile(chosen.name, await chosen.text());
    if (!read.ok) return state.notify("error", read.message);
    const now = store.getState();
    const saved = findClip(now.doc, clip.id)?.clip;
    if (!saved || !now.canEdit) return;
    const ops = importLutOps(now.doc, saved, read.lut, nanoid(10));
    if (ops === null) return now.notify("error", MESSAGES.lutsFull);
    if (ops.length > 0) now.edit(ops, "import LUT");
  }
  function remove() {
    if (!current) return;
    const ops = removeLutOps(store.getState().doc, current.id);
    if (ops.length > 0) store.getState().edit(ops, "remove LUT");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="LUT">
          <Select data-edit-control disabled={!canEdit} value={current?.id ?? ""} onChange={(event) => pick(event.target.value)}>
            <option value="">None</option>
            {(luts ?? []).map((lut) => (
              <option key={lut.id} value={lut.id}>
                {lut.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button data-edit-control disabled={!canEdit} onClick={() => file.current?.click()}>
          Import .cube
        </Button>
        <input ref={file} type="file" accept=".cube,text/plain" hidden aria-label="LUT file" onChange={(event) => void onFile(event)} />
      </div>
      {current && (
        <div className="grid grid-cols-2 items-end gap-2">
          {amount}
          <Button data-edit-control variant="ghost" disabled={!canEdit} onClick={remove}>
            Remove from project
          </Button>
        </div>
      )}
    </div>
  );
}

// A picture's grade: the three wheels, the curves and a look-up table. number: the inspector's own number field,
// which the wheels' brightness and the table's amount are.
export function GradeControls({ clip, canEdit, number }: { clip: ColorClip; canEdit: boolean; number: (field: ClipField, label: string, min: number) => ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className={CAPTION}>Color wheels</span>
        <div className="grid grid-cols-3 gap-2">
          {WHEELS.map(({ key, label }) => (
            <div key={key} className="flex min-w-0 flex-col gap-1">
              <WheelPad clip={clip} wheelKey={key} label={label} canEdit={canEdit} />
              {number(`${key}Level`, label, -100)}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className={CAPTION}>Curves</span>
        <CurveEditor clip={clip} canEdit={canEdit} />
      </div>
      <LutPicker clip={clip} canEdit={canEdit} amount={number("lutAmount", "LUT strength", 0)} />
    </div>
  );
}
