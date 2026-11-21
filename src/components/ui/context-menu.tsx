"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MenuList, type MenuItem } from "./menu";

const EDGE = 8; // the menu keeps this far from the window's edges

// What a right-click asks for: a menu at a point on screen, named by label. onSelect runs after the menu has closed
// and focus has gone back to returnFocus (while it is on the page), or else to what had focus before the menu opened.
export type ContextMenuRequest = {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  onSelect(id: string): void;
  returnFocus?: HTMLElement | null;
};

type Open = (request: ContextMenuRequest) => void;

const ContextMenuContext = createContext<Open | null>(null);

// Opens a menu where something was right-clicked. Null outside a provider: a right-click there opens nothing.
export function useContextMenu(): Open | null {
  return useContext(ContextMenuContext);
}

// Where a menu opens for a contextmenu event: at the pointer when it is on the element, else at the element's
// lower-left corner, as when Shift+F10 or the Menu key opened it.
export function menuPoint(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
  const box = e.currentTarget.getBoundingClientRect();
  const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
  return inside ? { x: e.clientX, y: e.clientY } : { x: box.left, y: box.bottom };
}

// The menu's top-left corner: right of and below the point when it fits, else left of or above it, kept inside the
// window.
export function placeAtPoint(
  point: { x: number; y: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { top: number; left: number } {
  const along = (at: number, length: number, room: number) => {
    const start = at + length <= room - EDGE ? at : at - length;
    return Math.max(EDGE, Math.min(start, room - EDGE - length));
  };
  return { top: along(point.y, size.height, view.height), left: along(point.x, size.width, view.width) };
}

// anchor: what was right-clicked, as far as it is known.
type Shown = { request: ContextMenuRequest; before: Element | null; anchor: Element | null; key: number };

// What a request was made on: the element it gives focus back to, else whatever is at its point.
function anchorOf(request: ContextMenuRequest): Element | null {
  if (request.returnFocus) return request.returnFocus;
  return typeof document.elementFromPoint === "function" ? document.elementFromPoint(request.x, request.y) : null;
}

// Holds the one right-click menu on screen. Each request replaces the menu and draws it afresh. A press outside it,
// a resize, and a scroll that moves what was right-clicked close it; a pick or Escape closes it and puts focus back.
// A scroll of some other part of the window leaves it open: a right-click that selects a clip can change the panel
// beside it, and a panel that grows shorter scrolls itself.
export function ContextMenuProvider({ children }: { children: ReactNode }): ReactNode {
  const [shown, setShown] = useState<Shown | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const open = useCallback<Open>((request) => {
    // The menu being replaced is not what had focus: what had it before that menu still does.
    const active = document.activeElement;
    const fromMenu = list.current?.contains(active) ?? false;
    const anchor = anchorOf(request);
    setShown((now) => ({ request, before: now && fromMenu ? now.before : active, anchor, key: (now?.key ?? 0) + 1 }));
  }, []);

  const focusBack = useCallback((at: Shown) => {
    const back = at.request.returnFocus?.isConnected ? at.request.returnFocus : at.before;
    if (back instanceof HTMLElement || back instanceof SVGElement) back.focus();
  }, []);

  useEffect(() => {
    if (!shown) return;
    function onPointerDown(event: PointerEvent) {
      if (list.current?.contains(event.target as Node)) return;
      setShown(null);
      // A press on something that takes focus keeps it; otherwise focus goes back.
      setTimeout(() => {
        if (document.activeElement === document.body) focusBack(shown!);
      }, 0);
    }
    function onScroll(event: Event) {
      const scrolled = event.target;
      if (list.current?.contains(scrolled as Node)) return;
      // The page, or a box around what was right-clicked, moves it from under the menu. So does a scroll when it is not
      // known what was right-clicked, or it is gone.
      const anchor = shown!.anchor;
      const elsewhere = scrolled instanceof Element && anchor !== null && anchor.isConnected && !scrolled.contains(anchor);
      if (!elsewhere) setShown(null);
    }
    function onResize() {
      setShown(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [shown, focusBack]);

  function close(refocus: boolean) {
    if (!shown) return;
    setShown(null);
    if (refocus) focusBack(shown);
  }

  return (
    <ContextMenuContext.Provider value={open}>
      {children}
      {shown && (
        <MenuList
          key={shown.key}
          ref={list}
          label={shown.request.label}
          items={shown.request.items}
          openAt="first"
          place={(size) => placeAtPoint(shown.request, size, { width: window.innerWidth, height: window.innerHeight })}
          onPick={(id) => {
            close(true);
            shown.request.onSelect(id);
          }}
          onDismiss={close}
        />
      )}
    </ContextMenuContext.Provider>
  );
}
