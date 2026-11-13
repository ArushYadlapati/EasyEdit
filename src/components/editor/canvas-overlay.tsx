"use client";

import { useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { cx } from "@/components/ui/cx";
import type { Point } from "@/lib/editor/board";
import {
  clampInto,
  corners,
  cursorFor,
  fromScreen,
  handlePoints,
  hitTest,
  toOverlay,
  type Box,
  type CanvasItem,
  type Handle,
  type PreviewSurface,
  type View,
} from "@/lib/editor/canvas-geometry";
import { previewMenu, rightClickEntries } from "@/lib/editor/menus";
import { viewDoc, type EditorState } from "@/lib/editor/store";
import { useClipboard, useEditorStore } from "./context";
import { useToMenuItems } from "./menu-items";
import { CLICK_SLOP_PX } from "./timeline/use-clip-drag";
import { useCanvasDrag } from "./use-canvas-drag";
import { useClipMenu } from "./use-clip-menu";
import { useCommandRunner, useIsMac } from "./use-shortcuts";

// How far outside a clip's box, in CSS pixels, a press still takes it.
const HIT_SLOP_PX = 4;

// The handles, in CSS pixels: each is an 8 px square in a 24 px target, or just the square on a box under 48 px a
// side. A handle off the visible pane is drawn 12 px inside its edge, and one that would land within 12 px of a handle
// placed before it, when either was clamped, is left out. A box thinner than 24 px has its side handles 12 px outside.
// The rotate handle is 24 px above the top edge (36 when n and s are pushed out), or 36 px inside from n when there is
// no room above.
const SQUARE_PX = 8;
const TARGET_PX = 24;
const SMALL_BOX_PX = 48;
const EDGE_PX = 12;
const ROTATE_PX = 24;
const ROTATE_FAR_PX = 36;

// The order handles are placed in; a later one clamped onto an earlier one's spot is the one left out.
const PLACING: Handle[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];

// No preview menu offers "Keyboard shortcuts", so its commands never open them.
const noShortcuts = () => {};

type Outline = { clipId: string; points: string };
// A handle where it is drawn, in overlay pixels; clamped when it was moved into the visible pane.
type HandleView = { grip: Handle | "rotate"; clipId: string; left: number; top: number; size: number; cursor: string; clamped: boolean };
type Guide = { axis: "x" | "y"; x1: number; y1: number; x2: number; y2: number };
type Drawn = { outlines: Outline[]; handles: HandleView[]; guides: Guide[] };

// A clamped handle being dragged is drawn at the pointer (client pixels, null until it moves), clamped the same way.
type Follow = { pointerId: number; grip: Handle; client: Point | null };

// A press waiting for its release: on a selected clip the release leaves only that clip ("only"); with Shift, Cmd
// or (away from a Mac) Ctrl it toggles the clip. A pointer that passes the click slop does neither.
type Press = { pointerId: number; clipId: string; x: number; y: number; then: "toggle" | "only" | null };

// Overlay pixels are kept to two decimals, so the same place always reads the same.
const px = (v: number) => Math.round(v * 100) / 100;

// The layer over the preview board, frame and margin alike, where clips are pressed, right-clicked, outlined, moved,
// turned and resized. What it draws is worked out outside render, whenever the preview draws or its board moves and
// whenever the selection or a drag's guides change, and only a change is set. A press selects the top-most clip under
// the pointer, clicking through locked tracks; outside the frame only a selected clip takes it; a press that travels
// moves the clip. One selected clip that can be edited, paused, has eight handles and a rotate handle. A right-click
// opens the clip's menu (a handle's is its clip's), or the preview's when it lands on nothing or on a clip of a locked
// track. On a Mac a Ctrl press is that right-click.
export function CanvasOverlay({ surface, pane }: { surface: PreviewSurface; pane: RefObject<HTMLElement | null> }): ReactNode {
  const store = useEditorStore();
  const clipboard = useClipboard();
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  const run = useCommandRunner(noShortcuts);
  const openClipMenu = useClipMenu();
  const isMac = useIsMac();
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const follow = useRef<Follow | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const drag = useCanvasDrag(surface, pane);
  const [drawn] = useState(() => createStore<Drawn>(() => ({ outlines: [], handles: [], guides: [] })));
  const outlines = useStore(drawn, (s) => s.outlines);
  const handles = useStore(drawn, (s) => s.handles);
  const guides = useStore(drawn, (s) => s.guides);

  useLayoutEffect(() => {
    const refresh = () => {
      const el = ref.current;
      const view = surface.view();
      const state = store.getState();
      let next: Drawn = { outlines: [], handles: [], guides: [] };
      if (el && view) {
        const box = el.getBoundingClientRect();
        const items = surface.items();
        const f = follow.current;
        const followed = f?.client ? { grip: f.grip, at: { x: f.client.x - box.left, y: f.client.y - box.top } } : null;
        next = {
          outlines: outlinesOf(items, state.selection.clipIds, view, box),
          handles: handlesOf(state, items, view, box, surface.visible(), followed),
          guides: guidesOf(drag.guides.getState(), viewDoc(state), view, box),
        };
      }
      const now = drawn.getState();
      const patch: Partial<Drawn> = {};
      if (!sameOutlines(now.outlines, next.outlines)) patch.outlines = next.outlines;
      if (JSON.stringify(now.handles) !== JSON.stringify(next.handles)) patch.handles = next.handles;
      if (JSON.stringify(now.guides) !== JSON.stringify(next.guides)) patch.guides = next.guides;
      if (Object.keys(patch).length > 0) drawn.setState(patch);
    };
    refreshRef.current = refresh;
    const stopSurface = surface.onChange(refresh);
    const stopStore = store.subscribe((s, prev) => {
      if (s.selection !== prev.selection || s.canEdit !== prev.canEdit || s.playing !== prev.playing) refresh();
    });
    const stopGuides = drag.guides.subscribe(refresh);
    return () => {
      stopSurface();
      stopStore();
      stopGuides();
      refreshRef.current = () => {};
    };
  }, [surface, store, drawn, drag]);

  // A dragged handle stops following the pointer when the pointer comes up or is lost.
  function stopFollowing(pointerId: number) {
    if (follow.current?.pointerId !== pointerId) return;
    follow.current = null;
    refreshRef.current();
  }

  // A press on a handle starts its drag at once, whatever the modifiers. One drawn clamped into the pane tells the
  // drag where it was drawn, and is then drawn at the pointer.
  function onHandleDown(e: PointerEvent<HTMLDivElement>, grip: Handle | "rotate") {
    const shown = drawn.getState().handles.find((h) => h.grip === grip);
    const view = surface.view();
    if (!shown || !view) return;
    const box = e.currentTarget.getBoundingClientRect();
    const clamped = shown.clamped && grip !== "rotate";
    const at = clamped ? fromScreen(view, box.left + shown.left, box.top + shown.top) : undefined;
    follow.current = clamped ? { pointerId: e.pointerId, grip, client: null } : null;
    drag.press(e, grip, shown.clipId, at);
  }

  // The clip under a client point, with the slop and frame rule every press and right-click uses.
  function hitAt(state: EditorState, view: View, clientX: number, clientY: number, includeLocked: boolean): CanvasItem | null {
    const doc = viewDoc(state);
    return hitTest(surface.items(), fromScreen(view, clientX, clientY), HIT_SLOP_PX / view.k, {
      includeLocked,
      frame: { width: doc.width, height: doc.height },
      keep: state.selection.clipIds,
    });
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (isMac && e.ctrlKey) return;
    press.current = null;
    if (e.button !== 0) return;
    const grip = gripOf(e.target);
    if (grip) return onHandleDown(e, grip);
    const view = surface.view();
    if (!view) return;
    const state = store.getState();
    const hit = hitAt(state, view, e.clientX, e.clientY, false);
    if (!hit) {
      state.select([]);
      return;
    }
    const toggle = e.shiftKey || e.metaKey || (!isMac && e.ctrlKey);
    const selected = state.selection.clipIds.includes(hit.clipId);
    if (!toggle && !selected) state.select([hit.clipId]);
    press.current = { pointerId: e.pointerId, clipId: hit.clipId, x: e.clientX, y: e.clientY, then: toggle ? "toggle" : selected ? "only" : null };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; its release still arrives here or not at all.
    }
    // Once it travels the press moves the clip, which the drag makes the only selection.
    drag.press(e, "body", hit.clipId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const f = follow.current;
    if (f && f.pointerId === e.pointerId) {
      f.client = { x: e.clientX, y: e.clientY };
      refreshRef.current();
    }
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP_PX) p.then = null;
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    stopFollowing(e.pointerId);
    const p = press.current;
    press.current = null;
    if (!p || p.pointerId !== e.pointerId || p.then === null) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP_PX) return;
    store.getState().select([p.clipId], p.then === "toggle" ? "toggle" : "replace");
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!menu) return;
    const grip = gripOf(e.target);
    const shown = grip ? drawn.getState().handles.find((h) => h.grip === grip) : undefined;
    if (shown) {
      openClipMenu(e, shown.clipId);
      return;
    }
    const view = surface.view();
    const state = store.getState();
    const hit = view ? hitAt(state, view, e.clientX, e.clientY, true) : null;
    if (hit && !hit.locked) {
      openClipMenu(e, hit.clipId);
      return;
    }
    const entries = rightClickEntries(previewMenu(state, clipboard.read() !== null), state.canEdit);
    if (entries.length === 0) return;
    menu({
      ...menuPoint(e),
      label: "Preview",
      items: toItems(entries),
      onSelect: (id) => {
        if (id === "paste") run("paste");
        else if (id === "safe-zones") store.getState().toggleSafeZones();
      },
    });
  }

  return (
    <div
      ref={ref}
      data-canvas-overlay
      className="absolute inset-0 touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        press.current = null;
        stopFollowing(e.pointerId);
      }}
      onLostPointerCapture={(e) => {
        press.current = null;
        stopFollowing(e.pointerId);
      }}
      onContextMenu={onContextMenu}
    >
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {outlines.map((o) => (
          <polygon
            key={o.clipId}
            points={o.points}
            fill="none"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            className="stroke-ed-accent"
          />
        ))}
        {guides.map((g) => (
          <line
            key={g.axis}
            data-canvas-guide={g.axis}
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            className="stroke-ed-accent"
          />
        ))}
      </svg>
      {handles.map((h) => (
        <div
          key={h.grip}
          data-canvas-handle={h.grip}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: h.left, top: h.top, width: h.size, height: h.size, cursor: h.cursor }}
        >
          <span className={cx("size-2 border border-ed-accent bg-ed-bg", h.grip === "rotate" && "rounded-full")} />
        </div>
      ))}
    </div>
  );
}

