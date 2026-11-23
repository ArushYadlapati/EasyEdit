import type { TextStyle } from "./types";

// What a text clip's optional style fields mean when they are absent. Lengths that follow the text (spacing, the
// background's padding and rounding) are shares of the font size; the outline, the shadow's blur and its offsets are
// project pixels.
export const TEXT_STYLE_DEFAULTS = {
  italic: false,
  underline: false,
  letterSpacing: 0, // × font size, added after each character
  lineHeight: 1.2, // × font size, from one line to the next
  outlineColor: null as string | null, // null: no outline
  outlineWidth: 0, // how far the outline reaches out from the letters
  shadowColor: null as string | null, // null: no shadow
  shadowBlur: 0,
  shadowX: 0,
  shadowY: 0,
  shadowOpacity: 0.6,
  backgroundColor: null as string | null, // null: no box behind the text
  backgroundOpacity: 1,
  backgroundPadding: 0.3, // × font size, around the lines
  backgroundRadius: 0.2, // × font size
};

export type TextExtraKey = keyof typeof TEXT_STYLE_DEFAULTS;
export type TextExtras = typeof TEXT_STYLE_DEFAULTS;

export const TEXT_EXTRA_KEYS = Object.keys(TEXT_STYLE_DEFAULTS) as TextExtraKey[];

// A style with every optional field given its value.
export function textExtras(style: TextStyle): TextExtras {
  const all: Record<string, unknown> = { ...TEXT_STYLE_DEFAULTS };
  for (const key of TEXT_EXTRA_KEYS) if (style[key] !== undefined) all[key] = style[key];
  return all as TextExtras;
}

export function hasOutline(look: Pick<TextExtras, "outlineColor" | "outlineWidth">): look is TextExtras & { outlineColor: string } {
  return look.outlineColor !== null && look.outlineWidth > 0;
}

export function hasShadow(look: Pick<TextExtras, "shadowColor" | "shadowOpacity">): look is TextExtras & { shadowColor: string } {
  return look.shadowColor !== null && look.shadowOpacity > 0;
}

export function hasBackground(look: Pick<TextExtras, "backgroundColor" | "backgroundOpacity">): look is TextExtras & { backgroundColor: string } {
  return look.backgroundColor !== null && look.backgroundOpacity > 0;
}

// What turning each of them on gives a text of this size, when it has no values of its own yet.
export function outlineStart(fontSize: number) {
  return { outlineColor: "#000000", outlineWidth: Math.max(1, Math.round(fontSize * 0.08)) };
}

export function shadowStart(fontSize: number) {
  return { shadowColor: "#000000", shadowBlur: Math.round(fontSize * 0.15), shadowX: 0, shadowY: Math.max(1, Math.round(fontSize * 0.06)) };
}

export const BACKGROUND_START = { backgroundColor: "#000000", backgroundOpacity: 0.8 };
