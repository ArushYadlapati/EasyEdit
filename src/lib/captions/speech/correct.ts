import { LIMITS } from "@/lib/limits";
import { withSuffix } from "@/lib/text";
import type { CaptionWord } from "@/lib/timeline";

// The model's words made into a file's caption words. Whisper puts word starts late (0.07 to 0.52 s on Plan 2's
// test speech) and can end the last word past the sound, so every word moves 0.20 s earlier and is clamped into the
// sound: the `shift` correction that passed on held-out audio (docs/superpowers/plans/plan-2-findings.md).

export type RawWord = { text: string; start: number | null; end: number | null }; // seconds, as the model gives them

export const LEAD_SHIFT_SECONDS = 0.2;

// Text Postgres can store: no U+0000, no half of a surrogate pair.
const storable = (text: string) => text.replaceAll("\u0000", "").toWellFormed();

export function correctWords(raw: readonly RawWord[], audioSeconds: number): CaptionWord[] {
  const toMs = (seconds: number) => Math.round(Math.min(audioSeconds, Math.max(0, seconds - LEAD_SHIFT_SECONDS)) * 1000);
  const words: CaptionWord[] = [];
  for (const word of raw) {
    if (words.length >= LIMITS.captionWordsPerFile) break;
    // Cut by whole characters, so an emoji is never split in two.
    const t = withSuffix(storable(word.text).trim(), "", LIMITS.captionWordChars);
    if (t === "" || word.start === null) continue;
    const before = words.at(-1)?.s ?? 0;
    const s = Math.max(before, toMs(word.start));
    const e = Math.max(s, toMs(word.end ?? word.start));
    words.push({ t, s, e });
  }
  return words;
}
