"use client";

import { useEffect, useMemo, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Point } from "@/lib/editor/board";
import { SNAP_CSS_PX, beginCanvasDrag, resolveCanvasDrag, type CanvasDrag, type CanvasDragResult, type Grip } from "@/lib/editor/canvas-drag";
import { fromScreen, type PreviewSurface } from "@/lib/editor/canvas-geometry";
import { MESSAGES } from "@/lib/editor/messages";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import type { OpInput, TimelineDoc } from "@/lib/timeline";
import { useEditorStore } from "./context";
import { CLICK_SLOP_PX } from "./timeline/use-clip-drag";

type Guides = { x: number | null; y: number | null };

const NO_GUIDES: Guides = { x: null, y: null };

type Session = {
  pointerId: number;
  target: HTMLElement; // the overlay, which holds the pointer's capture
  grip: Grip;
  clipId: string;
  drawn: Point | undefined; // where a handle clamped into the pane was drawn, in project pixels
  x0: number; // the press, in client pixels
  y0: number;
  x: number; // the pointer now
  y: number;
  shift: boolean;
  started: boolean;
  drag: CanvasDrag | null;
  label: CanvasDragResult["label"];
  ops: OpInput[]; // what the pointer asks for now
  sent: { ops: string; doc: TimelineDoc } | null; // what the gesture was last set from
  live: boolean; // the store holds a gesture of this drag
};

export type CanvasDragController = {
  press(e: ReactPointerEvent, grip: Grip, clipId: string, drawn?: Point): void;
  // The frame's centre lines a moved clip's centre sits on, in project pixels, while it is snapped there.
  guides: StoreApi<Guides>;
  dispose(): void;
};

