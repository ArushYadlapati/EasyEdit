type Part = string | false | null | undefined | 0;

export function cx(...parts: Part[]): string {
  return parts.filter(Boolean).join(" ");
}

// Shared looks, so every control reads the same. Focus is a 2 px accent outline: 2 px outside
// buttons, drawn inside the edge for inputs. Colors fade in 120 ms unless motion is reduced.
export const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ed-accent";
export const FOCUS_RING_INSET = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ed-accent";
export const FADE = "transition-[color,background-color,border-color,opacity] duration-120 motion-reduce:transition-none";
export const DISABLED = "disabled:cursor-not-allowed disabled:opacity-40";
// A boxed text field: 13 px text, raised fill and an input border. Single-line fields add h-7 (28 px).
export const FIELD_BOX = cx(
  "w-full min-w-0 rounded-md border border-ed-line-strong bg-ed-raised px-2 text-[13px] leading-5 text-ed-text placeholder:text-ed-muted",
  FOCUS_RING_INSET,
  FADE,
  DISABLED,
);
// A number you drag sideways, as in Premiere: at rest an underlined accent value with no box, a box only while it is
// typed in. FIELD_BOX's size, padding, focus ring and fade, never mixed with its border and fill.
export const SCRUB_BOX = cx(
  "w-full min-w-0 rounded-md px-2 text-[13px] leading-5 placeholder:text-ed-muted",
  FOCUS_RING_INSET,
  FADE,
  "border border-transparent bg-transparent text-ed-accent underline decoration-dotted underline-offset-4 cursor-ew-resize",
  "enabled:hover:border-ed-line focus:border-ed-line-strong focus:bg-ed-raised focus:text-ed-text focus:no-underline focus:cursor-text",
  "disabled:text-ed-text disabled:no-underline disabled:cursor-default",
);
