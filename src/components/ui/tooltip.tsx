"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// How long the pointer rests on a button before its tip shows. The browser's own title tooltip waits about a second
// and that can't be changed, which is why buttons draw their own.
export const TIP_DELAY_MS = 150;
// After a tip goes away, the next one shows at once for this long, so reading along a row of buttons has no waits.
export const TIP_WARM_MS = 400;

const GAP = 6; // between the button and its tip
const EDGE = 4; // a tip keeps this far from the window's edges

export type TipSide = "bottom" | "right";
type Box = { left: number; top: number; right: number; bottom: number };

// The tip's top-left corner: under the button and centred on it, or to its right and centred, flipped to the other
// side when there is no room, and kept inside the window.
export function placeTip(
  anchor: Box,
  size: { width: number; height: number },
  view: { width: number; height: number },
  side: TipSide,
): { left: number; top: number } {
  const within = (at: number, length: number, room: number) => Math.max(EDGE, Math.min(at, room - EDGE - length));
  if (side === "right") {
    const fits = anchor.right + GAP + size.width <= view.width - EDGE;
    return {
      left: fits ? anchor.right + GAP : Math.max(EDGE, anchor.left - GAP - size.width),
      top: within((anchor.top + anchor.bottom - size.height) / 2, size.height, view.height),
    };
  }
  const fits = anchor.bottom + GAP + size.height <= view.height - EDGE;
  return {
    left: within((anchor.left + anchor.right - size.width) / 2, size.width, view.width),
    top: fits ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - size.height),
  };
}

let lastShown = -Infinity; // when any tip was last on screen

function focusShows(target: Element): boolean {
  try {
    return target.matches(":focus-visible");
  } catch {
    return false; // a browser without :focus-visible
  }
}

// Whether a button's tip is showing. It shows once the pointer has rested on the button, or at once when the button
// is reached with the keyboard, and goes when the pointer leaves, on a press, on Escape, when focus leaves, and when
// anything scrolls. A touch never shows one: there is no hover to end it.
export function useTip(enabled: boolean) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const up = useRef(false); // shown, as the handlers know it before the next draw
  const open = shown && enabled;

  // Show now (0), after a wait, or not at all (null): whatever was waiting is dropped.
  const wait = useCallback((ms: number | null) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const show = () => {
      timer.current = null;
      up.current = true;
      setShown(true);
    };
    if (ms === 0) show();
    else if (ms !== null) timer.current = setTimeout(show, ms);
  }, []);
  // The time is noted here, not when the tip is next drawn away: the pointer leaves one button and enters the next
  // in the same moment, and the next one asks how long ago this was before anything is drawn.
  const hide = useCallback(() => {
    wait(null);
    if (up.current) lastShown = performance.now();
    up.current = false;
    setShown(false);
  }, [wait]);

  useEffect(() => () => wait(null), [wait]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      lastShown = performance.now();
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [open, hide]);

  return {
    open,
    hide,
    enter(pointerType: string) {
      if (!enabled || pointerType === "touch") return;
      wait(performance.now() - lastShown < TIP_WARM_MS ? 0 : TIP_DELAY_MS);
    },
    focus(target: Element) {
      if (enabled && focusShows(target)) wait(0);
    },
  };
}

// The tip itself, drawn inside the button it describes so it takes the button's theme, and fixed to the window so
// nothing that scrolls or clips the button cuts it off. The button's label already names it for a screen reader.
export function Tip({ side, children }: { side: TipSide; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const tip = ref.current;
    const anchor = tip?.parentElement;
    if (!tip || !anchor) return;
    tip.style.left = "0px";
    tip.style.top = "0px";
    // Where "fixed at 0, 0" really is: the window's corner, unless something around the button is transformed.
    const origin = tip.getBoundingClientRect();
    const at = placeTip(anchor.getBoundingClientRect(), origin, { width: window.innerWidth, height: window.innerHeight }, side);
    tip.style.left = `${at.left - origin.left}px`;
    tip.style.top = `${at.top - origin.top}px`;
    tip.style.visibility = "visible";
  });

  return (
    <span
      ref={ref}
      aria-hidden
      data-tooltip
      style={{ left: 0, top: 0, visibility: "hidden" }}
      className="pointer-events-none fixed z-50 block w-max max-w-72 cursor-default rounded-[4px] border border-ed-line-strong bg-ed-raised px-2 py-1 text-left text-xs leading-4 font-medium tracking-normal whitespace-nowrap text-ed-text normal-case"
    >
      {children}
    </span>
  );
}