// The handle a press or right-click landed on, if any.
function gripOf(target: EventTarget): Handle | "rotate" | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-canvas-handle]");
  return (el?.dataset.canvasHandle as Handle | "rotate" | undefined) ?? null;
}

const inside = (p: Point, box: Box) => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;

// The handles of the one selected clip, when it is drawn now, can be edited, is on an unlocked track and nothing
// plays, in the overlay's pixels. followed: a dragged clamped handle drawn at the pointer.
function handlesOf(
  state: EditorState,
  items: CanvasItem[],
  view: View,
  overlay: { left: number; top: number },
  visible: Box | null,
  followed: { grip: Handle; at: Point } | null,
): HandleView[] {
  const ids = state.selection.clipIds;
  if (ids.length !== 1 || !state.canEdit || state.playing || !visible) return [];
  const item = items.find((i) => i.clipId === ids[0]);
  if (!item || item.locked) return [];
  const k = view.k;
  const width = (item.rect.right - item.rect.left) * item.sx * k;
  const height = (item.rect.bottom - item.rect.top) * item.sy * k;
  const size = Math.min(width, height) < SMALL_BOX_PX ? SQUARE_PX : TARGET_PX;
  const push = { ew: height < TARGET_PX ? EDGE_PX / k : 0, ns: width < TARGET_PX ? EDGE_PX / k : 0 };
  const rotateOffset = (push.ns > 0 ? ROTATE_FAR_PX : ROTATE_PX) / k;
  const at = new Map(handlePoints(item, rotateOffset, push).map((p) => [p.grip, toOverlay(view, overlay, p.at)]));

  const placed: HandleView[] = [];
  const shownAs = (grip: Handle | "rotate", p: Point, clamped: boolean, cursor: string): HandleView => ({
    grip,
    clipId: item.clipId,
    left: p.x,
    top: p.y,
    size,
    cursor,
    clamped,
  });
  for (const grip of PLACING) {
    const raw = at.get(grip)!;
    const isFollowed = followed?.grip === grip;
    const p = clampInto(isFollowed ? followed.at : raw, visible, EDGE_PX);
    const clamped = isFollowed || p.x !== raw.x || p.y !== raw.y;
    const onAnother = placed.some(
      (h) => h.grip !== followed?.grip && (h.clamped || clamped) && Math.hypot(h.left - p.x, h.top - p.y) < EDGE_PX,
    );
    if (onAnother && !isFollowed) continue;
    placed.push(shownAs(grip, p, clamped, cursorFor(grip, item.rotation)));
  }

  // With no room above the clip, the rotate handle goes 36 px inside from n's clamped spot, toward the box's middle.
  let rotate = at.get("rotate")!;
  const room = { left: visible.left + EDGE_PX, top: visible.top + EDGE_PX, right: visible.right - EDGE_PX, bottom: visible.bottom - EDGE_PX };
  if (!inside(rotate, room)) {
    const n = clampInto(at.get("n")!, visible, EDGE_PX);
    const a = (item.rotation * Math.PI) / 180;
    rotate = clampInto({ x: n.x - Math.sin(a) * ROTATE_FAR_PX, y: n.y + Math.cos(a) * ROTATE_FAR_PX }, visible, EDGE_PX);
  }
  placed.push(shownAs("rotate", rotate, false, "grab"));

  return placed.map((h) => ({ ...h, left: px(h.left), top: px(h.top) }));
}

