const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Splits text into user-perceived characters, so an emoji or a flag stays in one piece.
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

// The name with the suffix after it, in at most maxChars UTF-16 units (as zod's max counts). A name too long for
// that loses whole characters from its end, so an emoji is never split, and spaces left at the cut are dropped.
export function withSuffix(name: string, suffix: string, maxChars: number): string {
  if (name.length + suffix.length <= maxChars) return name + suffix;
  const parts = graphemes(name);
  let length = name.length;
  while (length + suffix.length > maxChars) length -= parts.pop()!.length;
  return parts.join("").trimEnd() + suffix;
}

// Postgres cannot store U+0000 or a lone surrogate (half of an emoji, for example) in text or JSON.
export function isStorableText(text: string): boolean {
  return !text.includes("\u0000") && text.isWellFormed();
}

export const UNSTORABLE_TEXT = "contains a character that cannot be saved";
