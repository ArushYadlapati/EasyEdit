"use client";

import { useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { corners, fromScreen, hitTest, toOverlay, type CanvasItem, type PreviewSurface, type View } from "@/lib/editor/canvas-geometry";
import { previewMenu, rightClickEntries } from "@/lib/editor/menus";
import { viewDoc, type EditorState } from "@/lib/editor/store";
import { useClipboard, useEditorStore } from "./context";
import { useToMenuItems } from "./menu-items";
import { CLICK_SLOP_PX } from "./timeline/use-clip-drag";
import { useClipMenu } from "./use-clip-menu";
import { useCommandRunner, useIsMac } from "./use-shortcuts";

// How far outside a clip's box, in CSS pixels, a press still takes it.
const HIT_SLOP_PX = 4;

// No preview menu offers "Keyboard shortcuts", so its commands never open them.
const noShortcuts = () => {};

type Outline = { clipId: string; points: string };
type Drawn = { outlines: Outline[] };

// A press waiting for its release: on a selected clip the release leaves only that clip ("only"); with Shift, Cmd
// or (away from a Mac) Ctrl it toggles the clip. A pointer that passes the click slop does neither.
type Press = { pointerId: number; clipId: string; x: number; y: number; then: "toggle" | "only" | null };

// Overlay pixels are kept to two decimals, so the same place always reads the same.
const px = (v: number) => Math.round(v * 100) / 100;

// The layer over the preview board, frame and margin alike, where clips are pressed, right-clicked and outlined.
// What it draws is worked out outside render, whenever the preview draws or its board moves and whenever the
// selection changes, and only a change is set. A press selects the top-most clip under the pointer, clicking through
// locked tracks; outside the frame only a selected clip takes it. A right-click opens the clip's menu, or the
// preview's when it lands on nothing or on a clip of a locked track. On a Mac a Ctrl press is that right-click.
export function CanvasOverlay({ surface }: { surface: PreviewSurface; pane: RefObject<HTMLElement | null> }): ReactNode {
  const store = useEditorStore();
  const clipboard = useClipboard();
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  const run = useCommandRunner(noShortcuts);
  const openClipMenu = useClipMenu();
  const isMac = useIsMac();
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const [drawn] = useState(() => createStore<Drawn>(() => ({ outlines: [] })));
  const outlines = useStore(drawn, (s) => s.outlines);

  useLayoutEffect(() => {
    const refresh = () => {
      const el = ref.current;
      const view = surface.view();
      const next = el && view ? outlinesOf(surface.items(), store.getState().selection.clipIds, view, el.getBoundingClientRect()) : [];
      if (!sameOutlines(drawn.getState().outlines, next)) drawn.setState({ outlines: next });
    };
    const stopSurface = surface.onChange(refresh);
    const stopStore = store.subscribe((s, prev) => {
      if (s.selection !== prev.selection || s.canEdit !== prev.canEdit || s.playing !== prev.playing) refresh();
    });
    return () => {
      stopSurface();
      stopStore();
    };
  }, [surface, store, drawn]);

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
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP_PX) p.then = null;
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const p = press.current;
    press.current = null;
    if (!p || p.pointerId !== e.pointerId || p.then === null) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP_PX) return;
    store.getState().select([p.clipId], p.then === "toggle" ? "toggle" : "replace");
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!menu) return;
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
      onPointerCancel={() => (press.current = null)}
      onLostPointerCapture={() => (press.current = null)}
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
      </svg>
    </div>
  );
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
