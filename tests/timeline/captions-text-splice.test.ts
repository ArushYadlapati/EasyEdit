import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import { OpError, applyOps, createEmptyDoc, defaultCaptionStyle, prepareOps, rewordRun, transcriptOf, type CaptionWord, type Op, type TimelineDoc } from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";

const w = (t: string, s: number, e: number): CaptionWord => ({ t, s, e });
const WORDS = [w("hello", 0, 400), w("brave", 450, 800), w("new", 900, 1100), w("world", 1200, 1700)];
const base = (words: CaptionWord[] = WORDS): TimelineDoc => ({ ...docWithCaptions("short_9x16"), captions: { style: defaultCaptionStyle(createEmptyDoc("short_9x16")), transcripts: { a: words } } });
const trip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof OpError ? e.code : "not an OpError";
  }
};
const text = (index: number, remove: number, t: string, extra: Record<string, unknown> = {}): Op => ({ op: "splice_caption_words", assetId: "a", index, remove, text: t, ...extra }) as Op;

// Forward, then the inverse through JSON (undo restores the document), then its inverse (redo equals the forward result).
function roundTrip(doc: TimelineDoc, ops: Op[]) {
  const forward = applyOps(doc, ops);
  const back = applyOps(forward.doc, trip(forward.inverse));
  expect(back.doc).toEqual(doc);
  expect(applyOps(back.doc, trip(back.inverse)).doc).toEqual(forward.doc);
  return forward;
}
const wordsOf = (doc: TimelineDoc) => transcriptOf(doc, "a");

describe("rewordRun", () => {
  it("keeps the times when the count is the same", () => {
    expect(rewordRun([w("a", 5, 10), w("b", 12, 20)], "x  y")).toEqual([w("x", 5, 10), w("y", 12, 20)]);
  });
  it("shares the span out by grapheme count, contiguous, whole milliseconds", () => {
    expect(rewordRun([w("brave", 450, 800)], "very brave indeed")).toEqual([w("very", 450, 543), w("brave", 543, 660), w("indeed", 660, 800)]);
  });
  it("gives nothing for no words and cuts long words", () => {
    expect(rewordRun(WORDS, " \n ")).toEqual([]);
    expect(rewordRun([w("a", 0, 100)], "x".repeat(200))[0].t).toHaveLength(LIMITS.captionWordChars);
  });
});

describe("splice_caption_words with text", () => {
  it("same count: new words, same times", () => {
    const { doc } = roundTrip(base(), [text(1, 2, "big bad")]);
    expect(wordsOf(doc)).toEqual([WORDS[0], w("big", 450, 800), w("bad", 900, 1100), WORDS[3]]);
  });

  it("more words: the run's span is shared out", () => {
    const { doc } = roundTrip(base(), [text(1, 1, "very brave indeed")]);
    expect(wordsOf(doc)).toEqual([WORDS[0], w("very", 450, 543), w("brave", 543, 660), w("indeed", 660, 800), WORDS[2], WORDS[3]]);
  });

  it("fewer words", () => {
    const { doc } = roundTrip(base(), [text(1, 3, "bravo world")]);
    expect(wordsOf(doc)).toEqual([WORDS[0], w("bravo", 450, 1075), w("world", 1075, 1700)]);
  });

  it("empty text removes the run", () => {
    const { doc } = roundTrip(base(), [text(1, 2, "  ")]);
    expect(wordsOf(doc)).toEqual([WORDS[0], WORDS[3]]);
  });

  it("the inverse is the ordinary explicit splice, exact through JSON", () => {
    const { inverse } = roundTrip(base(), [text(1, 1, "very brave indeed")]);
    expect(inverse).toEqual([
      { op: "splice_caption_words", assetId: "a", index: 1, remove: 3, insert: [WORDS[1]], expect: { words: [w("very", 450, 543), w("brave", 543, 660), w("indeed", 660, 800)] } },
    ]);
  });

  it("expect still guards the call", () => {
    expect(code(() => applyOps(base(), [text(1, 1, "x", { expect: { words: [w("brave", 450, 801)] } })]))).toBe("STALE");
    expect(() => applyOps(base(), [text(1, 1, "x", { expect: { words: [WORDS[1]] } })])).not.toThrow();
  });

  it("needs exactly one of insert and text", () => {
    expect(() => prepareOps([{ op: "splice_caption_words", assetId: "a", index: 0, remove: 1 }])).toThrow(/invalid/);
    expect(() => prepareOps([{ op: "splice_caption_words", assetId: "a", index: 0, remove: 1, insert: [], text: "x" }])).toThrow(/invalid/);
    expect(() => prepareOps([{ op: "splice_caption_words", assetId: "a", index: 0, remove: 1, text: "x" }])).not.toThrow();
    expect(() => prepareOps([{ op: "splice_caption_words", assetId: "a", index: 0, remove: 1, insert: [] }])).not.toThrow();
  });

  it("refuses text that is too long, and text with nothing to remove", () => {
    expect(() => prepareOps([text(0, 1, "x".repeat(LIMITS.textClipChars + 1))])).toThrow(/invalid/);
    expect(code(() => applyOps(base(), [text(1, 0, "extra")]))).toBe("INVALID");
  });

  it("refuses a result past the words-per-file limit", () => {
    const full = Array.from({ length: LIMITS.captionWordsPerFile }, (_, i) => w("a", i * 10, i * 10 + 5));
    expect(code(() => applyOps(base(full), [text(0, 1, "two words")]))).toBe("INVALID");
  });
});
