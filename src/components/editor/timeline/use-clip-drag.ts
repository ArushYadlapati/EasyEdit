"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { beginMove, beginTrim, resolveDrag, type Drag, type DragGhost } from "@/lib/editor/drag";
import { moveTrack } from "@/lib/editor/actions";
import {
  HEADER_WIDTH,
  ROW_HEIGHT,
  RULER_HEIGHT,
  clipsInBox,
  displayRows,
  rowAt,
  trackDropSlot,
  type TimelinePoint,
} from "@/lib/editor/geometry";
import { mediaLengthFrames } from "@/lib/editor/media-clips";
import { MESSAGES } from "@/lib/editor/messages";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import type { AssetView } from "@/lib/media/types";
import type { OpInput, TimelineDoc } from "@/lib/timeline";
import { useMedia } from "../media/media-context";

export const CLICK_SLOP_PX = 3; // a press that travels further is a drag, not a click
const EDGE_ZONE_PX = 32; // a pointer this close to either side of the lanes, or to the rows' top or bottom, scrolls them
const AUTOSCROLL_PX = 12; // per animation frame

// What the timeline draws on top of the rows while a drag or a box selection is under way. Frames
// are along the lanes; y is from the top of the first row.
export type DragView = {
  guide: number | null; // the snap target
  ghost: DragGhost[] | null; // where the dragged clips would be, when that is not allowed
  box: { fromFrame: number; toFrame: number; fromY: number; toY: number } | null;
  track: { fromRow: number; slot: number } | null; // the dragged track's row, and the gap between rows it would go in
};

const IDLE: DragView = { guide: null, ghost: null, box: null, track: null };

type Grab = "move" | "start" | "end";

type Pointer = { pointerId: number; clientX: number; clientY: number; shiftKey: boolean };

type Press = { pointerId: number; x0: number; y0: number; x: number; y: number; started: boolean };

type ClipSession = Press & {
  kind: "clip";
  clipId: string;
  grab: Grab;
  collapse: boolean; // the clip was already selected: a click makes it the only one
  grabFrame: number;
  drag: Drag | null;
  label: "move" | "trim";
  sent: { ops: string; doc: TimelineDoc } | null; // what the gesture was last set from
  attempt: OpInput[]; // the ops for where the pointer is
  ok: boolean; // the store took them
  fitted: OpInput[] | null; // the last ops the store took, still shown while the attempt is refused
  live: boolean; // the store has a gesture of this drag
  shown: string;
};

type BoxSession = Press & { kind: "box"; base: string[]; fromFrame: number; fromY: number; picked: string; shown: string };

type TrackSession = Press & { kind: "track"; trackId: string; toRow: number | null; shown: string };

type Session = ClipSession | BoxSession | TrackSession;

export type TimelineDrag = {
  view: StoreApi<DragView>;
  attach(scroller: HTMLElement | null, rows: HTMLElement | null): void;
  setZoom(zoom: number): void;
  pressClip(e: Pointer, clipId: string, grab: Grab, collapse: boolean): void;
  pressRows(e: Pointer): void;
  pressTrack(e: ReactPointerEvent | PointerEvent, trackId: string): void;
  pointAt(clientX: number, clientY: number): TimelinePoint;
  scrollNear(clientX: number): void; // one step of the sideways autoscroll, for a pointer near either side of the lanes
  dispose(): void;
};

