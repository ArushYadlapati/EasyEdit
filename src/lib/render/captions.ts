import { cuesAt } from "@/lib/captions/cues";
import { captionStyleOf } from "@/lib/timeline/captions";
import type { TimelineDoc } from "@/lib/timeline";
import type { Ctx2D } from "./compositor";
import { LINE_HEIGHT, wrapLines } from "./text-layout";

const OUTLINE = 0.14; // of the font size
const GAP = 0.2; // between stacked cues (a bar's boxes, else the text), of the font size
const BAR_PAD = 0.3; // a bar's box above and below its text, of the font size
const WORD_SCALE = 1.3; // the "word" preset is bigger than the others
const POP_FRAMES = 3;
const POP_FROM = 0.8;
const BAR_FILL = "rgba(0,0,0,0.65)";

// A rounded box path made with arcTo, so every canvas can take it.
function roundedBox(ctx: Ctx2D, l: number, t: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(l + r, t);
  ctx.arcTo(l + w, t, l + w, t + h, r);
  ctx.arcTo(l + w, t + h, l, t + h, r);
  ctx.arcTo(l, t + h, l, t, r);
  ctx.arcTo(l, t, l + w, t, r);
  ctx.closePath();
}

// For each character of the text, which word it belongs to (-1 for a space).
function wordIds(words: string[]): number[] {
  const ids: number[] = [];
  words.forEach((word, i) => {
    if (i > 0) ids.push(-1);
    for (let k = 0; k < word.length; k++) ids.push(i);
  });
  return ids;
}

// Draws every caption line showing at a frame, in the project's caption style. Lines are centred across the frame
// and the block of them sits on the style's y. Several cues at once stack upward from there.
export function drawCaptions(ctx: Ctx2D, doc: TimelineDoc, frame: number, resolveFont: (family: string) => string): void {
  const showing = cuesAt(doc, frame);
  if (showing.length === 0) return;
  const style = captionStyleOf(doc);
  const bar = style.preset === "bar";
  const word = style.preset === "word";
  const upper = (s: string) => (style.uppercase ? s.toUpperCase() : s);
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let bottom = style.y * doc.height; // the centre of the next block to draw, before its own half height
  let first = true;
  for (const { cue, lit } of showing) {
    const size = style.fontSize * (word ? WORD_SCALE : 1);
    const lineHeight = size * LINE_HEIGHT;
    ctx.font = `${style.fontWeight} ${size}px ${resolveFont(style.fontFamily)}`;
    const measure = (s: string) => ctx.measureText(s).width;
    const words = cue.words.map((w) => upper(w.text));
    const text = words.join(" ");
    const lines = wrapLines(text, (bar ? 0.9 : 0.8) * doc.width, measure);
    const height = lines.length * lineHeight;
    // What a cue takes up: a bar's box reaches past its text, so the gap is measured from the box.
    const extent = height + (bar ? 2 * BAR_PAD * style.fontSize : 0);
    const centre = first ? bottom : bottom - (GAP * style.fontSize + extent / 2);
    // The next cue goes above this block's top edge.
    bottom = centre - extent / 2;
    first = false;
    ctx.save();
    ctx.translate(doc.width / 2, centre);
    if (word) {
      const k = POP_FROM + (1 - POP_FROM) * Math.min(1, Math.max(0, (frame - cue.start) / POP_FRAMES));
      ctx.scale(k, k);
    }
    if (bar) {
      const widest = Math.max(...lines.map(measure));
      const w = widest + style.fontSize;
      const h = extent;
      roundedBox(ctx, -w / 2, -h / 2, w, h, 0.2 * style.fontSize);
      ctx.fillStyle = BAR_FILL;
      ctx.fill();
    } else {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = size * OUTLINE;
      ctx.lineJoin = "round";
    }
    const ids = wordIds(words);
    let cursor = 0;
    lines.forEach((line, n) => {
      const y = (n - (lines.length - 1) / 2) * lineHeight;
      const left = -measure(line) / 2;
      // Each line holds the next characters of the text; the spaces it wrapped at are skipped.
      while (text[cursor] === " ") cursor++;
      const lineIds = ids.slice(cursor, cursor + line.length);
      cursor += line.length;
      if (!bar) ctx.strokeText(line, left, y);
      let i = 0;
      while (i < line.length) {
        let j = i + 1;
        while (j < line.length && (style.preset === "karaoke" ? (lineIds[j] === lit) === (lineIds[i] === lit) : true)) j++;
        ctx.fillStyle = style.preset === "karaoke" && lineIds[i] === lit ? style.highlight : style.color;
        ctx.fillText(line.slice(i, j), left + measure(line.slice(0, i)), y);
        i = j;
      }
    });
    ctx.restore();
  }
  ctx.restore();
}
