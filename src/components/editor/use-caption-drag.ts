"use client";

import { useEffect, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { fromScreen, type PreviewSurface } from "@/lib/editor/canvas-geometry";
import { viewDoc, type EditorStore } from "@/lib/editor/store";
import { captionStyleOf } from "@/lib/timeline";
import { useEditorStore } from "./context";
import { CLICK_SLOP_PX } from "./timeline/use-clip-drag";

// A press on the captions on the preview: past the click slop it moves every caption up or down (the project's
// caption style's height, its y), kept inside the frame and shown through the store's gesture; the release saves it
// once, as one undo step. Captions only move up and down: they are always centred across the frame. Escape, a
// cancelled pointer or the loss of edit access drop it; a lost pointer capture counts as the release.
type Session = { pointerId: number; target: HTMLElement; x0: number; y0: number; from: number; travelled: boolean; at: number | null };

export type CaptionDragController = { press(e: ReactPointerEvent): void; dispose(): void };

const Y_MIN = 0.05;
const Y_MAX = 0.95;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function createCaptionDrag(store: EditorStore, surface: PreviewSurface): CaptionDragController {
  let session: Session | null = null;
  let unsubscribe: (() => void) | null = null;

  function onMove(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    if (!s.travelled && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < CLICK_SLOP_PX) return;
    s.travelled = true;
    const view = surface.view();
    if (!view) return;
    const state = store.getState();
    const doc = viewDoc(state);
    const moved = (fromScreen(view, e.clientX, e.clientY).y - fromScreen(view, s.x0, s.y0).y) / doc.height;
    s.at = round3(Math.min(Y_MAX, Math.max(Y_MIN, s.from + moved)));
    state.setGesture([{ op: "set_caption_style", patch: { y: s.at } }]);
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
    if (!s.travelled) return;
    const state = store.getState();
    // Back where it started: nothing to save, and nothing to undo.
    if (!commit || s.at === null || s.at === s.from) {
      state.setGesture(null);
      return;
    }
    state.commitGesture("move captions");
  }

  return {
    press(e) {
      end(false);
      const state = store.getState();
      if (!state.canEdit || state.gesture !== null) return;
      const target = e.currentTarget as HTMLElement;
      const s: Session = { pointerId: e.pointerId, target, x0: e.clientX, y0: e.clientY, from: captionStyleOf(viewDoc(state)).y, travelled: false, at: null };
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
      unsubscribe = store.subscribe((next) => {
        if (!next.canEdit) end(false);
      });
    },
    dispose() {
      end(false);
    },
  };
}

export function useCaptionDrag(surface: PreviewSurface): CaptionDragController {
  const store = useEditorStore();
  const drag = useMemo(() => createCaptionDrag(store, surface), [store, surface]);
  useEffect(() => () => drag.dispose(), [drag]);
  return drag;
}
