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

// The clip a handle drag crops now, if one does.
type Cropping = { clipId: string | null };

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
  ctrl: boolean; // Ctrl, the crop key, as the latest pointer or key event had it
  alt: boolean; // Alt (Option): a resize keeps the box's middle
  travelled: boolean; // the pointer has passed the click slop since the press
  started: boolean;
  drag: CanvasDrag | null;
  label: CanvasDragResult["label"];
  ops: OpInput[]; // what the pointer asks for now
  sent: { ops: string; doc: TimelineDoc } | null; // what the gesture was last set from
  live: boolean; // the store holds a gesture of this drag
};

export type CanvasDragController = {
  press(e: ReactPointerEvent, grip: Grip, clipId: string, drawn?: Point): void;
  // The lines a moved clip is snapped onto (the frame's edges and centre lines, another clip's side or middle), in
  // project pixels, while it is snapped there.
  guides: StoreApi<Guides>;
  // The clip a handle drag crops now: with Ctrl, with the Crop tool, or armed by the clip menu's Crop.
  cropping: StoreApi<Cropping>;
  dispose(): void;
};

// Moving, turning and resizing a clip on the preview by hand. A press captures the pointer on the overlay. A press on
// the clip's body becomes a drag once it travels the click slop (and makes that clip the only selection), a press on a
// handle at once. The pointer is worked out at most once per animation frame, from the press each time, with Shift,
// Ctrl and Alt as they are now: one pressed or let go mid-drag, or a scroll of the pane, works it out again where the
// pointer is. A handle drag keeps the shape unless Shift is held, and keeps the box's middle while Alt (Option) is. It
// crops instead of resizing while Ctrl is down or the clip menu's Crop armed the clip; from a handle drawn clamped into
// the pane, the cut starts only once the pointer passes the click slop. The change is shown through the store's
// gesture and saved once on release, or when the capture is lost, which a quick flick can do just before its release;
// Escape and a cancelled pointer drop it, and so does the store when the clip is removed. The end of any drag disarms
// Crop. pointerdown is never prevented, so a focused field blurs, and saves, before the drag sets anything.
export function createCanvasDrag(store: EditorStore, surface: PreviewSurface, pane: () => HTMLElement | null): CanvasDragController {
  const guides = createStore<Guides>(() => NO_GUIDES);
  const cropping = createStore<Cropping>(() => ({ clipId: null }));
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

  function showCropping(clipId: string | null) {
    if (cropping.getState().clipId !== clipId) cropping.setState({ clipId }, true);
  }

  // A handle drag crops while Ctrl is down or while the clip menu's Crop has armed its clip.
  function crops(s: Session): boolean {
    const state = store.getState();
    return s.drag?.type === "resize" && (s.ctrl || state.cropArmed === s.clipId || state.tool === "crop");
  }

  // The drag begins from the clip as it is drawn now, keyframes at the playhead included. Null when it cannot: the clip
  // is gone, off the playhead, or on a locked track.
  function start(s: Session): boolean {
    const state = store.getState();
    const view = surface.view();
    const items = surface.items();
    const item = items.find((i) => i.clipId === s.clipId);
    const doc = viewDoc(state);
    const drag = view && item ? beginCanvasDrag(doc, item, s.grip, fromScreen(view, s.x0, s.y0), s.drawn, items, state.showGuides ? (doc.guides ?? []) : [], state.playhead) : null;
    if (!drag) {
      if (!findClip(doc, s.clipId)) state.notify("error", MESSAGES.clipGone);
      end(false);
      return false;
    }
    if (s.grip === "body") state.select([s.clipId]);
    s.drag = drag;
    s.started = true;
    showCropping(crops(s) ? s.clipId : null);
    return true;
  }

  function resolve(s: Session) {
    const state = store.getState();
    const view = surface.view();
    if (!s.drag || !state.canEdit) return end(false);
    if (!view) return;
    const crop = crops(s);
    // A cut from a handle drawn clamped would start where it is drawn: not before the pointer means to drag. A turn
    // too waits for the pointer to pass the click slop, so a click on the handle that wobbles a pixel turns nothing.
    const result: CanvasDragResult =
      crop && s.drawn && !s.travelled
        ? { ops: [], label: "crop", guides: NO_GUIDES }
        : s.drag.type === "rotate" && !s.travelled
          ? { ops: [], label: s.label, guides: NO_GUIDES }
          : resolveCanvasDrag(s.drag, {
              pointer: fromScreen(view, s.x, s.y),
              shift: s.shift,
              crop,
              centre: s.alt,
              snapping: state.snapping,
              snapPx: SNAP_CSS_PX / view.k,
            });
    showCropping(crop ? s.clipId : null);
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

  // The pointer and the modifiers a pointer event carries.
  function track(s: Session, e: PointerEvent) {
    s.x = e.clientX;
    s.y = e.clientY;
    s.shift = e.shiftKey;
    s.ctrl = e.ctrlKey;
    s.alt = e.altKey;
    if (Math.hypot(s.x - s.x0, s.y - s.y0) >= CLICK_SLOP_PX) s.travelled = true;
  }

  function onMove(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    track(s, e);
    if (!s.started) {
      if (!s.travelled) return;
      if (!start(s)) return;
    }
    schedule();
  }

  function onUp(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    if (!s.started) return end(false);
    track(s, e);
    // The drop is where the pointer came up, even when that frame was not worked out yet.
    resolve(s);
    end(true);
  }

  function onCancel(e: Event) {
    const s = session;
    if (s && (!(e instanceof PointerEvent) || e.pointerId === s.pointerId)) end(false);
  }

  // A lost capture is a release. On a quick flick the browser lets the capture go a few milliseconds before the
  // pointerup, which then goes to whatever is under the pointer, so the drop is where the pointer was last seen.
  function onLost(e: Event) {
    const s = session;
    if (!s || (e instanceof PointerEvent && e.pointerId !== s.pointerId)) return;
    if (!s.started) return end(false);
    resolve(s);
    end(true);
  }

  // Escape ends a drag before anything else hears it, so it does not also clear the selection. Shift, Ctrl and Alt are
  // read live.
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
    if (e.shiftKey !== s.shift || e.ctrlKey !== s.ctrl || e.altKey !== s.alt) {
      s.shift = e.shiftKey;
      s.ctrl = e.ctrlKey;
      s.alt = e.altKey;
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
    s.target.addEventListener("lostpointercapture", onLost);
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
      if (next.doc !== prev.doc || next.snapping !== prev.snapping || next.cropArmed !== prev.cropArmed) refresh();
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
    s.target.removeEventListener("lostpointercapture", onLost);
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
    showCropping(null);
    if (!s.started) return;
    const state = store.getState();
    const changed = commit && s.ops.length > 0;
    if (changed) state.commitGesture(s.label);
    else state.setGesture(null);
    // A click on a handle is no drag, so it leaves Crop armed.
    if (s.travelled || changed) store.getState().setCropArmed(null);
  }

  return {
    guides,
    cropping,
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
        ctrl: e.ctrlKey,
        alt: e.altKey,
        travelled: false,
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
