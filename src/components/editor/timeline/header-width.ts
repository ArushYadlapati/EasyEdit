import { useSyncExternalStore } from "react";
import { HEADER_WIDTH } from "@/lib/editor/geometry";

// The width of the timeline's column of track names. Below the lg width (a phone, where the editor's panels stack) the
// column is narrow, so the lanes get most of the screen: a track's name and its options menu, no switches.

export const PHONE_HEADER_WIDTH = 116;
const WIDE = "(min-width: 1024px)"; // Tailwind's lg, where the panels sit side by side

const query = () => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? null : window.matchMedia(WIDE));

// The width now, for pointer and scroll handlers, which run long after a render.
export function headerWidthNow(): number {
  const wide = query();
  return wide === null || wide.matches ? HEADER_WIDTH : PHONE_HEADER_WIDTH;
}

function subscribe(changed: () => void): () => void {
  const wide = query();
  if (wide === null) return () => {};
  wide.addEventListener("change", changed);
  return () => wide.removeEventListener("change", changed);
}

// The width for drawing. The server, and the first paint in the browser, use the wide one; a phone corrects itself
// before it is seen.
export function useHeaderWidth(): number {
  return useSyncExternalStore(subscribe, headerWidthNow, () => HEADER_WIDTH);
}