// Moving, turning and resizing a clip on the preview by hand. A press captures the pointer on the overlay. A press on
// the clip's body becomes a drag once it travels the click slop (and makes that clip the only selection), a press on a
// handle at once. The pointer is worked out at most once per animation frame, from the press each time, with Shift as
// it is now: a Shift pressed or let go mid-drag, or a scroll of the pane, works it out again where the pointer is. The
// change is shown through the store's gesture and saved once on release; Escape, a cancelled pointer and a lost
// capture drop it, and so does the store when the clip is removed. pointerdown is never prevented, so a focused field
// blurs, and saves, before the drag sets anything.
export function createCanvasDrag(store: EditorStore, surface: PreviewSurface, pane: () => HTMLElement | null): CanvasDragController {
  const guides = createStore<Guides>(() => NO_GUIDES);
  let session: Session | null = null;
  let frameId: number | null = null;
  let unsubscribe: (() => void) | null = null;
  let scroller: HTMLElement | null = null;

  function schedule() {
    if (frameId === null) frameId = requestAnimationFrame(tick);
  }

  function tick() {
    frameId = null;
    const s = session;
    if (s?.started) resolve(s);
  }

  // Shift, a scroll, a remote edit or snapping change where the pointer puts the clip.
  function refresh() {
    if (session?.started) schedule();
  }

  function showGuides(next: Guides) {
    const now = guides.getState();
    if (now.x !== next.x || now.y !== next.y) guides.setState({ x: next.x, y: next.y }, true);
  }

  // The drag begins from the clip as it is drawn now. Null when it cannot: the clip is gone, off the playhead, or on
  // a locked track.
  function start(s: Session): boolean {
    const state = store.getState();
    const view = surface.view();
    const item = surface.items().find((i) => i.clipId === s.clipId);
    const doc = viewDoc(state);
    const drag = view && item ? beginCanvasDrag(doc, item, s.grip, fromScreen(view, s.x0, s.y0), s.drawn) : null;
    if (!drag) {
      if (!findClip(doc, s.clipId)) state.notify("error", MESSAGES.clipGone);
      end(false);
      return false;
    }
    if (s.grip === "body") state.select([s.clipId]);
    s.drag = drag;
    s.started = true;
    return true;
  }

  function resolve(s: Session) {
    const state = store.getState();
    const view = surface.view();
    if (!s.drag || !state.canEdit) return end(false);
    if (!view) return;
    const result = resolveCanvasDrag(s.drag, {
      pointer: fromScreen(view, s.x, s.y),
      shift: s.shift,
      alt: false,
      snapping: state.snapping,
      snapPx: SNAP_CSS_PX / view.k,
    });
    s.label = result.label;
    s.ops = result.ops;
    const ops = JSON.stringify(result.ops);
    if (s.sent?.ops !== ops || s.sent.doc !== state.doc) {
      s.sent = { ops, doc: state.doc };
      state.setGesture(result.ops.length > 0 ? result.ops : null);
      s.live = store.getState().gesture !== null;
    }
    showGuides(result.guides);
  }

  function onMove(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    s.x = e.clientX;
    s.y = e.clientY;
    s.shift = e.shiftKey;
    if (!s.started) {
      if (Math.hypot(s.x - s.x0, s.y - s.y0) < CLICK_SLOP_PX) return;
      if (!start(s)) return;
    }
    schedule();
  }

  function onUp(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    if (!s.started) return end(false);
    s.x = e.clientX;
    s.y = e.clientY;
    s.shift = e.shiftKey;
    // The drop is where the pointer came up, even when that frame was not worked out yet.
    resolve(s);
    end(true);
  }

  function onCancel(e: Event) {
    const s = session;
    if (s && (!(e instanceof PointerEvent) || e.pointerId === s.pointerId)) end(false);
  }

  // Escape ends a drag before anything else hears it, so it does not also clear the selection. Shift is read live.
  function onKey(e: KeyboardEvent) {
    const s = session;
    if (!s) return;
    if (e.type === "keydown" && e.key === "Escape") {
      if (!s.started) return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
      return;
    }
    if (e.shiftKey !== s.shift) {
      s.shift = e.shiftKey;
      refresh();
    }
  }

  function begin(s: Session) {
    session = s;
    try {
      s.target.setPointerCapture(s.pointerId);
    } catch {
      // The pointer is no longer active; its next events end the press.
    }
    s.target.addEventListener("pointermove", onMove);
    s.target.addEventListener("pointerup", onUp);
    s.target.addEventListener("pointercancel", onCancel);
    s.target.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    scroller = pane();
    scroller?.addEventListener("scroll", refresh);
    unsubscribe = store.subscribe((next, prev) => {
      const now = session;
      if (!now) return;
      if (!next.canEdit) return end(false);
      if (next.doc !== prev.doc && !findClip(next.doc, now.clipId)) {
        // A gesture the store held was ended by it, with its message.
        if (!now.live) next.notify("error", MESSAGES.clipGone);
        return end(false);
      }
      if (next.doc !== prev.doc || next.snapping !== prev.snapping) refresh();
    });
  }

  // Takes down everything begin set up. A drag that started saves its gesture when commit is true and something
  // changed, and drops it otherwise.
  function end(commit: boolean) {
    const s = session;
    if (!s) return;
    session = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    unsubscribe?.();
    unsubscribe = null;
    s.target.removeEventListener("pointermove", onMove);
    s.target.removeEventListener("pointerup", onUp);
    s.target.removeEventListener("pointercancel", onCancel);
    s.target.removeEventListener("lostpointercapture", onCancel);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
    scroller?.removeEventListener("scroll", refresh);
    scroller = null;
    try {
      if (s.target.hasPointerCapture(s.pointerId)) s.target.releasePointerCapture(s.pointerId);
    } catch {
      // Already released.
    }
    showGuides(NO_GUIDES);
    if (!s.started) return;
    const state = store.getState();
    if (commit && s.ops.length > 0) state.commitGesture(s.label);
    else state.setGesture(null);
  }

  return {
    guides,
    press(e, grip, clipId, drawn) {
      end(false);
      if (!store.getState().canEdit) return;
      const s: Session = {
        pointerId: e.pointerId,
        target: e.currentTarget as HTMLElement,
        grip,
        clipId,
        drawn,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        shift: e.shiftKey,
        started: false,
        drag: null,
        label: grip === "body" || grip === "rotate" ? "position change" : "size change",
        ops: [],
        sent: null,
        live: false,
      };
      begin(s);
      if (grip !== "body") start(s);
    },
    dispose() {
      end(false);
    },
  };
}

// One drag controller for the preview's overlay, taken down with it.
export function useCanvasDrag(surface: PreviewSurface, pane: RefObject<HTMLElement | null>): CanvasDragController {
  const store = useEditorStore();
  const drag = useMemo(() => createCanvasDrag(store, surface, () => pane.current), [store, surface, pane]);
  useEffect(() => () => drag.dispose(), [drag]);
  return drag;
}
