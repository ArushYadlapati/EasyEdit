"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { SNAP_CSS_PX } from "@/lib/editor/canvas-drag";
import { fromScreen, type PreviewSurface } from "@/lib/editor/canvas-geometry";
import { guideAxisOf, offFrame, snapGuide } from "@/lib/editor/guides";
import { MESSAGES } from "@/lib/editor/messages";
import { viewDoc, type EditorStore } from "@/lib/editor/store";
import type { Guide, OpInput } from "@/lib/timeline";
import { useEditorStore } from "./context";
import { CLICK_SLOP_PX } from "./timeline/use-clip-drag";

// A press on the preview that places a new guide (the Guide tool) or moves one (a press on a guide). Nothing happens
// until the pointer passes the click slop. A new guide then takes its direction from the way the pointer went, mostly
// sideways for a vertical one; either kind follows the pointer, snapping to the frame's edges and centre lines, and is
// shown through the store's gesture. The release saves it once, unless it ends where it started; a moved guide let go
// past the frame's edge is removed instead, and says so while it is out there. Escape, a cancelled pointer, the loss of
// edit access or a teammate removing the guide drop it; a lost pointer capture counts as the release.
type Session = {
  pointerId: number;
  target: HTMLElement;
  x0: number;
  y0: number;
  travelled: boolean;
  guideId: string;
  axis: Guide["axis"] | null; // a new guide's is decided once the pointer travels
  isNew: boolean;
  raw: number | null; // where the pointer is, as a share of the frame, unclamped
  at: number | null; // where the guide is shown, snapped and inside the frame
};

export type GuideDragController = {
  // The moved guide that would be removed if let go now: it is past the frame's edge.
  removing: StoreApi<{ guideId: string | null }>;
  // guide: the one pressed, to move; null places a new one.
  press(e: ReactPointerEvent, guide: Guide | null): void;
  dispose(): void;
};

export function createGuideDrag(store: EditorStore, surface: PreviewSurface): GuideDragController {
  let session: Session | null = null;
  let unsubscribe: (() => void) | null = null;
  const removing = createStore<{ guideId: string | null }>(() => ({ guideId: null }));
  const showRemoving = (guideId: string | null) => {
    if (removing.getState().guideId !== guideId) removing.setState({ guideId });
  };

  function opsFor(s: Session, at: number): OpInput[] {
    if (s.isNew) return [{ op: "add_guide", guide: { id: s.guideId, axis: s.axis!, at } }];
    return [{ op: "move_guide", guideId: s.guideId, at }];
  }

  function onMove(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.travelled && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
    s.travelled = true;
    s.axis ??= guideAxisOf(dx, dy);
    const view = surface.view();
    if (!view) return;
    const state = store.getState();
    const doc = viewDoc(state);
    const point = fromScreen(view, e.clientX, e.clientY);
    s.raw = s.axis === "x" ? point.x / doc.width : point.y / doc.height;
    const inside = Math.min(1, Math.max(0, s.raw));
    const { at } = snapGuide(inside, s.axis, { width: doc.width, height: doc.height }, SNAP_CSS_PX / view.k, state.snapping);
    s.at = round4(at);
    showRemoving(!s.isNew && offFrame(s.raw) ? s.guideId : null);
    state.setGesture(opsFor(s, s.at));
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

  // A lost capture is a release: on a quick flick the browser lets the capture go just before the pointerup.
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
    showRemoving(null);
    if (!s.travelled) return;
    const state = store.getState();
    if (!commit || s.raw === null) {
      state.setGesture(null);
      return;
    }
    if (!s.isNew && offFrame(s.raw)) {
      state.setGesture(null);
      const result = state.edit([{ op: "remove_guide", guideId: s.guideId }], "remove guide");
      if (result.ok) state.selectGuide(null);
      return;
    }
    // Back where it started: nothing to save, and nothing to undo.
    if (!s.isNew && state.doc.guides?.find((g) => g.id === s.guideId)?.at === s.at) {
      state.setGesture(null);
      return;
    }
    const result = state.commitGesture(s.isNew ? "add guide" : "move guide");
    if (result.ok) store.getState().selectGuide(s.guideId);
  }

  return {
    removing,
    press(e, guide) {
      end(false);
      const state = store.getState();
      if (!state.canEdit || state.gesture !== null) return;
      const target = e.currentTarget as HTMLElement;
      const s: Session = {
        pointerId: e.pointerId,
        target,
        x0: e.clientX,
        y0: e.clientY,
        travelled: false,
        guideId: guide?.id ?? nanoid(10),
        axis: guide?.axis ?? null,
        isNew: guide === null,
        raw: null,
        at: null,
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
      unsubscribe = store.subscribe((next, prev) => {
        if (!next.canEdit) return end(false);
        if (!s.isNew && next.doc !== prev.doc && !next.doc.guides?.some((g) => g.id === s.guideId)) {
          // A gesture the store held was ended by it, with its message.
          if (prev.gesture === null) next.notify("error", MESSAGES.guideGone);
          end(false);
        }
      });
    },
    dispose() {
      end(false);
    },
  };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function useGuideDrag(surface: PreviewSurface): GuideDragController {
  const store = useEditorStore();
  const drag = useMemo(() => createGuideDrag(store, surface), [store, surface]);
  useEffect(() => () => drag.dispose(), [drag]);
  return drag;
}
