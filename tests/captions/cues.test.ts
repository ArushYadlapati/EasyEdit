import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import { graphemes } from "@/lib/text";
import { CUE_RULES, captionsShow, clipCues, cuesAt, docCues, retextCue } from "@/lib/captions/cues";
import { DEFAULT_TRANSFORM, applyOps, type CaptionClip, type CaptionWord, type Clip, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";

const w = (t: string, s: number, e: number): CaptionWord => ({ t, s, e });
const clip = (extra: Partial<MediaClip> = {}): MediaClip =>
  ({ id: "c1", type: "video", assetId: "a", start: 0, duration: 300, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, captions: true, ...extra }) as MediaClip;
const FPS = 30;
// "hello brave new world." with short gaps, in file ms.
const SENTENCE = [w("hello", 0, 400), w("brave", 450, 800), w("new", 900, 1100), w("world.", 1200, 1700)];

describe("clipCues: where words land", () => {
  it("maps file milliseconds to timeline frames at 30 fps", () => {
    const [cue] = clipCues(clip(), SENTENCE, FPS, "block");
    expect(cue.words.map((x) => [x.text, x.start, x.end, x.index])).toEqual([
      ["hello", 0, 12, 0],
      ["brave", 13, 24, 1], // 450 ms is frame 13.5: the start floors
      ["new", 27, 33, 2],
      ["world.", 36, 51, 3],
    ]);
    expect(cue.start).toBe(0);
    expect(cue.text).toBe("hello brave new world.");
    expect(cue.clipId).toBe("c1");
    expect(cue.assetId).toBe("a");
  });

  it("offsets by the clip's start and in point", () => {
    // in = 30 frames = 1000 ms into the file; the clip sits at frame 100.
    const words = [w("skip", 0, 500), w("keep", 1000, 1500), w("this", 1600, 2000)];
    const [cue] = clipCues(clip({ start: 100, in: 30, duration: 60 }), words, FPS, "block");
    expect(cue.words.map((x) => x.text)).toEqual(["keep", "this"]);
    expect(cue.words[0].start).toBe(100);
    expect(cue.words[0].end).toBe(115);
    expect(cue.words[1].start).toBe(118);
  });

  it("plays faster at speed 2 and slower at speed 0.5", () => {
    const words = [w("one", 1000, 1500), w("two", 2000, 2500)];
    const fast = clipCues(clip({ speed: 2, duration: 60 }), words, FPS, "word");
    expect(fast.map((c) => [c.start, c.words[0].end])).toEqual([[15, 23], [30, 38]]);
    const slow = clipCues(clip({ speed: 0.5, duration: 300 }), words, FPS, "word");
    expect(slow.map((c) => [c.start, c.words[0].end])).toEqual([[60, 90], [120, 150]]);
  });

  it("agrees with the picture's forward mapping", () => {
    const c = clip({ start: 40, in: 15, speed: 2, duration: 60 });
    const words = [w("x", 2000, 2400)]; // 60..72 file frames
    const [cue] = clipCues(c, words, FPS, "word");
    // The picture at the cue's first frame shows the file at (in + (frame-start)*speed)/fps seconds.
    const shown = (c.in + (cue.start - c.start) * c.speed) / FPS;
    expect(Math.abs(shown - 2.0)).toBeLessThanOrEqual(c.speed / FPS);
  });
});

describe("clipCues: trim and split", () => {
  const talk = [w("a", 0, 500), w("b", 600, 1100), w("c", 1200, 1700), w("d", 1800, 2300)];
  it("a clip trimmed mid-sentence shows only the words it plays", () => {
    // Frames 18..54 of the file: 600 ms to 1800 ms.
    const cues = clipCues(clip({ in: 18, duration: 36 }), talk, FPS, "block");
    const shown = cues.flatMap((c) => c.words.map((x) => x.text));
    expect(shown).toEqual(["b", "c"]);
    for (const c of cues) {
      expect(c.start).toBeGreaterThanOrEqual(0);
      expect(c.end).toBeLessThanOrEqual(36);
    }
  });

  it("a word cut in half belongs to the half holding its middle, so split halves share none", () => {
    const first = clipCues(clip({ id: "l", start: 0, in: 0, duration: 30 }), talk, FPS, "word");
    const second = clipCues(clip({ id: "r", start: 30, in: 30, duration: 60 }), talk, FPS, "word");
    const a = first.flatMap((c) => c.words.map((x) => x.index));
    const b = second.flatMap((c) => c.words.map((x) => x.index));
    expect(a.filter((i) => b.includes(i))).toEqual([]);
    expect([...a, ...b].sort()).toEqual([0, 1, 2, 3]);
  });

  it("clamps a word that overhangs the clip into the clip", () => {
    // "a" is 0..500 ms = frames 0..15; the middle (7.5) is inside a clip that starts at file frame 5.
    const [cue] = clipCues(clip({ in: 5, duration: 100 }), [w("a", 0, 500)], FPS, "block");
    expect(cue.words[0].start).toBe(0);
    expect(cue.words[0].end).toBe(10);
  });
});

describe("clipCues: breaking lines", () => {
  it("breaks after a pause over pauseMs", () => {
    const words = [w("one", 0, 300), w("two", 300 + CUE_RULES.pauseMs, 1200), w("three", 1200 + CUE_RULES.pauseMs + 1, 1800)];
    const cues = clipCues(clip(), words, FPS, "block");
    // A gap of exactly pauseMs does not break; one more millisecond does.
    expect(cues.map((c) => c.text)).toEqual(["one two", "three"]);
  });

  it("breaks after a sentence end, with a closing quote or bracket allowed", () => {
    const words = [w("hi.", 0, 200), w("ok?", 250, 400), w('"yes!"', 450, 600), w("(no!)", 650, 800), w("and", 850, 1000), w("so", 1050, 1200)];
    expect(clipCues(clip(), words, FPS, "block").map((c) => c.text)).toEqual(["hi.", "ok?", '"yes!"', "(no!)", "and so"]);
  });

  it("breaks when the line would be longer than the maximum", () => {
    const words = Array.from({ length: 6 }, (_, i) => w("abcdefgh", i * 300, i * 300 + 250));
    // 3 words are 26 characters, 4 would be 35.
    const cues = clipCues(clip(), words, FPS, "block");
    expect(cues.map((c) => c.words.length)).toEqual([3, 3]);
    // Bar allows 42, so 5 words fit (44? no: 5 words = 44) -> 4 words (35).
    expect(clipCues(clip(), words, FPS, "bar").map((c) => c.words.length)).toEqual([4, 2]);
  });

  it("gives a word longer than the maximum a line of its own", () => {
    const words = [w("hi", 0, 200), w("x".repeat(40), 250, 600), w("yo", 650, 800)];
    expect(clipCues(clip(), words, FPS, "block").map((c) => c.text)).toEqual(["hi", "x".repeat(40), "yo"]);
  });

  it("word preset gives one word per line", () => {
    expect(clipCues(clip(), SENTENCE, FPS, "word").map((c) => c.text)).toEqual(["hello", "brave", "new", "world."]);
  });
});

describe("clipCues: timing of a line", () => {
  it("holds the last word, but never past the next line or the clip's end", () => {
    const hold = Math.ceil((CUE_RULES.holdMs * FPS) / 1000); // 12 frames
    const words = [w("a.", 0, 300), w("b.", 400, 700), w("c.", 3000, 3300)];
    const cues = clipCues(clip({ duration: 100 }), words, FPS, "block");
    expect(cues[0].end).toBe(cues[1].start); // next line starts at 12, before 9 + 12
    expect(cues[1].end).toBe(21 + hold);
    expect(cues[2].end).toBe(Math.min(100, 99 + hold)); // 3300 ms = frame 99, clip ends at 100
    expect(cues[2].end).toBe(100);
  });

  it("lines of one clip never overlap and always have length", () => {
    const words = Array.from({ length: 40 }, (_, i) => w(`w${i}`, i * 90, i * 90 + 60));
    for (const preset of ["block", "karaoke", "word", "bar"] as const) {
      const cues = clipCues(clip({ speed: 2 }), words, FPS, preset);
      cues.forEach((c, i) => {
        expect(c.end).toBeGreaterThan(c.start);
        if (i > 0) expect(c.start).toBeGreaterThanOrEqual(cues[i - 1].end);
      });
    }
  });

  it("returns nothing for no words, and is memoised per words array and timing", () => {
    expect(clipCues(clip(), [], FPS, "block")).toEqual([]);
    const a = clipCues(clip(), SENTENCE, FPS, "block");
    expect(clipCues(clip(), SENTENCE, FPS, "block")).toBe(a);
    expect(clipCues(clip({ start: 5 }), SENTENCE, FPS, "block")).not.toBe(a);
    expect(clipCues(clip(), [...SENTENCE], FPS, "block")).not.toBe(a);
  });
});

function docWith(clips: Clip[], words: CaptionWord[] = SENTENCE, extra: Partial<TimelineDoc> = {}): TimelineDoc {
  const d = docWithCaptions("short_9x16");
  d.tracks.find((t) => t.id === "v1")!.clips = clips;
  d.captions = { transcripts: { a: words } };
  return { ...d, ...extra };
}

describe("docCues, cuesAt and captionsShow", () => {
  it("skips clips with captions off, images and files without words; keeps hidden and muted tracks", () => {
    const d = docWith([
      clip({ id: "on" }),
      clip({ id: "off", captions: false, start: 400 }),
      clip({ id: "unset", captions: undefined, start: 500 }),
      clip({ id: "img", type: "image", start: 600 }),
      clip({ id: "nowords", assetId: "zzz", start: 700 }),
    ]);
    expect(docCues(d).map((c) => c.clipId)).toEqual(["on"]);
    const a1 = d.tracks.find((t) => t.id === "a1")!;
    a1.hidden = true;
    a1.muted = true;
    a1.clips = [clip({ id: "snd", type: "audio", start: 1000 })];
    d.tracks.find((t) => t.id === "v1")!.hidden = true;
    expect(docCues(d).map((c) => c.clipId)).toEqual(["on", "snd"]);
  });

  it("sorts by start, then track order", () => {
    const d = docWith([clip({ id: "late", start: 200 })]);
    d.tracks.find((t) => t.id === "t1")!.clips = [clip({ id: "early", start: 0 })];
    d.tracks.find((t) => t.id === "a1")!.clips = [clip({ id: "tie", type: "audio", start: 0 })];
    expect(docCues(d).map((c) => c.clipId)).toEqual(["early", "tie", "late"]);
  });

  it("cuesAt gives the lit word, which advances with the frame", () => {
    const d = docWith([clip()]);
    expect(cuesAt(d, 0).map((x) => x.lit)).toEqual([0]);
    expect(cuesAt(d, 13)[0].lit).toBe(1);
    expect(cuesAt(d, 28)[0].lit).toBe(2);
    expect(cuesAt(d, 40)[0].lit).toBe(3);
    expect(cuesAt(d, 40)[0].cue.text).toBe("hello brave new world.");
    expect(cuesAt(d, 200)).toEqual([]);
  });

  it("captionsShow is true only with a caption track that is not hidden", () => {
    const d = docWith([clip()]);
    expect(captionsShow(d)).toBe(true);
    d.tracks.find((t) => t.kind === "caption")!.hidden = true;
    expect(captionsShow(d)).toBe(false);
    d.tracks = d.tracks.filter((t) => t.kind !== "caption");
    expect(captionsShow(d)).toBe(false);
  });
});

describe("docCues: caption clips", () => {
  // The words are those of SENTENCE: hello 0–12, brave 13–24, new 27–33, world. 36–51 (frames, from the clip's start).
  const cap = (extra: Partial<CaptionClip> = {}): CaptionClip => ({ id: "k1", type: "caption", assetId: "a", start: 0, duration: 300, transform: { ...DEFAULT_TRANSFORM }, ...extra });
  const withCaps = (media: Clip[], caps: CaptionClip[]) => {
    const d = docWith(media);
    d.tracks.find((t) => t.kind === "caption")!.clips = caps;
    return d;
  };

  it("a caption clip shows its file's lines, as heard in its clips, and says which caption clip they are in", () => {
    const d = withCaps([clip({ captions: undefined })], [cap()]);
    expect(docCues(d).map((c) => [c.text, c.start, c.clipId, c.captionId])).toEqual([["hello brave new world.", 0, "c1", "k1"]]);
  });

  it("only the part inside the caption clip shows: the words that start in it, the line cut to it", () => {
    // Window 13–34: brave, new; world. starts at 36, past it.
    const d = withCaps([clip({ captions: undefined })], [cap({ start: 13, duration: 21 })]);
    const [cue] = docCues(d);
    expect(cue.words.map((x) => x.text)).toEqual(["brave", "new"]);
    expect(cue.text).toBe("brave new");
    expect([cue.start, cue.end]).toEqual([13, 34]);
    expect(cue.words[0].index).toBe(1);
  });

  it("two pieces of a split caption clip share the line between them, neither holding a word twice", () => {
    const d = withCaps([clip({ captions: undefined })], [cap({ id: "k1", start: 0, duration: 27 }), cap({ id: "k2", start: 27, duration: 273 })]);
    expect(docCues(d).map((c) => [c.captionId, c.text, c.start, c.end])).toEqual([
      ["k1", "hello brave", 0, 27],
      ["k2", "new world.", 27, 63],
    ]);
  });

  it("a caption clip of another file, or with no clip of its file, shows nothing; one with no words in it neither", () => {
    expect(docCues(withCaps([clip({ captions: undefined })], [cap({ assetId: "zzz" })]))).toEqual([]);
    expect(docCues(withCaps([], [cap()]))).toEqual([]);
    expect(docCues(withCaps([clip({ captions: undefined })], [cap({ start: 100, duration: 50 })]))).toEqual([]);
  });

  it("a clip with captions switched on the old way still shows them, without a caption clip, and is never shown twice", () => {
    const old = docCues(withCaps([clip({ captions: true })], []));
    expect(old.map((c) => [c.text, c.captionId])).toEqual([["hello brave new world.", null]]);
    // Both: the caption clip's lines, once.
    const both = docCues(withCaps([clip({ captions: true })], [cap()]));
    expect(both.map((c) => [c.text, c.captionId])).toEqual([["hello brave new world.", "k1"]]);
  });

  it("a caption clip on a track other than Captions is not read", () => {
    const d = withCaps([clip({ captions: undefined })], []);
    d.tracks.find((t) => t.id === "t1")!.clips = [cap() as unknown as Clip];
    expect(docCues(d)).toEqual([]);
  });
});

describe("retextCue", () => {
  const FILE = [w("before", 0, 100), w("hello", 1000, 1400), w("brave", 1500, 1900), w("world", 2000, 2500), w("after", 3000, 3200)];
  const cue = () => clipCues(clip(), FILE.slice(1, 4), FPS, "block")[0];
  // The cue's word indexes are relative to the list it was made from, so shift them to FILE.
  const fileCue = () => {
    const c = cue();
    return { ...c, words: c.words.map((x) => ({ ...x, index: x.index + 1 })) };
  };
  const apply = (edit: NonNullable<ReturnType<typeof retextCue>>) => {
    const d = docWith([clip()], FILE);
    return applyOps(d, [{ op: "splice_caption_words", assetId: "a", ...edit, expect: { words: FILE.slice(edit.index, edit.index + edit.remove) } }]).doc.captions!.transcripts!.a;
  };

  it("returns null when the words are the same", () => {
    expect(retextCue(fileCue(), FILE, "hello  brave\nworld")).toBeNull();
  });

  it("keeps the times when the count is the same", () => {
    const edit = retextCue(fileCue(), FILE, "howdy brave planet")!;
    expect(edit).toEqual({ index: 1, remove: 3, insert: [w("howdy", 1000, 1400), w("brave", 1500, 1900), w("planet", 2000, 2500)] });
  });

  it("shares the span out by letters when there are more words", () => {
    const edit = retextCue(fileCue(), FILE, "a bb cccc dd")!;
    expect(edit.remove).toBe(3);
    const ins = edit.insert;
    expect(ins.map((x) => x.t)).toEqual(["a", "bb", "cccc", "dd"]);
    expect(ins[0].s).toBe(1000);
    expect(ins[3].e).toBe(2500);
    for (let i = 1; i < ins.length; i++) expect(ins[i].s).toBe(ins[i - 1].e);
    expect(ins[2].e - ins[2].s).toBeGreaterThan(ins[0].e - ins[0].s);
    expect(apply(edit)).toHaveLength(FILE.length + 1);
  });

  it("shares the span out when there are fewer words", () => {
    const edit = retextCue(fileCue(), FILE, "hi everyone")!;
    expect(edit.insert).toHaveLength(2);
    expect(edit.insert[0].s).toBe(1000);
    expect(edit.insert[1].e).toBe(2500);
    expect(edit.insert[0].e).toBe(edit.insert[1].s);
    expect(apply(edit)).toHaveLength(FILE.length - 1);
  });

  it("removes the run for empty text", () => {
    const edit = retextCue(fileCue(), FILE, "   ")!;
    expect(edit).toEqual({ index: 1, remove: 3, insert: [] });
    expect(apply(edit).map((x) => x.t)).toEqual(["before", "after"]);
  });

  it("gives every word at least a millisecond where the span allows", () => {
    const tiny = [w("a", 100, 104)];
    const c = { ...clipCues(clip(), tiny, FPS, "block")[0] };
    const edit = retextCue(c, tiny, "x yyyyyyyyyyyyyyyyyyyy z q")!;
    for (const x of edit.insert) expect(x.e - x.s).toBeGreaterThanOrEqual(1);
    expect(edit.insert[0].s).toBe(100);
    expect(edit.insert.at(-1)!.e).toBe(104);
  });

  it("copes with an emoji and keeps the result valid", () => {
    const edit = retextCue(fileCue(), FILE, "😀 👨‍👩‍👧‍👦 ok fine")!;
    expect(edit.insert.map((x) => x.t)).toEqual(["😀", "👨‍👩‍👧‍👦", "ok", "fine"]);
    expect(() => apply(edit)).not.toThrow();
  });

  it("cuts a 200-character word to the limit and the op is accepted", () => {
    for (const long of ["x".repeat(200), "😀".repeat(200), "👨‍👩‍👧‍👦".repeat(50)]) {
      const edit = retextCue(fileCue(), FILE, `${long} b`)!;
      const t = edit.insert[0].t;
      expect(graphemes(t).length).toBeLessThanOrEqual(LIMITS.captionWordChars);
      expect(t.length).toBeLessThanOrEqual(LIMITS.captionWordChars);
      expect(t.length).toBeGreaterThan(0);
      expect(() => apply(edit)).not.toThrow();
    }
  });

  it("keeps times inside the old span and in order", () => {
    const edit = retextCue(fileCue(), FILE, "one two three four five six seven")!;
    let prev = 1000;
    for (const x of edit.insert) {
      expect(x.s).toBeGreaterThanOrEqual(prev);
      expect(x.e).toBeGreaterThanOrEqual(x.s);
      expect(x.e).toBeLessThanOrEqual(2500);
      prev = x.e;
    }
  });
});

describe("docCues: a switched-on clip beside caption clips of its file", () => {
  it("shows its own lines when no caption clip of its file lies over it", () => {
    const d = docWithCaptions("short_9x16");
    d.tracks.find((t) => t.id === "v1")!.clips = [clip({ id: "c1", captions: undefined }), clip({ id: "c2", start: 400, captions: true })];
    d.tracks.find((t) => t.kind === "caption")!.clips = [{ id: "k1", type: "caption", assetId: "a", start: 0, duration: 300, transform: { ...DEFAULT_TRANSFORM } }];
    d.captions = { transcripts: { a: SENTENCE } };
    expect(docCues(d).map((c) => [c.clipId, c.captionId])).toEqual([["c1", "k1"], ["c2", null]]);
  });
});
