import { graphemes } from "@/lib/text";
import type { TextClip, TextSpan, TextStyle } from "@/lib/timeline";
import { spanAt } from "@/lib/timeline/spans";
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

// One character of a styled line. at: which character of the text it is, counting whole characters (as a typed-in
// reveal counts them); word: which of the text's words it is in, −1 for a space; span: the styled span it is in.
export type TextCell = { g: string; at: number; word: number; span: TextSpan | null };

// x, y: relative to the clip's center, before rotation and scale. cells, width: only for a text with styled spans,
// whose line is drawn piece by piece and measured piece by piece.
export type TextLine = { text: string; x: number; y: number; cells?: TextCell[]; width?: number };

// The width of some text in a span's look (null: the clip's own).
export type StyledMeasure = (text: string, span: TextSpan | null) => number;

// A line's cells as stretches that share a span, in order.
export function spanRuns(cells: readonly TextCell[]): { span: TextSpan | null; cells: TextCell[] }[] {
  const runs: { span: TextSpan | null; cells: TextCell[] }[] = [];
  for (const cell of cells) {
    const last = runs.at(-1);
    if (last && last.span === cell.span) last.cells.push(cell);
    else runs.push({ span: cell.span, cells: [cell] });
  }
  return runs;
}

const textOf = (cells: readonly TextCell[]) => cells.map((cell) => cell.g).join("");
const widthOf = (cells: readonly TextCell[], styled: StyledMeasure) => spanRuns(cells).reduce((sum, run) => sum + styled(textOf(run.cells), run.span), 0);

// A text with styled spans, wrapped as wrapLines wraps (words kept whole, a line broken at a space, a word wider
// than the box cut), with each stretch measured in its own look: bold words are wider. Each line keeps its characters.
function wrapStyled(clip: TextClip, maxWidth: number, styled: StyledMeasure): TextCell[][] {
  const spans = clip.spans ?? [];
  const cells: TextCell[] = [];
  let offset = 0;
  let word = -1;
  let inWord = false;
  graphemes(clip.text).forEach((g, at) => {
    const space = /^\s+$/.test(g);
    if (!space && !inWord) word++;
    inWord = !space;
    cells.push({ g, at, word: space ? -1 : word, span: spanAt(spans, offset) });
    offset += g.length;
  });
  const lines: TextCell[][] = [];
  let paragraph: TextCell[] = [];
  const flush = () => {
    const before = lines.length;
    let current: TextCell[] = [];
    let gap: TextCell | null = null; // the space before the word being placed
    let wordCells: TextCell[] = [];
    const place = () => {
      if (wordCells.length === 0) return;
      const joined = current.length > 0 && gap ? [...current, gap, ...wordCells] : [...current, ...wordCells];
      if (current.length > 0 && widthOf(joined, styled) <= maxWidth) current = joined;
      else {
        if (current.length > 0) lines.push(current);
        current = [];
        if (widthOf(wordCells, styled) <= maxWidth) current = wordCells;
        else {
          // Wider than the box on its own: cut, with at least one character a piece.
          for (const cell of wordCells) {
            if (current.length > 0 && widthOf([...current, cell], styled) > maxWidth) {
              lines.push(current);
              current = [];
            }
            current.push(cell);
          }
        }
      }
      wordCells = [];
    };
    for (const cell of paragraph) {
      if (cell.g === " ") {
        place();
        gap = cell;
      } else wordCells.push(cell);
    }
    place();
    if (current.length > 0) lines.push(current);
    if (lines.length === before) lines.push([]);
    paragraph = [];
  };
  for (const cell of cells) {
    if (/^(\r\n|\r|\n)$/.test(cell.g)) flush();
    else paragraph.push(cell);
  }
  flush();
  return lines;
}

// styled: how wide text is in a span's look. Given, a text with styled spans is laid out by them; without it, or
// for a text of one look, every line is measured in the clip's own font, as it always was.
export function layoutText(clip: TextClip, docWidth: number, measure: (s: string) => number, styled?: StyledMeasure): TextLine[] {
  const box = TEXT_BOX_WIDTH * docWidth;
  const x = clip.style.align === "left" ? -box / 2 : clip.style.align === "right" ? box / 2 : 0;
  const lineY = (i: number, count: number) => (i - (count - 1) / 2) * clip.style.fontSize * lineHeightOf(clip.style);
  if (styled && clip.spans && clip.spans.length > 0) {
    const wrapped = wrapStyled(clip, box, styled);
    return wrapped.map((cells, i) => ({ text: textOf(cells), x, y: lineY(i, wrapped.length), cells, width: widthOf(cells, styled) }));
  }
  const lines = wrapLines(clip.text, box, measure);
  return lines.map((text, i) => ({ text, x, y: lineY(i, lines.length) }));
}

// A box in project pixels from the clip's centre, before scale, stretch and rotation.
export type LocalRect = { left: number; top: number; right: number; bottom: number };

// The box the text's lines take up, as measured. Text with no width is half its font size wide around the anchor.
export function textRect(clip: TextClip, docWidth: number, measure: (s: string) => number, styled?: StyledMeasure): LocalRect {
  const { fontSize, align } = clip.style;
  const lines = layoutText(clip, docWidth, measure, styled);
  const half = (fontSize * lineHeightOf(clip.style)) / 2;
  let left = Infinity;
  let right = -Infinity;
  for (const line of lines) {
    // The letters' own width, so the box hugs them where they are drawn.
    const w = lettersWidth(clip.style, line.text, line.width ?? measure(line.text));
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
