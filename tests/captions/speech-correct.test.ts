import { describe, expect, it } from "vitest";
import { LEAD_SHIFT_SECONDS, correctWords, type RawWord } from "@/lib/captions/speech/correct";
import { CaptionWords } from "@/lib/timeline";
import { LIMITS } from "@/lib/limits";

const word = (text: string, start: number | null, end: number | null): RawWord => ({ text, start, end });

describe("correcting the model's words", () => {
  it("moves every word 0.2 s earlier, in whole milliseconds, with its text trimmed", () => {
    expect(LEAD_SHIFT_SECONDS).toBe(0.2);
    const words = correctWords([word(" Hello", 1.52, 1.9), word(" world.", 1.9, 2.34)], 10);
    expect(words).toEqual([
      { t: "Hello", s: 1320, e: 1700 },
      { t: "world.", s: 1700, e: 2140 },
    ]);
  });

  it("clamps into the sound: nothing before 0, nothing after its end", () => {
    const words = correctWords([word("So", 0.1, 0.3), word("bye", 21.9, 22.3)], 21.978);
    expect(words).toEqual([
      { t: "So", s: 0, e: 100 },
      { t: "bye", s: 21700, e: 21978 },
    ]);
  });

  it("clamps a word wholly past the end onto the end", () => {
    expect(correctWords([word("late", 30, 31)], 20)).toEqual([{ t: "late", s: 20000, e: 20000 }]);
  });

  it("repairs the order: a start never comes before the one before it, an end never before its start", () => {
    const words = correctWords([word("a", 2, 2.5), word("b", 1.5, 1.8), word("c", 3, 2.9)], 10);
    expect(words).toEqual([
      { t: "a", s: 1800, e: 2300 },
      { t: "b", s: 1800, e: 1800 },
      { t: "c", s: 2800, e: 2800 },
    ]);
  });

  it("gives a word with no end its start, and drops a word with no start", () => {
    const words = correctWords([word("one", 1, null), word("two", null, 2), word("three", 3, 3.5)], 10);
    expect(words).toEqual([
      { t: "one", s: 800, e: 800 },
      { t: "three", s: 2800, e: 3300 },
    ]);
  });

  it("drops words whose text is empty or only spaces", () => {
    const words = correctWords([word("", 1, 2), word("   ", 2, 3), word(" ok ", 3, 4)], 10);
    expect(words).toEqual([{ t: "ok", s: 2800, e: 3800 }]);
  });

  it("cuts a long word to the limit without splitting a character", () => {
    const long = "x".repeat(LIMITS.captionWordChars - 1) + "😀😀";
    const [only] = correctWords([word(long, 1, 2)], 10);
    expect(only.t).toBe("x".repeat(LIMITS.captionWordChars - 1));
    expect(only.t.length).toBeLessThanOrEqual(LIMITS.captionWordChars);
  });

  it("keeps at most the words a file may hold, and the result is a valid word list", () => {
    const raw = Array.from({ length: LIMITS.captionWordsPerFile + 5 }, (_, i) => word(`w${i}`, i * 0.3, i * 0.3 + 0.2));
    const words = correctWords(raw, 4000);
    expect(words).toHaveLength(LIMITS.captionWordsPerFile);
    expect(words.at(-1)!.t).toBe(`w${LIMITS.captionWordsPerFile - 1}`);
    expect(CaptionWords.safeParse(words).success).toBe(true);
  });

  it("keeps only text that can be saved", () => {
    const words = correctWords([word("a\u0000b", 1, 2), word("\ud800", 2, 3)], 10);
    expect(CaptionWords.safeParse(words).success).toBe(true);
  });
});
