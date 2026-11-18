"use client";

import { useEffect, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { SNAP_CSS_PX } from "@/lib/editor/canvas-drag";
import { fromScreen, type PreviewSurface } from "@/lib/editor/canvas-geometry";
import { arrowEndOps, type ArrowGrip } from "@/lib/editor/arrow-drag";
import { snapPoint } from "@/lib/editor/shape-draw";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import type { ShapeClip } from "@/lib/timeline";
import { useEditorStore } from "./context";

// A press on an arrow's tail, tip or middle handle: the end follows the pointer while the other stays put (Shift keeps
// the arrow to 15° steps), or the middle bends the arrow. Shown through the store's gesture and saved once on release.
// Escape, a cancelled pointer, the loss of edit access or the arrow going away drop it.
type Session = { pointerId: number; target: HTMLElement; clip: ShapeClip; grip: ArrowGrip; moved: boolean };

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
    if (state.snapping && s.grip !== "bend") p = snapPoint(p, frame, state.showGuides ? (doc.guides ?? []) : [], SNAP_CSS_PX / view.k);
    const ops = arrowEndOps(s.clip, s.grip, p, frame, e.shiftKey);
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
    else state.commitGesture(s.grip === "bend" ? "bend arrow" : "move arrow end");
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
