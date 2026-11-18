import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import {
  DEFAULT_TRANSFORM,
  OpError,
  TimelineDoc as TimelineDocSchema,
  applyOps,
  captionStyleOf,
  captionTrack,
  createEmptyDoc,
  defaultCaptionStyle,
  newShapeClip,
  safeAreaOf,
  prepareOps,
  transcriptOf,
  type CaptionStyle,
  type CaptionWord,
  type Clip,
  type Op,
  type OpInput,
  type TimelineDoc,
} from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";

const w = (t: string, s: number, e: number): CaptionWord => ({ t, s, e });
const WORDS = [w("hello", 0, 400), w("brave", 450, 800), w("new", 900, 1100), w("world", 1200, 1700)];
const STYLE: CaptionStyle = { ...defaultCaptionStyle(createEmptyDoc("short_9x16")), preset: "bar", fontSize: 50, color: "#000000" };

const media = (id: string, type: "video" | "audio" | "image", extra: Record<string, unknown> = {}) =>
  ({ id, type, assetId: "a", start: 0, duration: 60, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, ...extra }) as Clip;

function base(extra: Partial<TimelineDoc> = {}): TimelineDoc {
  return { ...docWithCaptions("short_9x16"), captions: { style: STYLE, transcripts: { a: WORDS } }, ...extra };
}
const trip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof OpError ? e.code : "not an OpError";
  }
};

// Applies the ops, then the inverse (through JSON), then the inverse of that: undo restores the document, redo the result.
function roundTrip(doc: TimelineDoc, ops: Op[]) {
  const forward = applyOps(doc, ops);
  const back = applyOps(forward.doc, trip(forward.inverse));
  expect(back.doc).toEqual(doc);
  expect(applyOps(back.doc, trip(back.inverse)).doc).toEqual(forward.doc);
  return forward;
}

