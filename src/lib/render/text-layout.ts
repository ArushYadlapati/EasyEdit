import { graphemes } from "@/lib/text";
import type { TextClip, TextStyle } from "@/lib/timeline";
import { TEXT_STYLE_DEFAULTS } from "@/lib/timeline/text-style";

export const TEXT_BOX_WIDTH = 0.9; // of the project width
export const LINE_HEIGHT = TEXT_STYLE_DEFAULTS.lineHeight; // × font size, for a text that sets none of its own

// From one line of a text to the next, as a multiple of its font size.
export function lineHeightOf(style: TextStyle): number {
  return style.lineHeight ?? LINE_HEIGHT;
}

// The canvas font of a text's style. family: its font as a CSS font-family list.
export function textFont(style: TextStyle, family: string): string {
  return `${style.italic ? "italic " : ""}${style.fontWeight} ${style.fontSize}px ${family}`;
}

// The room a text adds after each of its characters, in project pixels. A canvas adds it after a line's last
// character too, where nothing is drawn: a measured line is that much wider than its letters, and a centred or
// right-aligned one sits that much (or half of it) off its anchor unless it is moved back (alignShift).
export function trailOf(style: TextStyle): number {
  return (style.letterSpacing ?? 0) * style.fontSize;
}

// How far right a line's letters must be moved to sit where its alignment says, given that trailing room.
export function alignShift(style: TextStyle): number {
  const trail = trailOf(style);
  return style.align === "center" ? trail / 2 : style.align === "right" ? trail : 0;
}

// A measured line's width as its letters take it: without the room after the last one.
export function lettersWidth(style: TextStyle, text: string, measured: number): number {
  return text.length === 0 ? measured : Math.max(0, measured - trailOf(style));
}

// The room a text adds after each of its characters, as a CSS length for a canvas or an element; null when it adds none.
export function letterSpacingOf(style: TextStyle): string | null {
  const spacing = style.letterSpacing ?? 0;
  return spacing === 0 ? null : `${spacing * style.fontSize}px`;
}

// Cuts one word into pieces that each fit maxWidth (at least one grapheme per piece).
function cutWord(word: string, maxWidth: number, measure: (s: string) => number): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const g of graphemes(word)) {
    if (piece && measure(piece + g) > maxWidth) {
      pieces.push(piece);
      piece = "";
    }
    piece += g;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function wrapParagraph(paragraph: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of paragraph.split(" ").filter(Boolean)) {
    if (current && measure(`${current} ${word}`) <= maxWidth) {
      current = `${current} ${word}`;
      continue;
    }
    if (current) lines.push(current);
    const pieces = measure(word) <= maxWidth ? [word] : cutWord(word, maxWidth, measure);
    current = pieces.pop() ?? "";
    lines.push(...pieces);
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  return text.split(/\r?\n/).flatMap((paragraph) => wrapParagraph(paragraph, maxWidth, measure));
}

export type TextLine = { text: string; x: number; y: number }; // relative to the clip's center, before rotation and scale

export function layoutText(clip: TextClip, docWidth: number, measure: (s: string) => number): TextLine[] {
  const box = TEXT_BOX_WIDTH * docWidth;
  const lines = wrapLines(clip.text, box, measure);
  const x = clip.style.align === "left" ? -box / 2 : clip.style.align === "right" ? box / 2 : 0;
  return lines.map((text, i) => ({ text, x, y: (i - (lines.length - 1) / 2) * clip.style.fontSize * lineHeightOf(clip.style) }));
}

// A box in project pixels from the clip's centre, before scale, stretch and rotation.
export type LocalRect = { left: number; top: number; right: number; bottom: number };

// The box the text's lines take up, as measured. Text with no width is half its font size wide around the anchor.
export function textRect(clip: TextClip, docWidth: number, measure: (s: string) => number): LocalRect {
  const { fontSize, align } = clip.style;
  const lines = layoutText(clip, docWidth, measure);
  const half = (fontSize * lineHeightOf(clip.style)) / 2;
  let left = Infinity;
  let right = -Infinity;
  for (const line of lines) {
    // The letters' own width, so the box hugs them where they are drawn.
    const w = lettersWidth(clip.style, line.text, measure(line.text));
    const start = align === "left" ? line.x : align === "right" ? line.x - w : line.x - w / 2;
    left = Math.min(left, start);
    right = Math.max(right, start + w);
  }
  if (right - left <= 0) {
    const anchor = lines[0].x;
    left = anchor - fontSize * 0.25;
    right = anchor + fontSize * 0.25;
  }
  return { left, top: lines[0].y - half, right, bottom: lines[lines.length - 1].y + half };
}
