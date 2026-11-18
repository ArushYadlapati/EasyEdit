import { LIMITS } from "@/lib/limits";
import { withSuffix } from "@/lib/text";
import { rewordRun } from "@/lib/timeline/captions";
import type { CaptionWord } from "@/lib/timeline";

// The model's words made into a file's caption words. Measured on synthetic test speech, Whisper put word starts
// 0.07 to 0.52 s late and could end the last word past the sound; moving every word 0.20 s earlier and clamping it
// into the sound passed on speech it had not been tuned on.

export type RawWord = { text: string; start: number | null; end: number | null }; // seconds, as the model gives them

export const LEAD_SHIFT_SECONDS = 0.2;

// Text Postgres can store: no U+0000, no half of a surrogate pair.
const storable = (text: string) => text.replaceAll("\u0000", "").toWellFormed();

// Over music or silence Whisper writes tags such as "[Music]" or "♪", and makes up a word or two of filler.
const TAG_START = /^[[(♪]/u;
const TAG_END = /[\])♪]$/u;
const ONLY_PUNCTUATION = /^[\p{P}\s]*$/u;
const FILLER = new Set(["you", "music", "thank", "thanks", "bye", "watching", "for"]);
const bare = (text: string) => text.toLowerCase().replace(/[\p{P}\s]/gu, "");

// One window's words without what is not speech: every tag and every word of only punctuation, then the whole window
// when what is left is at most two words, all filler.
export function dropNonSpeech(words: readonly RawWord[]): RawWord[] {
  const kept = words.filter((word) => {
    const text = word.text.trim();
    return !TAG_START.test(text) && !TAG_END.test(text) && !ONLY_PUNCTUATION.test(text);
  });
  if (kept.length <= 2 && kept.every((word) => FILLER.has(bare(word.text)))) return [];
  return kept;
}

export function correctWords(raw: readonly RawWord[], audioSeconds: number): CaptionWord[] {
  const toMs = (seconds: number) => Math.round(Math.min(audioSeconds, Math.max(0, seconds - LEAD_SHIFT_SECONDS)) * 1000);
  const words: CaptionWord[] = [];
  for (const word of raw) {
    const text = storable(word.text).trim();
    if (text === "" || word.start === null) continue;
    const before = words.at(-1)?.s ?? 0;
    const s = Math.max(before, toMs(word.start));
    const e = Math.max(s, toMs(word.end ?? word.start));
    // A caption word holds no whitespace: a model "word" that does becomes several, sharing its span in order, as a
    // retyped line does. Otherwise cut by whole characters, so an emoji is never split in two.
    const pieces = /\s/u.test(text) ? rewordRun([{ t: text, s, e }], text) : [{ t: withSuffix(text, "", LIMITS.captionWordChars), s, e }];
    for (const piece of pieces) {
      if (words.length >= LIMITS.captionWordsPerFile) return words;
      words.push(piece);
    }
  }
  return words;
}
