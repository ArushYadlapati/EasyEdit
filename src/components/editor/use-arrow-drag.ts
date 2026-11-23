"use client";

import { useEffect, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { SNAP_CSS_PX } from "@/lib/editor/canvas-drag";
import { fromScreen, type PreviewSurface } from "@/lib/editor/canvas-geometry";
import { arrowGripOps, readGrip, type ArrowGrip } from "@/lib/editor/arrow-drag";
import { snapPoint } from "@/lib/editor/shape-draw";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import type { ShapeClip } from "@/lib/timeline";
import { useEditorStore } from "./context";

// A press on one of an arrow's handles. An end follows the pointer while the other end and the line's points stay put
// (Shift keeps the arrow to 15° steps, and it snaps like a drawn shape's corner). A point follows the pointer anywhere,
// unsnapped, and the line bends to pass through it; a press on the small handle between two points adds one there
// first. Shown through the store's gesture and saved once on release. Escape, a cancelled pointer, the loss of edit
// access or the arrow going away drop it.
type Session = { pointerId: number; target: HTMLElement; clip: ShapeClip; grip: ArrowGrip; moved: boolean };

// The label of the change, for undo and the activity list.
const GESTURE_LABEL = { end: "move arrow end", point: "bend arrow", add: "bend arrow" } as const;

export type ArrowDragController = {
  press(e: ReactPointerEvent, clipId: string, grip: ArrowGrip): void;
  dispose(): void;
};

export function createArrowDrag(store: EditorStore, surface: PreviewSurface): ArrowDragController {
  let session: Session | null = null;
  let unsubscribe: (() => void) | null = null;

  function onMove(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    const view = surface.view();
    if (!view) return;
    const state = store.getState();
    const doc = viewDoc(state);
    const frame = { width: doc.width, height: doc.height };
    let p = fromScreen(view, e.clientX, e.clientY);
    const end = readGrip(s.grip).kind === "end";
    if (state.snapping && end) p = snapPoint(p, frame, state.showGuides ? (doc.guides ?? []) : [], SNAP_CSS_PX / view.k);
    const ops = arrowGripOps(s.clip, s.grip, p, frame, e.shiftKey);
    if (ops.length === 0) return;
    s.moved = true;
    state.setGesture(ops);
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

  function onKey(e: KeyboardEvent) {
    if (!session || e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    end(false);
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
    const state = store.getState();
    if (!s.moved || state.gesture === null) return;
    if (!commit) state.setGesture(null);
    else state.commitGesture(GESTURE_LABEL[readGrip(s.grip).kind]);
  }

  return {
    press(e, clipId, grip) {
      end(false);
      const state = store.getState();
      if (!state.canEdit || state.gesture !== null) return;
      const found = findClip(state.doc, clipId);
      if (!found || found.track.locked || found.clip.type !== "shape" || found.clip.shape !== "arrow") return;
      const target = e.currentTarget as HTMLElement;
      session = { pointerId: e.pointerId, target, clip: found.clip, grip, moved: false };
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
      unsubscribe = store.subscribe((next, prev) => {
        if (!next.canEdit || (next.doc !== prev.doc && !findClip(next.doc, clipId))) end(false);
      });
    },
    dispose() {
      end(false);
    },
  };
}

export function useArrowDrag(surface: PreviewSurface): ArrowDragController {
  const store = useEditorStore();
  const drag = useMemo(() => createArrowDrag(store, surface), [store, surface]);
  useEffect(() => () => drag.dispose(), [drag]);
  return drag;
}
