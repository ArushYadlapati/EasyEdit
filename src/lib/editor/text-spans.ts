import { nearestWeight } from "@/lib/brand/fonts";
import { styleSpan, type OpInput, type TextClip, type TextSpan } from "@/lib/timeline";

// Styling some of a text clip's words: what the selected stretch looks like now, and the ops that change it. A
// stretch only records what differs from the clip's own style, so making bold words plain again in a plain text
// leaves no trace. Pure builders.

const BOLD_FROM = 600; // a weight from here up reads as bold

type Stretch = { from: number; to: number };

// Each piece of the stretch with the span over it (null where there is none).
function over(clip: TextClip, { from, to }: Stretch): (TextSpan | null)[] {
  const found: (TextSpan | null)[] = [];
  let at = from;
  for (const span of clip.spans ?? []) {
    if (span.to <= from || span.from >= to) continue;
    if (span.from > at) found.push(null);
    found.push(span);
    at = span.to;
  }
  if (at < to) found.push(null);
  return found;
}

// What the whole stretch looks like: bold, italic and underlined only when every character of it is; its colour
// when it has one throughout, else null. An empty stretch is the clip's own look.
export function stretchLook(clip: TextClip, stretch: Stretch): { bold: boolean; italic: boolean; underline: boolean; color: string | null } {
  const style = clip.style;
  const parts = stretch.from < stretch.to ? over(clip, stretch) : [null];
  const colors = new Set(parts.map((span) => span?.color ?? style.color));
  return {
    bold: parts.every((span) => (span?.fontWeight ?? style.fontWeight) >= BOLD_FROM),
    italic: parts.every((span) => span?.italic ?? style.italic ?? false),
    underline: parts.every((span) => span?.underline ?? style.underline ?? false),
    color: colors.size === 1 ? [...colors][0] : null,
  };
}

const write = (clip: TextClip, spans: TextSpan[]): OpInput[] => {
  const next = spans.length > 0 ? spans : null;
  const same = JSON.stringify(next) === JSON.stringify(clip.spans && clip.spans.length > 0 ? clip.spans : null);
  return same ? [] : [{ op: "update_clip", clipId: clip.id, patch: { spans: next } }];
};

// Bold, italic or underline switched for the stretch: on when not all of it is, off when all of it is. Bold is the
// font's weight nearest 700, and not bold its weight nearest 400; where that is the clip's own, nothing is recorded.
export function toggleStretchOps(clip: TextClip, stretch: Stretch, what: "bold" | "italic" | "underline"): OpInput[] {
  if (stretch.from >= stretch.to) return [];
  const on = !stretchLook(clip, stretch)[what];
  const style = clip.style;
  if (what === "bold") {
    const weight = nearestWeight(style.fontFamily, on ? 700 : 400);
    return write(clip, styleSpan(clip.spans ?? [], stretch.from, stretch.to, { fontWeight: weight === style.fontWeight ? undefined : weight }));
  }
  const own = style[what] ?? false;
  return write(clip, styleSpan(clip.spans ?? [], stretch.from, stretch.to, { [what]: on === own ? undefined : on }));
}

// The stretch in this colour; the clip's own colour records nothing.
export function colorStretchOps(clip: TextClip, stretch: Stretch, color: string): OpInput[] {
  if (stretch.from >= stretch.to) return [];
  const same = color.toLowerCase() === clip.style.color.toLowerCase();
  return write(clip, styleSpan(clip.spans ?? [], stretch.from, stretch.to, { color: same ? undefined : color }));
}

// The stretch back to the clip's own look. With no stretch, the whole text.
export function plainStretchOps(clip: TextClip, stretch: Stretch | null): OpInput[] {
  if (!stretch || stretch.from >= stretch.to) return write(clip, []);
  return write(clip, styleSpan(clip.spans ?? [], stretch.from, stretch.to, "clear"));
}