// Dragging clips and tracks, and box selection, for one timeline. A press captures the pointer on the
// scrolling area, so the drag outlives the clip's element when the clip moves to another row. A track
// press captures only once it becomes a drag, so a plain press still clicks the track's name. Pointer moves
// are worked out at most once per animation frame, against the store's current document, and
// everything a press set up is taken down when it ends, however it ends. assetOf reads the media library when a
// trim begins, so the trim stops where the clip's media ends.
export function createTimelineDrag(store: EditorStore, assetOf?: (assetId: string) => AssetView | undefined): TimelineDrag {
  const view = createStore<DragView>(() => IDLE);
  let scroller: HTMLElement | null = null;
  let rows: HTMLElement | null = null;
  let zoom = 1;
  let session: Session | null = null;
  let frameId: number | null = null;
  let unsubscribe: (() => void) | null = null;
  let pointerSource: EventTarget | null = null; // where the press's pointer events are listened for

  // In the rows the lane's left edge is frame 0; the gutter before it gives a negative x.
  const laneLeft = () => rows?.querySelector("[data-lane]")?.getBoundingClientRect().left ?? 0;
  const frameAt = (clientX: number) => Math.max(0, (clientX - laneLeft()) / zoom);
  const yInRows = (clientY: number) => clientY - (rows?.getBoundingClientRect().top ?? 0);

  function rowTrackAt(doc: TimelineDoc, clientY: number): string | null {
    const shown = displayRows(doc);
    return shown.length === 0 ? null : shown[rowAt(yInRows(clientY), shown.length)].id;
  }

  function show(s: Session, next: DragView) {
    const key = JSON.stringify(next);
    if (key === s.shown) return;
    s.shown = key;
    view.setState(next);
  }

  function schedule() {
    if (frameId === null) frameId = requestAnimationFrame(tick);
  }

  function tick() {
    frameId = null;
    const s = session;
    if (!s?.started) return;
    // A track drag never scrolls the lanes sideways, only the rows up and down.
    const scrolling = s.kind === "track" ? autoscrollRows(s.y) : autoscroll(s.x);
    resolve(s);
    if (scrolling && session === s) schedule();
  }

  // Scrolls one step when the pointer is near either side of the lanes. False at either end.
  function autoscroll(clientX: number): boolean {
    if (!scroller) return false;
    const { left, right } = scroller.getBoundingClientRect();
    const step = clientX < left + HEADER_WIDTH + EDGE_ZONE_PX ? -AUTOSCROLL_PX : clientX > right - EDGE_ZONE_PX ? AUTOSCROLL_PX : 0;
    if (step === 0) return false;
    const before = scroller.scrollLeft;
    scroller.scrollLeft = before + step;
    return scroller.scrollLeft !== before;
  }

  // Scrolls the rows one step when the pointer is near the top or bottom of the part of them in view
  // (the ruler covers the top of the scrolling area). Never above the top; false when nothing moved.
  function autoscrollRows(clientY: number): boolean {
    if (!scroller || !rows) return false;
    const area = scroller.getBoundingClientRect();
    const shown = rows.getBoundingClientRect();
    const top = Math.max(shown.top, area.top + RULER_HEIGHT);
    const bottom = Math.min(shown.bottom, area.bottom);
    const step = clientY < top + EDGE_ZONE_PX ? -AUTOSCROLL_PX : clientY > bottom - EDGE_ZONE_PX ? AUTOSCROLL_PX : 0;
    if (step === 0) return false;
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.max(0, before + step);
    return scroller.scrollTop !== before;
  }

  function resolve(s: Session) {
    if (s.kind === "clip") resolveClip(s);
    else if (s.kind === "box") resolveBox(s);
    else resolveTrack(s);
  }

  function resolveClip(s: ClipSession) {
    const state = store.getState();
    if (!s.drag || !state.canEdit) return end(false);
    const result = resolveDrag(state.doc, s.drag, {
      frame: frameAt(s.x),
      rowTrackId: rowTrackAt(state.doc, s.y),
      playhead: state.playhead,
      zoom,
      snapping: state.snapping,
    });
    if (!result) {
      // With a gesture set, the store has already ended it and said why.
      if (!s.live) state.notify("error", MESSAGES.clipGone);
      return end(false);
    }
    const ops = JSON.stringify(result.ops);
    if (s.sent?.ops !== ops || s.sent.doc !== state.doc) {
      s.sent = { ops, doc: state.doc };
      s.label = result.label;
      s.attempt = result.ops;
      s.ok = state.setGesture(result.ops.length > 0 ? result.ops : null);
      if (s.ok) s.fitted = result.ops.length > 0 ? result.ops : null;
      // Refused: the clips stay at the last place that fit, and the ghosts show the attempt.
      else if (!state.setGesture(s.fitted)) s.fitted = null;
      s.live = store.getState().gesture !== null;
    }
    if (scroller) scroller.dataset.drag = s.ok ? s.drag.type : "refused";
    show(s, { guide: result.guide, ghost: s.ok ? null : result.ghost, box: null, track: null });
  }

  function resolveBox(s: BoxSession) {
    const state = store.getState();
    const shown = displayRows(viewDoc(state));
    const toFrame = frameAt(s.x);
    const toY = yInRows(s.y);
    const ids = clipsInBox(shown, {
      fromFrame: s.fromFrame,
      toFrame,
      fromRow: rowAt(s.fromY, shown.length),
      toRow: rowAt(toY, shown.length),
    });
    const picked = [...new Set([...s.base, ...ids])];
    const key = picked.join(" ");
    if (key !== s.picked) {
      s.picked = key;
      state.select(picked);
    }
    const bottom = shown.length * ROW_HEIGHT;
    const clampY = (y: number) => Math.min(bottom, Math.max(0, y));
    show(s, { guide: null, ghost: null, box: { fromFrame: s.fromFrame, toFrame, fromY: clampY(s.fromY), toY: clampY(toY) }, track: null });
  }

  // The rows stay where they are while a track is dragged; the overlay shows where it would land.
  function resolveTrack(s: TrackSession) {
    const state = store.getState();
    if (!state.canEdit) return end(false);
    const shown = displayRows(state.doc);
    const fromRow = shown.findIndex((t) => t.id === s.trackId);
    if (fromRow < 0) {
      state.notify("error", MESSAGES.trackGone);
      return end(false);
    }
    const { slot, toRow } = trackDropSlot(shown, fromRow, yInRows(s.y));
    s.toRow = toRow;
    if (scroller) scroller.dataset.drag = "track";
    show(s, { guide: null, ghost: null, box: null, track: { fromRow, slot } });
  }

  function onMove(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.started) {
      if (Math.hypot(s.x - s.x0, s.y - s.y0) < CLICK_SLOP_PX) return;
      if (s.kind === "clip") {
        const { doc, selection } = store.getState();
        const lengthOf = assetOf ? (assetId: string) => mediaLengthFrames(assetOf(assetId), doc.fps) : undefined;
        s.drag =
          s.grab === "move" ? beginMove(doc, s.clipId, selection.clipIds, s.grabFrame) : beginTrim(doc, s.clipId, s.grab, s.grabFrame, lengthOf);
        if (!s.drag) {
          if (!findClip(doc, s.clipId)) store.getState().notify("error", MESSAGES.clipGone);
          return end(false);
        }
      }
      if (s.kind === "track") capture(s.pointerId);
      s.started = true;
    }
    schedule();
  }

  function onUp(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.started) {
      if (s.kind === "clip" && s.collapse && Math.hypot(s.x - s.x0, s.y - s.y0) < CLICK_SLOP_PX) store.getState().select([s.clipId]);
      return end(false);
    }
    // The drop is where the pointer came up, even when that frame was not worked out yet.
    resolve(s);
    end(true);
    if (s.kind === "track") swallowClick();
  }

  // The click that follows a track drag's release would open the name or select the track. It is
  // taken before anything hears it, and the catch is dropped on that click or on the next task.
  function swallowClick() {
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drop();
    };
    const drop = () => window.removeEventListener("click", swallow, true);
    window.addEventListener("click", swallow, true);
    setTimeout(drop, 0);
  }

  function onCancel(e: PointerEvent) {
    if (session && e.pointerId === session.pointerId) end(false);
  }

  // A lost capture is a release. On a quick flick the browser lets the capture go a few milliseconds before the
  // pointerup, which then goes to whatever is under the pointer, so the drop is where the pointer was last seen. A
  // track drag's click comes after that late pointerup, so it is swallowed from there.
  function onLost(e: PointerEvent) {
    const s = session;
    if (!s || e.pointerId !== s.pointerId) return;
    if (!s.started) return end(false);
    resolve(s);
    end(true);
    if (s.kind === "track") swallowClickAfterUp(s.pointerId);
  }

  // Waits for the pointer's late pointerup, then swallows the click after it. A new press, or a second without one,
  // stops the wait.
  function swallowClickAfterUp(pointerId: number) {
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      stop();
      swallowClick();
    };
    const stop = () => {
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointerdown", stop, true);
      clearTimeout(timer);
    };
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointerdown", stop, true);
    const timer = setTimeout(stop, 1000);
  }

  // Scrolling, zooming, a remote edit, losing edit access, the playhead or snapping changes where
  // the pointer puts the clips.
  function refresh() {
    if (session?.started) schedule();
  }

  // Escape ends a drag before anything else hears it, so it does not also clear the selection.
  function onKey(e: KeyboardEvent) {
    const s = session;
    if (e.key !== "Escape" || !s?.started) return;
    e.preventDefault();
    e.stopPropagation();
    if (s.kind === "box") store.getState().select(s.base);
    end(false);
  }

  function capture(pointerId: number) {
    try {
      scroller?.setPointerCapture(pointerId);
    } catch {
      // The pointer is no longer active; its next events end the press.
    }
  }

  // A track press listens on the window until it captures; the captured events still bubble there.
  function begin(s: Session) {
    end(false);
    if (!scroller) return;
    session = s;
    if (s.kind !== "track") capture(s.pointerId);
    pointerSource = s.kind === "track" ? window : scroller;
    pointerSource.addEventListener("pointermove", onMove as EventListener);
    pointerSource.addEventListener("pointerup", onUp as EventListener);
    pointerSource.addEventListener("pointercancel", onCancel as EventListener);
    scroller.addEventListener("lostpointercapture", onLost);
    scroller.addEventListener("scroll", refresh);
    window.addEventListener("keydown", onKey, true);
    unsubscribe = store.subscribe((next, prev) => {
      if (
        next.doc !== prev.doc ||
        next.canEdit !== prev.canEdit ||
        next.snapping !== prev.snapping ||
        next.playhead !== prev.playhead
      ) {
        refresh();
      }
    });
  }

  // Takes down everything begin set up. A clip drag that started saves its gesture when commit is
  // true (the store refuses a drop that does not fit, with its message) and drops it otherwise. A
  // track drag sets no gesture: it saves its one move when commit is true.
  function end(commit: boolean) {
    const s = session;
    if (!s) return;
    session = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    unsubscribe?.();
    unsubscribe = null;
    window.removeEventListener("keydown", onKey, true);
    pointerSource?.removeEventListener("pointermove", onMove as EventListener);
    pointerSource?.removeEventListener("pointerup", onUp as EventListener);
    pointerSource?.removeEventListener("pointercancel", onCancel as EventListener);
    pointerSource = null;
    if (scroller) {
      scroller.removeEventListener("lostpointercapture", onLost);
      scroller.removeEventListener("scroll", refresh);
      delete scroller.dataset.drag;
      try {
        if (scroller.hasPointerCapture(s.pointerId)) scroller.releasePointerCapture(s.pointerId);
      } catch {
        // Already released.
      }
    }
    if (view.getState() !== IDLE) view.setState(IDLE, true);
    if (s.kind === "clip" && s.started) {
      const state = store.getState();
      if (!commit) state.setGesture(null);
      else {
        // A refused attempt is set again so the store refuses the drop with its message.
        if (!s.ok) state.setGesture(s.attempt);
        state.commitGesture(s.label);
      }
    }
    if (s.kind === "track" && s.started && commit && s.toRow !== null) moveTrack(store, s.trackId, s.toRow);
  }

  const press = (e: Pointer): Press => ({ pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false });

  return {
    view,
    attach(nextScroller, nextRows) {
      if (nextScroller !== scroller) end(false);
      scroller = nextScroller;
      rows = nextRows;
    },
    // The zoom the timeline draws at, which a project too long for the stored zoom lowers.
    setZoom(next) {
      if (next === zoom) return;
      zoom = next;
      refresh();
    },
    pressClip(e, clipId, grab, collapse) {
      begin({
        ...press(e),
        kind: "clip",
        clipId,
        grab,
        collapse,
        grabFrame: frameAt(e.clientX),
        drag: null,
        label: grab === "move" ? "move" : "trim",
        sent: null,
        attempt: [],
        ok: true,
        fitted: null,
        live: false,
        shown: "",
      });
    },
    pressRows(e) {
      const base = e.shiftKey ? store.getState().selection.clipIds : [];
      begin({ ...press(e), kind: "box", base, fromFrame: frameAt(e.clientX), fromY: yInRows(e.clientY), picked: base.join(" "), shown: "" });
    },
    pressTrack(e, trackId) {
      begin({ ...press(e), kind: "track", trackId, toRow: null, shown: "" });
    },
    // The frame and track under a point on screen. Left of the lanes in view (under the track
    // headers) counts as their first frame in view; over the ruler, or above or below the rows,
    // there is no track, even where a scrolled row lies hidden under the ruler.
    pointAt(clientX, clientY) {
      const area = scroller?.getBoundingClientRect();
      const lanesLeft = (area?.left ?? 0) + HEADER_WIDTH;
      const frame = Math.round(frameAt(Math.max(clientX, lanesLeft)));
      const shown = displayRows(store.getState().doc);
      const row = Math.floor(yInRows(clientY) / ROW_HEIGHT);
      const overRuler = area !== undefined && clientY < area.top + RULER_HEIGHT;
      return { frame, trackId: !overRuler && row >= 0 && row < shown.length ? shown[row].id : null };
    },
    // A drag from outside the timeline sends dragover over and over, so each one is a step.
    scrollNear(clientX) {
      autoscroll(clientX);
    },
    dispose() {
      end(false);
    },
  };
}

export const TimelineDragContext = createContext<TimelineDrag | null>(null);

// One drag controller for the timeline, attached to its scrolling area and its rows, and taken down
// with it. The library is read when a trim begins, not subscribed to, so a refresh of it never rebuilds the controller.
export function useTimelineDrag(
  store: EditorStore,
  scrollRef: RefObject<HTMLElement | null>,
  rowsRef: RefObject<HTMLElement | null>,
  zoom: number,
): TimelineDrag {
  const { library } = useMedia();
  const drag = useMemo(() => createTimelineDrag(store, (id) => library.getState().assets[id]), [store, library]);
  useLayoutEffect(() => {
    drag.attach(scrollRef.current, rowsRef.current);
    drag.setZoom(zoom);
  });
  useEffect(() => () => drag.dispose(), [drag]);
  return drag;
}

// The timeline's drag controller, for clips, rows and track headers. Null outside a timeline.
export function useClipDrag(): TimelineDrag | null {
  return useContext(TimelineDragContext);
}