// The frame's centre lines a moved clip is snapped to, across the frame, in the overlay's pixels.
function guidesOf(
  snapped: { x: number | null; y: number | null },
  frame: { width: number; height: number },
  view: View,
  overlay: { left: number; top: number },
): Guide[] {
  const line = (axis: "x" | "y", from: Point, to: Point): Guide => {
    const a = toOverlay(view, overlay, from);
    const b = toOverlay(view, overlay, to);
    return { axis, x1: px(a.x), y1: px(a.y), x2: px(b.x), y2: px(b.y) };
  };
  const out: Guide[] = [];
  if (snapped.x !== null) out.push(line("x", { x: snapped.x, y: 0 }, { x: snapped.x, y: frame.height }));
  if (snapped.y !== null) out.push(line("y", { x: 0, y: snapped.y }, { x: frame.width, y: snapped.y }));
  return out;
}

// The outline of each selected clip drawn now, in the overlay's pixels.
function outlinesOf(items: CanvasItem[], selected: string[], view: View, overlay: { left: number; top: number }): Outline[] {
  return items
    .filter((item) => selected.includes(item.clipId))
    .map((item) => ({
      clipId: item.clipId,
      points: corners(item)
        .map((p) => toOverlay(view, overlay, p))
        .map((p) => `${px(p.x)},${px(p.y)}`)
        .join(" "),
    }));
}

function sameOutlines(a: Outline[], b: Outline[]): boolean {
  return a.length === b.length && a.every((o, i) => o.clipId === b[i].clipId && o.points === b[i].points);
}
