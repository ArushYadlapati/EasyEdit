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
// The chosen one of a set (a tab, a pressed toggle, a checked segment, the current page) is told apart by more than
// its tint and blue words, which differ from the rest mostly in hue: it also takes a 1 px Selection Blue edge drawn
// inside it, 7.07:1 against the panel, which takes no room from its words. With the system's high contrast colours,
// where fills and shadows are dropped, the edge is 2 px in the system's selection colour instead. Each keys on the
// state's own attribute; CHOSEN_EDGE.on is for a control that is already known to be the chosen one.
export const CHOSEN_EDGE = {
  selected: "aria-selected:inset-ring aria-selected:inset-ring-ed-accent forced-colors:aria-selected:border-2 forced-colors:aria-selected:border-[Highlight]",
  pressed: "aria-pressed:inset-ring aria-pressed:inset-ring-ed-accent forced-colors:aria-pressed:border-2 forced-colors:aria-pressed:border-[Highlight]",
  checked: "aria-checked:inset-ring aria-checked:inset-ring-ed-accent forced-colors:aria-checked:border-2 forced-colors:aria-checked:border-[Highlight]",
  on: "inset-ring inset-ring-ed-accent forced-colors:border-2 forced-colors:border-[Highlight]",
} as const;
// A boxed text field: 13 px text, raised fill and a field edge. The fill is barely lighter than a panel, so the edge is
// what shows where an empty field is. Single-line fields add h-7 (28 px).
export const FIELD_BOX = cx(
  "w-full min-w-0 rounded-md border border-ed-field-line bg-ed-raised px-2 text-[13px] leading-5 text-ed-text placeholder:text-ed-muted",
  FOCUS_RING_INSET,
  FADE,
  DISABLED,
);
// A number you drag sideways, as in Premiere: at rest an underlined accent value with no box, a box only while it is
// typed in. FIELD_BOX's size, padding, focus ring and fade, never mixed with its border and fill. The faint hover box is
// for the resting value only: a click types in the field with the pointer still over it, and a plain hover rule would
// outrank the focus edge there.
export const SCRUB_BOX = cx(
  "w-full min-w-0 rounded-md px-2 text-[13px] leading-5 placeholder:text-ed-muted",
  FOCUS_RING_INSET,
  FADE,
  "border border-transparent bg-transparent text-ed-accent underline decoration-dotted underline-offset-4 cursor-ew-resize",
  "enabled:not-focus:hover:border-ed-line focus:border-ed-field-line focus:bg-ed-raised focus:text-ed-text focus:no-underline focus:cursor-text",
  "disabled:text-ed-text disabled:no-underline disabled:cursor-default",
);
// A color input, as a field-sized box the chosen color fills. It keeps the field edge, so a color close to the panel's
// still shows where the control is, and the browser's own swatch border and padding are taken off so there is only one.
export const SWATCH_BOX = cx(
  "h-7 w-9 shrink-0 cursor-pointer rounded-md border border-ed-field-line bg-ed-raised p-0.5",
  "[&::-moz-color-swatch]:rounded-[4px] [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0",
  FOCUS_RING_INSET,
  FADE,
  DISABLED,
);
// A small tag beside a name, such as Starter or Soon: the label size, 11 px, which is as small as words to read get. It is
// the same look as the editor's View only tag, 6 px a side like a key cap.
export const TAG = "shrink-0 rounded-[4px] border border-ed-line px-1.5 text-[11px] leading-4 font-medium text-ed-muted";
// An error or warning on a plain page outside the app (sign-in, the passkey button, consent, an invite): the words in
// the danger colour, with no box behind them. --danger (globals.css) is deep enough to read on a white page and light
// enough on a dark one, so the same class works on pages that follow the computer's setting and on the dark site.
export const PLAIN_ERROR = "text-base font-medium text-danger text-pretty";
