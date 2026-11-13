import { graphemes } from "@/lib/text";
import type { TextClip } from "@/lib/timeline";

export const TEXT_BOX_WIDTH = 0.9; // of the project width
export const LINE_HEIGHT = 1.2; // × font size

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
  return lines.map((text, i) => ({ text, x, y: (i - (lines.length - 1) / 2) * clip.style.fontSize * LINE_HEIGHT }));
}

// A box in project pixels from the clip's centre, before scale and rotation.
export type LocalRect = { left: number; top: number; right: number; bottom: number };

// The box the text's lines take up, as measured. Text with no width is half its font size wide around the anchor.
export function textRect(clip: TextClip, docWidth: number, measure: (s: string) => number): LocalRect {
  const { fontSize, align } = clip.style;
  const lines = layoutText(clip, docWidth, measure);
  const half = (fontSize * LINE_HEIGHT) / 2;
  let left = Infinity;
  let right = -Infinity;
  for (const line of lines) {
    const w = measure(line.text);
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
