import type { TextSpan } from "./types";

// Styled spans: stretches of a text clip's words that look different from the rest (another colour, bold, italic,
// underlined). A span names its stretch by where it starts and ends in the text, counted as a text field counts
// (UTF-16 units), and holds only what differs from the clip's own style. Pure.

type Look = Omit<TextSpan, "from" | "to">;
const LOOK_KEYS = ["color", "fontWeight", "italic", "underline"] as const;
const lookOf = (span: TextSpan): Look => Object.fromEntries(LOOK_KEYS.filter((key) => span[key] !== undefined).map((key) => [key, span[key]]));
const sameLook = (a: Look, b: Look) => LOOK_KEYS.every((key) => a[key] === b[key]);
const isPlain = (look: Look) => LOOK_KEYS.every((key) => look[key] === undefined);

// Why these spans cannot be this text's, or null when they can: each inside the text, at least a character long,
// in order without overlapping, and each changing something.
export function spansProblem(text: string, spans: readonly TextSpan[]): string | null {
  let end = 0;
  for (const span of spans) {
    if (span.from >= span.to) return `a span from ${span.from} to ${span.to} is empty`;
    if (span.to > text.length) return `a span ends at ${span.to}, past the text's ${text.length} characters`;
    if (span.from < end) return "spans must be in order and must not overlap";
    if (isPlain(lookOf(span))) return `the span from ${span.from} to ${span.to} changes nothing`;
    end = span.to;
  }
  return null;
}

// Spans in order, with neighbours of the same look joined and the ones that change nothing or are empty left out.
function tidy(spans: TextSpan[]): TextSpan[] {
  const out: TextSpan[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    if (span.from >= span.to || isPlain(lookOf(span))) continue;
    const last = out.at(-1);
    if (last && last.to === span.from && sameLook(lookOf(last), lookOf(span))) out[out.length - 1] = { ...last, to: span.to };
    else out.push(span);
  }
  return out;
}

// The spans after a text's words change, so each stays on its own words. What changed is taken to be the one
// stretch between what the old and new texts share at their start and at their end, which is what typing, pasting
// and deleting are. A span before it stays and one after it moves. Typing inside bold words gives bold letters, and
// typing over words a span covers keeps the span on what was typed; a span the change swallows goes with its words,
// and one it only reaches into keeps the part of it that was not touched.
export function remapSpans(before: string, after: string, spans: readonly TextSpan[]): TextSpan[] {
  if (before === after) return [...spans];
  let head = 0;
  const most = Math.min(before.length, after.length);
  while (head < most && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < most - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const oldEnd = before.length - tail; // the changed stretch was head … oldEnd
  const newEnd = after.length - tail; // and is now head … newEnd
  const by = after.length - before.length;
  const moved = spans.map((span) => {
    // Its start: untouched before the change; moved along after it; kept where the change begins when the span
    // covers all that was replaced; else pushed past what replaced its first words.
    const from = span.from < head ? span.from : span.from >= oldEnd ? span.from + by : span.from === head && span.to >= oldEnd ? head : newEnd;
    // Its end: untouched before the change; moved along at or after its end; else pulled back to where the change begins.
    const to = span.to <= head ? span.to : span.to >= oldEnd ? span.to + by : head;
    return { ...span, from, to };
  });
  return tidy(moved.map((span) => ({ ...span, from: Math.max(0, span.from), to: Math.min(after.length, span.to) })));
}

// What each character from `from` to `to` looks like now: the pieces of that stretch, each with the look it has.
function pieces(spans: readonly TextSpan[], from: number, to: number): { from: number; to: number; look: Look }[] {
  const out: { from: number; to: number; look: Look }[] = [];
  let at = from;
  for (const span of spans) {
    if (span.to <= from || span.from >= to) continue;
    if (span.from > at) out.push({ from: at, to: span.from, look: {} });
    out.push({ from: Math.max(span.from, from), to: Math.min(span.to, to), look: lookOf(span) });
    at = Math.min(span.to, to);
  }
  if (at < to) out.push({ from: at, to, look: {} });
  return out;
}

// Whether every character from `from` to `to` has this look set this way.
export function spanHas(spans: readonly TextSpan[], from: number, to: number, key: keyof Look, value: Look[keyof Look]): boolean {
  return from < to && pieces(spans, from, to).every((piece) => piece.look[key] === value);
}

// The spans once the stretch from `from` to `to` is given a look. Each key of `change` is set on the whole stretch;
// undefined takes that key off it; `clear` takes every look off it. The spans around the stretch keep theirs.
export function styleSpan(spans: readonly TextSpan[], from: number, to: number, change: Partial<Record<keyof Look, Look[keyof Look] | undefined>> | "clear"): TextSpan[] {
  if (from >= to) return [...spans];
  const outside = spans.flatMap((span): TextSpan[] => {
    if (span.to <= from || span.from >= to) return [span];
    // The parts of a span that stick out of the stretch keep its look.
    return [
      ...(span.from < from ? [{ ...span, to: from }] : []),
      ...(span.to > to ? [{ ...span, from: to }] : []),
    ];
  });
  const inside = pieces(spans, from, to).map((piece): TextSpan => {
    const look: Record<string, unknown> = change === "clear" ? {} : { ...piece.look };
    if (change !== "clear") {
      for (const [key, value] of Object.entries(change)) {
        if (value === undefined) delete look[key];
        else look[key] = value;
      }
    }
    return { from: piece.from, to: piece.to, ...(look as Look) };
  });
  return tidy([...outside, ...inside]);
}

// The span a character is in, or null.
export function spanAt(spans: readonly TextSpan[] | null | undefined, offset: number): TextSpan | null {
  if (!spans) return null;
  for (const span of spans) if (offset >= span.from && offset < span.to) return span;
  return null;
}