describe("defaults and helpers", () => {
  it("defaultCaptionStyle sizes from the width and sits low in the safe area", () => {
    const style = defaultCaptionStyle(createEmptyDoc("short_9x16"));
    expect(style).toMatchObject({ preset: "karaoke", fontFamily: "Geist", fontWeight: 700, fontSize: 70, color: "#ffffff", highlight: "#FFD400", uppercase: false });
    const safe = safeAreaOf(createEmptyDoc("short_9x16"));
    expect(style.y).toBe(Math.round((safe.top + safe.height * 0.82) * 1000) / 1000);
    expect(style.y).toBeGreaterThan(0.5);
    expect(String(style.y).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it("captionStyleOf, transcriptOf and captionTrack read the document", () => {
    expect(captionStyleOf(base())).toEqual(STYLE);
    expect(captionStyleOf(createEmptyDoc("short_9x16"))).toEqual(defaultCaptionStyle(createEmptyDoc("short_9x16")));
    expect(transcriptOf(base(), "a")).toEqual(WORDS);
    expect(transcriptOf(base(), "zzz")).toBeUndefined();
    expect(captionTrack(base())?.id).toBe("cap");
    expect(captionTrack(createEmptyDoc("short_9x16"))).toBeUndefined();
  });

  it("an old document with no captions parses and round-trips unchanged", () => {
    const old = createEmptyDoc("short_9x16");
    const parsed = TimelineDocSchema.parse(trip(old));
    expect(parsed).toEqual(old);
    expect("captions" in parsed).toBe(false);
    expect(TimelineDocSchema.parse(trip(base()))).toEqual(base());
  });
});

describe("set_caption_style", () => {
  it("merges the patch into the stored style and undoes to the old values", () => {
    const { doc, inverse } = roundTrip(base(), [{ op: "set_caption_style", patch: { preset: "word", fontSize: 90 } }]);
    expect(doc.captions?.style).toEqual({ ...STYLE, preset: "word", fontSize: 90 });
    expect(inverse).toEqual([{ op: "set_caption_style", patch: { preset: "bar", fontSize: 50 }, expect: { preset: "word", fontSize: 90 } }]);
  });

  it("stores the full default style when none was stored, and undo goes back to no style at all", () => {
    const d = createEmptyDoc("short_9x16");
    const { doc, inverse } = roundTrip(d, [{ op: "set_caption_style", patch: { color: "#112233" } }]);
    expect(doc.captions?.style).toEqual({ ...defaultCaptionStyle(d), color: "#112233" });
    expect(inverse).toEqual([{ op: "set_caption_style", clear: true, expect: { color: "#112233" } }]);
    expect("captions" in applyOps(doc, trip(inverse)).doc).toBe(false);
  });

  it("undo keeps other captions content when no style was stored", () => {
    const d = createEmptyDoc("short_9x16");
    d.captions = { transcripts: { a: WORDS } };
    roundTrip(d, [{ op: "set_caption_style", patch: { preset: "block" } }]);
  });

  it("a patch that changes nothing has no inverse when a style is stored", () => {
    const r = applyOps(base(), [{ op: "set_caption_style", patch: { preset: "bar" } }]);
    expect(r.doc).toEqual(base());
    expect(r.inverse).toEqual([]);
  });

  it("a patch equal to the default still stores the style when none is stored, and undo clears it", () => {
    const d = createEmptyDoc("short_9x16");
    const { doc, inverse } = roundTrip(d, [{ op: "set_caption_style", patch: { preset: "karaoke" } }]);
    expect(doc.captions?.style).toEqual(defaultCaptionStyle(d));
    expect(inverse).toEqual([{ op: "set_caption_style", clear: true, expect: { preset: "karaoke" } }]);
  });

  it("a style patched back to the default values stays stored, and clearing it undoes exactly", () => {
    const d = createEmptyDoc("short_9x16");
    const dflt = defaultCaptionStyle(d);
    const away = applyOps(d, [{ op: "set_caption_style", patch: { preset: "word" } }]).doc;
    const back = applyOps(away, [{ op: "set_caption_style", patch: { preset: dflt.preset } }]).doc;
    expect(back.captions?.style).toEqual(dflt);
    const cleared = roundTrip(back, [{ op: "set_caption_style", clear: true }]);
    expect("captions" in cleared.doc).toBe(false);
    expect(applyOps(cleared.doc, trip(cleared.inverse)).doc).toEqual(back);
  });

  it("clear removes the stored style and its undo puts the whole style back", () => {
    const { doc, inverse } = roundTrip(base(), [{ op: "set_caption_style", clear: true }]);
    expect(doc.captions).toEqual({ transcripts: { a: WORDS } });
    expect(captionStyleOf(doc)).toEqual(defaultCaptionStyle(doc));
    expect(inverse).toEqual([{ op: "set_caption_style", patch: STYLE, expect: expect.any(Object) }]);
  });

  it("clear drops the captions field when nothing else is in it", () => {
    const d = createEmptyDoc("short_9x16");
    d.captions = { style: STYLE };
    const { doc } = roundTrip(d, [{ op: "set_caption_style", clear: true }]);
    expect("captions" in doc).toBe(false);
  });

  it("clear with nothing stored is a no-op with no inverse", () => {
    const d = createEmptyDoc("short_9x16");
    const r = applyOps(d, [{ op: "set_caption_style", clear: true }]);
    expect(r.doc).toEqual(d);
    expect(r.inverse).toEqual([]);
  });

  it("clear checks expect against the style as it is now", () => {
    expect(code(() => applyOps(base(), [{ op: "set_caption_style", clear: true, expect: { preset: "word" } }]))).toBe("STALE");
    expect(() => applyOps(base(), [{ op: "set_caption_style", clear: true, expect: { preset: "bar" } }])).not.toThrow();
  });

  it("needs exactly one of patch and clear", () => {
    expect(() => prepareOps([{ op: "set_caption_style" } as OpInput])).toThrow(/invalid/);
    expect(() => prepareOps([{ op: "set_caption_style", patch: { preset: "bar" }, clear: true } as OpInput])).toThrow(/invalid/);
    expect(code(() => applyOps(base(), [{ op: "set_caption_style" } as Op]))).toBe("INVALID");
    expect(code(() => applyOps(base(), [{ op: "set_caption_style", patch: {}, clear: true } as Op]))).toBe("INVALID");
    expect(() => prepareOps([{ op: "set_caption_style", clear: true }])).not.toThrow();
  });

  it("refuses an expect that no longer holds, and checks only the keys it lists", () => {
    expect(code(() => applyOps(base(), [{ op: "set_caption_style", patch: { preset: "block" }, expect: { preset: "word" } }]))).toBe("STALE");
    expect(() => applyOps(base(), [{ op: "set_caption_style", patch: { preset: "block" }, expect: { color: "#000000" } }])).not.toThrow();
  });

  it("refuses an invalid result", () => {
    expect(code(() => applyOps(base(), [{ op: "set_caption_style", patch: { fontSize: 5000 } }]))).toBe("INVALID");
    expect(code(() => applyOps(base(), [{ op: "set_caption_style", patch: { color: "red" } }]))).toBe("INVALID");
    expect(code(() => applyOps(base(), [{ op: "set_caption_style", patch: { y: 1.5 } }]))).toBe("INVALID");
  });
});

describe("set_transcript", () => {
  it("adds a file and its inverse removes it, emptying the captions field", () => {
    const d = createEmptyDoc("short_9x16");
    const { doc, inverse } = roundTrip(d, [{ op: "set_transcript", assetId: "b", words: WORDS }]);
    expect(doc.captions?.transcripts?.b).toEqual(WORDS);
    expect(inverse).toEqual([{ op: "set_transcript", assetId: "b", words: null, expect: { words: 4 } }]);
    expect("captions" in applyOps(doc, inverse).doc).toBe(false);
  });

  it("replaces a file's words and the inverse puts the old ones back", () => {
    const { doc, inverse } = roundTrip(base(), [{ op: "set_transcript", assetId: "a", words: [w("x", 0, 10)] }]);
    expect(transcriptOf(doc, "a")).toEqual([w("x", 0, 10)]);
    expect(inverse).toEqual([{ op: "set_transcript", assetId: "a", words: WORDS, expect: { words: 1 } }]);
  });

  it("null removes the file, and the field when nothing else is left", () => {
    const only = createEmptyDoc("short_9x16");
    only.captions = { transcripts: { a: WORDS } };
    const { doc } = roundTrip(only, [{ op: "set_transcript", assetId: "a", words: null }]);
    expect("captions" in doc).toBe(false);
    const withStyle = applyOps(base(), [{ op: "set_transcript", assetId: "a", words: null }]).doc;
    expect(withStyle.captions).toEqual({ style: STYLE });
  });

  it("null on a file with no words is a no-op with no inverse", () => {
    const r = applyOps(base(), [{ op: "set_transcript", assetId: "none", words: null }]);
    expect(r.doc).toEqual(base());
    expect(r.inverse).toEqual([]);
  });

  it("expect compares the word count, null for none", () => {
    expect(code(() => applyOps(base(), [{ op: "set_transcript", assetId: "a", words: [], expect: { words: 3 } }]))).toBe("STALE");
    expect(code(() => applyOps(base(), [{ op: "set_transcript", assetId: "a", words: [], expect: { words: null } }]))).toBe("STALE");
    expect(code(() => applyOps(base(), [{ op: "set_transcript", assetId: "new", words: [], expect: { words: 0 } }]))).toBe("STALE");
    expect(() => applyOps(base(), [{ op: "set_transcript", assetId: "new", words: WORDS, expect: { words: null } }])).not.toThrow();
    expect(() => applyOps(base(), [{ op: "set_transcript", assetId: "a", words: [], expect: { words: 4 } }])).not.toThrow();
  });

  it("refuses a 51st file but still allows changing one of the 50", () => {
    const transcripts = Object.fromEntries(Array.from({ length: LIMITS.captionFilesPerProject }, (_, i) => [`f${i}`, [w("a", 0, 1)]]));
    const full = base({ captions: { transcripts } });
    expect(code(() => applyOps(full, [{ op: "set_transcript", assetId: "extra", words: [w("a", 0, 1)] }]))).toBe("LIMIT_EXCEEDED");
    expect(() => applyOps(full, [{ op: "set_transcript", assetId: "f3", words: [w("b", 0, 1)] }])).not.toThrow();
  });

  it("the op schema refuses too many words, a too-long word, words out of order and an end before a start", () => {
    const prep = (words: unknown) => () => prepareOps([{ op: "set_transcript", assetId: "a", words } as OpInput]);
    expect(prep(Array.from({ length: LIMITS.captionWordsPerFile }, (_, i) => w("a", i, i)))).not.toThrow();
    expect(prep(Array.from({ length: LIMITS.captionWordsPerFile + 1 }, (_, i) => w("a", i, i)))).toThrow(/invalid/);
    expect(prep([w("x".repeat(LIMITS.captionWordChars), 0, 1)])).not.toThrow();
    expect(prep([w("x".repeat(LIMITS.captionWordChars + 1), 0, 1)])).toThrow(/invalid/);
    expect(prep([w("", 0, 1)])).toThrow(/invalid/);
    expect(prep([w("a", 100, 200), w("b", 50, 60)])).toThrow(/time order/);
    expect(prep([w("a", 100, 50)])).toThrow(/invalid/);
    expect(() => prepareOps([{ op: "splice_caption_words", assetId: "a", index: 0, remove: 0, insert: [w("a", 9, 1)] }])).toThrow(/invalid/);
  });
});

describe("splice_caption_words", () => {
  it("replaces a run, and the inverse is the reverse splice", () => {
    const { doc, inverse } = roundTrip(base(), [
      { op: "splice_caption_words", assetId: "a", index: 1, remove: 2, insert: [w("big", 450, 1100)] },
    ]);
    expect(transcriptOf(doc, "a")?.map((x) => x.t)).toEqual(["hello", "big", "world"]);
    expect(inverse).toEqual([
      { op: "splice_caption_words", assetId: "a", index: 1, remove: 1, insert: [WORDS[1], WORDS[2]], expect: { words: [w("big", 450, 1100)] } },
    ]);
  });

  it("inserts and removes", () => {
    roundTrip(base(), [{ op: "splice_caption_words", assetId: "a", index: 4, remove: 0, insert: [w("end", 1800, 1900)] }]);
    roundTrip(base(), [{ op: "splice_caption_words", assetId: "a", index: 0, remove: 4, insert: [] }]);
  });

  it("a file with no words is NOT_FOUND, a run past the end is INVALID", () => {
    expect(code(() => applyOps(base(), [{ op: "splice_caption_words", assetId: "none", index: 0, remove: 0, insert: [] }]))).toBe("NOT_FOUND");
    expect(code(() => applyOps(base(), [{ op: "splice_caption_words", assetId: "a", index: 3, remove: 2, insert: [] }]))).toBe("INVALID");
    expect(code(() => applyOps(base(), [{ op: "splice_caption_words", assetId: "a", index: 5, remove: 0, insert: [] }]))).toBe("INVALID");
  });

  it("expect must equal the removed run", () => {
    const splice = (expectWords: CaptionWord[]): Op => ({ op: "splice_caption_words", assetId: "a", index: 1, remove: 1, insert: [], expect: { words: expectWords } });
    expect(code(() => applyOps(base(), [splice([w("brave", 450, 801)])]))).toBe("STALE");
    expect(code(() => applyOps(base(), [splice([])]))).toBe("STALE");
    expect(() => applyOps(base(), [splice([WORDS[1]])])).not.toThrow();
  });

  it("refuses a result that is out of order", () => {
    expect(code(() => applyOps(base(), [{ op: "splice_caption_words", assetId: "a", index: 1, remove: 0, insert: [w("late", 5000, 5100)] }]))).toBe("INVALID");
  });

  it("refuses a result past the word limit", () => {
    const many = base({ captions: { transcripts: { a: Array.from({ length: LIMITS.captionWordsPerFile }, (_, i) => w("a", i, i)) } } });
    expect(code(() => applyOps(many, [{ op: "splice_caption_words", assetId: "a", index: 0, remove: 0, insert: [w("a", 0, 0)] }]))).toBe("INVALID");
  });

  it("emptying the last file's words leaves an empty list, not a missing file", () => {
    const { doc } = applyOps(base(), [{ op: "splice_caption_words", assetId: "a", index: 0, remove: 4, insert: [] }]);
    expect(transcriptOf(doc, "a")).toEqual([]);
  });
});

describe("a locked caption track", () => {
  const locked = () => {
    const d = base();
    captionTrack(d)!.locked = true;
    return d;
  };
  it("refuses all three ops", () => {
    expect(code(() => applyOps(locked(), [{ op: "set_caption_style", patch: { preset: "word" } }]))).toBe("TRACK_LOCKED");
    expect(code(() => applyOps(locked(), [{ op: "set_caption_style", clear: true }]))).toBe("TRACK_LOCKED");
    expect(code(() => applyOps(locked(), [{ op: "set_transcript", assetId: "a", words: null }]))).toBe("TRACK_LOCKED");
    expect(code(() => applyOps(locked(), [{ op: "splice_caption_words", assetId: "a", index: 0, remove: 0, insert: [] }]))).toBe("TRACK_LOCKED");
  });
  it("allows them when the track is not locked or there is none", () => {
    expect(() => applyOps(base(), [{ op: "set_caption_style", patch: { preset: "word" } }])).not.toThrow();
    expect(() => applyOps(createEmptyDoc("short_9x16"), [{ op: "set_transcript", assetId: "a", words: WORDS }])).not.toThrow();
  });
});

describe("the captions clip switch", () => {
  const withClips = () =>
    applyOps(base(), [
      { op: "add_track", track: { id: "v2", kind: "video", name: "V" } },
      { op: "add_clip", trackId: "v1", clip: media("v", "video") },
      { op: "add_clip", trackId: "a1", clip: media("au", "audio") },
      { op: "add_clip", trackId: "v2", clip: media("im", "image") },
      { op: "add_clip", trackId: "t1", clip: { id: "tx", type: "text", start: 0, duration: 30, text: "hi", transform: { ...DEFAULT_TRANSFORM }, style: { fontFamily: "Geist", fontSize: 50, fontWeight: 700, color: "#fff", align: "center" } } },
      { op: "add_clip", trackId: "v2", clip: { id: "ph", type: "placeholder", start: 100, duration: 30, accepts: "visual", slot: { name: "main" }, transform: { ...DEFAULT_TRANSFORM } } },
    ]).doc;
  const find = (d: TimelineDoc, id: string) => d.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as Clip & { captions?: boolean };

  it("turns on for video and audio and undoes to off", () => {
    for (const id of ["v", "au"]) {
      const d = withClips();
      const { doc, inverse } = applyOps(d, [{ op: "update_clip", clipId: id, patch: { captions: true } }]);
      expect(find(doc, id).captions).toBe(true);
      expect(inverse).toEqual([{ op: "update_clip", clipId: id, patch: { captions: false }, expect: { captions: true } }]);
      const back = applyOps(doc, trip(inverse)).doc;
      expect(find(back, id).captions ?? false).toBe(false);
    }
  });

  it("expect captions: false holds on a clip with no field", () => {
    expect(() => applyOps(withClips(), [{ op: "update_clip", clipId: "v", patch: { volume: 0.5 }, expect: { captions: false } }])).not.toThrow();
    expect(code(() => applyOps(withClips(), [{ op: "update_clip", clipId: "v", patch: { volume: 0.5 }, expect: { captions: true } }]))).toBe("STALE");
  });

  it("is refused on image, text, shape and placeholder clips", () => {
    const d = withClips();
    const shaped = applyOps(applyOps(d, [{ op: "add_track", track: { id: "s1", kind: "shape", name: "S" } }]).doc, [
      { op: "add_clip", trackId: "s1", clip: { id: "sh", ...newShapeClip("rect", { start: 0, duration: 30, x: 0.5, y: 0.5, width: 100, height: 100 }, d) } },
    ]).doc;
    for (const [id, kind] of [["im", "an image"], ["tx", "a text"], ["sh", "a shape"], ["ph", "a visual placeholder"]] as const) {
      expect(() => applyOps(shaped, [{ op: "update_clip", clipId: id, patch: { captions: true } }])).toThrow(
        expect.objectContaining({ code: "INVALID", message: expect.stringContaining(`"captions" is not allowed on ${kind} clip`) }),
      );
    }
  });

  it("add_clip refuses captions on an image but takes it on video and audio", () => {
    expect(code(() => applyOps(base(), [{ op: "add_clip", trackId: "v1", clip: media("i", "image", { captions: true }) }]))).toBe("INVALID");
    expect(() => applyOps(base(), [{ op: "add_clip", trackId: "v1", clip: media("v", "video", { captions: true }) }])).not.toThrow();
    expect(() => applyOps(base(), [{ op: "add_clip", trackId: "a1", clip: media("a", "audio", { captions: true }) }])).not.toThrow();
  });

  it("split_clip keeps captions on both halves", () => {
    const d = applyOps(base(), [{ op: "add_clip", trackId: "v1", clip: media("v", "video", { captions: true }) }]).doc;
    const { doc } = applyOps(d, [{ op: "split_clip", clipId: "v", at: 30, newClipId: "v2" }]);
    expect(find(doc, "v").captions).toBe(true);
    expect(find(doc, "v2").captions).toBe(true);
  });
});
