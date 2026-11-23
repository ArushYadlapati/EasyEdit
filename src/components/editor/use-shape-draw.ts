"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { SNAP_CSS_PX } from "@/lib/editor/canvas-drag";
import { fromScreen, type PreviewSurface } from "@/lib/editor/canvas-geometry";
import { MESSAGES } from "@/lib/editor/messages";
import { drawnGeometry, placeShape, redrawShape, snapPoint } from "@/lib/editor/shape-draw";
import { viewDoc, type EditorStore } from "@/lib/editor/store";
import type { ShapeTool } from "@/lib/timeline/shapes";
import type { OpInput } from "@/lib/timeline";
import type { Point } from "@/lib/editor/board";
import { useEditorStore } from "./context";
import { CLICK_SLOP_PX } from "./timeline/use-clip-drag";

// A press with the Shape, Line or Arrow tool: nothing happens until the pointer passes the click slop, so a click adds nothing. Then
// the shape follows the pointer, shown through the store's gesture, its ends snapping to the frame's edges, its centre
// lines and the guides shown (while snapping is on). Shift keeps a box square or an arrow to 15° steps, Alt (Option)
// draws a box from its middle. The release adds it as one change, selects it and goes back to Selection. Escape, a
// cancelled pointer or the loss of edit access drop it; a lost pointer capture counts as the release.
type Session = {
  pointerId: number;
  target: HTMLElement;
  x0: number;
  y0: number;
  from: Point; // the press, in project pixels, snapped
  tool: ShapeTool;
  travelled: boolean;
  ops: OpInput[] | null; // the placement, chosen once the pointer travels
  clipId: string | null;
  last: { to: Point; shift: boolean; centre: boolean } | null;
};

export type ShapeDrawController = {
  press(e: ReactPointerEvent): void;
  dispose(): void;
};

export function createShapeDraw(store: EditorStore, surface: PreviewSurface, deps: { seconds: () => number; color: () => string | undefined }): ShapeDrawController {
  let session: Session | null = null;
  let unsubscribe: (() => void) | null = null;

  function pointAt(clientX: number, clientY: number): Point | null {
    const view = surface.view();
    if (!view) return null;
    const state = store.getState();
    const doc = viewDoc(state);
    const p = fromScreen(view, clientX, clientY);
    if (!state.snapping) return p;
    return snapPoint(p, { width: doc.width, height: doc.height }, state.showGuides ? (doc.guides ?? []) : [], SNAP_CSS_PX / view.k);
  }

  function show(s: Session) {
    if (!s.last) return;
    const state = store.getState();
    const doc = viewDoc(state);
    const geometry = drawnGeometry(s.tool, s.from, s.last.to, s.last, { width: doc.width, height: doc.height });
    if (!s.ops) {
      const placement = placeShape(
        state.doc,
        s.tool,
        geometry,
        { start: state.playhead, duration: Math.max(1, Math.round(deps.seconds() * doc.fps)), trackId: state.selection.trackId, color: deps.color() },
        () => nanoid(10),
      );
      if (!placement.ok) {
        state.notify("error", MESSAGES.noRoom);
        end(false);
        return;
      }
      s.ops = placement.ops;
      s.clipId = placement.clipIds[0] ?? null;
    }
    s.ops = redrawShape(s.ops, geometry);
    state.setGesture(s.ops);
  }

  function onMove(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    if (!s.travelled && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < CLICK_SLOP_PX) return;
    s.travelled = true;
    const to = pointAt(e.clientX, e.clientY);
    if (!to) return;
    s.last = { to, shift: e.shiftKey, centre: e.altKey };
    show(s);
  }

  function onUp(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    onMove(e);
    end(true);
  }

  function onCancel(e: Event) {
    const s = session;
    if (s && (!(e instanceof PointerEvent) || e.pointerId === s.pointerId)) end(false);
  }

  function onLost(e: Event) {
    const s = session;
    if (s && (!(e instanceof PointerEvent) || e.pointerId === s.pointerId)) end(true);
  }

  // Shift and Alt change the shape mid-drag, without a pointer move.
  function onKey(e: KeyboardEvent) {
    const s = session;
    if (!s) return;
    if (e.key === "Escape" && e.type === "keydown") {
      e.preventDefault();
      e.stopPropagation();
      end(false);
      return;
    }
    if ((e.key === "Shift" || e.key === "Alt") && s.last) {
      if (e.key === "Alt") e.preventDefault();
      s.last = { ...s.last, shift: e.shiftKey, centre: e.altKey };
      show(s);
    }
  }

  function end(commit: boolean) {
    const s = session;
    if (!s) return;
    session = null;
    unsubscribe?.();
    unsubscribe = null;
    s.target.removeEventListener("pointermove", onMove);
    s.target.removeEventListener("pointerup", onUp);
    s.target.removeEventListener("pointercancel", onCancel);
    s.target.removeEventListener("lostpointercapture", onLost);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
    if (!s.travelled || !s.ops) return;
    const state = store.getState();
    if (!commit) {
      state.setGesture(null);
      return;
    }
    const result = state.commitGesture("add shape");
    if (result.ok && s.clipId) {
      const next = store.getState();
      next.select([s.clipId]);
      next.setTool("select");
    }
  }

  return {
    press(e) {
      end(false);
      const state = store.getState();
      if (!state.canEdit || state.gesture !== null) return;
      const from = pointAt(e.clientX, e.clientY);
      if (!from) return;
      const target = e.currentTarget as HTMLElement;
      const s: Session = {
        pointerId: e.pointerId,
        target,
        x0: e.clientX,
        y0: e.clientY,
        from,
        tool: state.tool === "line" || state.tool === "arrow" ? state.tool : state.shapeTool,
        travelled: false,
        ops: null,
        clipId: null,
        last: null,
      };
      session = s;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is no longer active; its next events end the press.
      }
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onCancel);
      target.addEventListener("lostpointercapture", onLost);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", onKey, true);
      unsubscribe = store.subscribe((next) => {
        if (!next.canEdit) end(false);
      });
    },
    dispose() {
      end(false);
    },
  };
}

export function useShapeDraw(surface: PreviewSurface, deps: { seconds: () => number; color: () => string | undefined }): ShapeDrawController {
  const store = useEditorStore();
  // deps are read when a drag starts, so the controller is made once per surface.
  const draw = useMemo(() => createShapeDraw(store, surface, deps), [store, surface]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => draw.dispose(), [draw]);
  return draw;
}
