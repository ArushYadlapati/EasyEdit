import { describe, expect, it } from "vitest";
import { LEAD_SHIFT_SECONDS, correctWords, dropNonSpeech, type RawWord } from "@/lib/captions/speech/correct";
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

  it("splits a model word holding whitespace into words that share its span, in order", () => {
    const words = correctWords([word(" New York", 1.2, 2.2), word("now", 2.3, 2.5)], 10);
    expect(words).toEqual([
      { t: "New", s: 1000, e: 1429 },
      { t: "York", s: 1429, e: 2000 },
      { t: "now", s: 2100, e: 2300 },
    ]);
    expect(correctWords([word("a\tb\nc", 1.2, 1.5)], 10).map((x) => x.t)).toEqual(["a", "b", "c"]);
    expect(CaptionWords.safeParse(correctWords([word("one two  three", 1, 2)], 10)).success).toBe(true);
  });

  it("still keeps at most the words a file may hold when a word is split", () => {
    const raw = Array.from({ length: LIMITS.captionWordsPerFile }, (_, i) => word(`w${i} x`, i * 0.3, i * 0.3 + 0.2));
    expect(correctWords(raw, 4000)).toHaveLength(LIMITS.captionWordsPerFile);
  });
});

describe("dropping what is not speech", () => {
  const words = (...texts: string[]) => texts.map((t, i) => word(t, i, i + 0.5));
  const texts = (raw: RawWord[]) => raw.map((w) => w.text);

  it("drops a non-speech tag: a word starting with [, ( or ♪, or ending with ], ) or ♪", () => {
    expect(texts(dropNonSpeech(words("[Music]", "Go", "team")))).toEqual(["Go", "team"]);
    expect(texts(dropNonSpeech(words(" [BLANK", "_AUDIO]", "we", "won")))).toEqual(["we", "won"]);
    expect(texts(dropNonSpeech(words("(applause)", "we", "won")))).toEqual(["we", "won"]);
    expect(texts(dropNonSpeech(words("(laughs", "we", "won")))).toEqual(["we", "won"]);
    expect(texts(dropNonSpeech(words("♪", "la", "la", "la")))).toEqual(["la", "la", "la"]);
    expect(texts(dropNonSpeech(words("♪la", "we", "won", "la♪")))).toEqual(["we", "won"]);
  });

  it("drops a word that is only punctuation", () => {
    expect(texts(dropNonSpeech(words("we", "...", "-", "won", "it")))).toEqual(["we", "won", "it"]);
  });

  it("drops a whole window of at most two words that are all filler Whisper makes up over music or silence", () => {
    for (const filler of [["you"], ["Music"], ["Thank", "you."], ["[Music]"], ["♪"], ["Thanks", "for"], ["Bye."], [" watching!"], ["you", "[Music]", "you"]]) {
      expect(dropNonSpeech(words(...filler))).toEqual([]);
    }
  });

  it("keeps real short speech, and filler words inside longer speech", () => {
    expect(texts(dropNonSpeech(words("Go!")))).toEqual(["Go!"]);
    expect(texts(dropNonSpeech(words("Yes", "we", "did")))).toEqual(["Yes", "we", "did"]);
    expect(texts(dropNonSpeech(words("Thank", "you", "all")))).toEqual(["Thank", "you", "all"]);
    expect(texts(dropNonSpeech(words("you", "rock")))).toEqual(["you", "rock"]);
    expect(dropNonSpeech([])).toEqual([]);
  });

  it("keeps each kept word as it was", () => {
    const raw = [word("Go!", 1.5, null)];
    expect(dropNonSpeech(raw)).toEqual(raw);
  });
});
