import { describe, expect, it, vi } from "vitest";
import {
  captionOps,
  captionTargets,
  captionsOffOps,
  retextOps,
  runAutoCaptions,
  type AutoCaptionDeps,
  type AutoCaptionProgress,
} from "@/lib/captions/actions";
import { docCues } from "@/lib/captions/cues";
import { SPEECH_MODEL, TranscribeError, type TranscribeProgress, type Transcriber } from "@/lib/captions/speech/client";
import type { BrandFonts } from "@/lib/brand/types";
import { findClip } from "@/lib/editor/store";
import type { MediaFiles } from "@/lib/media/media-files";
import type { AssetView } from "@/lib/media/types";
import { DEFAULT_TRANSFORM, applyOps, createEmptyDoc, defaultCaptionStyle, prepareOps, type CaptionWord, type Clip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { LIMITS } from "@/lib/limits";
import { makeStore, noticesOf, text, video } from "../editor/fixtures";
import { assetView } from "../helpers/media-services";

const w = (t: string, s: number, e: number): CaptionWord => ({ t, s, e });
const HELLO = [w("hello", 0, 400), w("there.", 450, 900)];
const FONTS: BrandFonts = { title: "Anton", subtitle: "Geist", body: "Inter" };

const audio = (id: string, start: number, duration: number, assetId: string) =>
  ({ id, type: "audio", assetId, start, duration, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM } }) as Clip;

// v1 [c1 0-30 "a", c2 30-60 "b"] · t1 [x1] · a1 [s1 0-60 "m"], with no Captions track and no captions.
function plainDoc(): TimelineDoc {
  const doc = createEmptyDoc("short_9x16");
  doc.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, { assetId: "b" })];
  doc.tracks[1].clips = [text("x1", 0, 60)];
  doc.tracks[2].clips = [audio("s1", 0, 60, "m")];
  return doc;
}

const apply = (doc: TimelineDoc, ops: OpInput[]) => applyOps(doc, prepareOps(ops, () => "gen1")).doc;
const clipOf = (doc: TimelineDoc, id: string) => findClip(doc, id)!.clip as Clip & { captions?: boolean };

describe("captionTargets", () => {
  it("is every video and audio clip when none is selected", () => {
    expect(captionTargets(plainDoc(), []).map((c) => c.id)).toEqual(["c1", "c2", "s1"]);
  });

  it("is the selected video and audio clips", () => {
    expect(captionTargets(plainDoc(), ["x1", "c2", "s1"]).map((c) => c.id)).toEqual(["c2", "s1"]);
  });

  it("is nothing when the selection holds clips but no video or audio clip", () => {
    expect(captionTargets(plainDoc(), ["x1"])).toEqual([]);
  });
});

describe("captionOps", () => {
  it("adds the track, the style in the kit's title font, the words and the clip switches, in that order", () => {
    const doc = plainDoc();
    const ops = captionOps(doc, { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS });
    expect(ops.map((o) => o.op)).toEqual(["add_track", "set_caption_style", "set_transcript", "update_clip"]);
    expect(ops[0]).toMatchObject({ track: { kind: "caption" } });
    // Anton has only 400, so the bold the default asks for comes out as its nearest weight.
    expect(ops[1]).toEqual({ op: "set_caption_style", patch: { ...defaultCaptionStyle(doc), fontFamily: "Anton", fontWeight: 400 } });
    expect(ops[2]).toEqual({ op: "set_transcript", assetId: "a", words: HELLO, expect: { words: null } });
    expect(ops[3]).toEqual({ op: "update_clip", clipId: "c1", patch: { captions: true } });
  });

  // Different words for a file that has some are written over them: that is "Transcribe again". A run that is not
  // passes the project's own words, so nothing is written (see runAutoCaptions).
  it("adds only what is missing, and writes new words over the file's when they differ", () => {
    const once = apply(plainDoc(), captionOps(plainDoc(), { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS }));
    expect(captionOps(once, { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS })).toEqual([]);
    const more = [...HELLO, w("again", 1000, 1300)];
    expect(captionOps(once, { assetId: "a", words: more, clipIds: ["c1", "c2"], fonts: FONTS })).toEqual([
      { op: "set_transcript", assetId: "a", words: more, expect: { words: 2 } },
      { op: "update_clip", clipId: "c2", patch: { captions: true } },
    ]);
  });

  it("drops, in the same edit, the words of files no clip uses any more, before adding new ones", () => {
    const doc = apply(plainDoc(), [
      { op: "set_transcript", assetId: "gone", words: HELLO },
      // "m" has a clip with captions off: its words stay.
      { op: "set_transcript", assetId: "m", words: HELLO },
    ]);
    expect(captionOps(doc, { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS }).map((o) => [o.op, "assetId" in o ? o.assetId : undefined, "words" in o ? o.words : undefined])).toEqual([
      ["add_track", undefined, undefined],
      ["set_caption_style", undefined, undefined],
      ["set_transcript", "gone", null],
      ["set_transcript", "a", HELLO],
      ["update_clip", undefined, undefined],
    ]);
    const drop = captionOps(doc, { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS })[2];
    expect(drop).toEqual({ op: "set_transcript", assetId: "gone", words: null, expect: { words: 2 } });
  });
});

describe("retextOps and captionsOffOps", () => {
  const captioned = () => apply(plainDoc(), captionOps(plainDoc(), { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS }));

  it("splices the line's words, guarded by what they are now", () => {
    const doc = captioned();
    const [cue] = docCues(doc);
    expect(retextOps(doc, cue, "hello there.")).toEqual([]);
    expect(retextOps(doc, cue, "hi there.")).toEqual([
      { op: "splice_caption_words", assetId: "a", index: 0, remove: 2, insert: [w("hi", 0, 400), w("there.", 450, 900)], expect: { words: HELLO } },
    ]);
  });

  it("does nothing for a line whose words have changed since", () => {
    const doc = captioned();
    const [cue] = docCues(doc);
    const changed = apply(doc, [{ op: "set_transcript", assetId: "a", words: [w("other", 0, 300)] }]);
    expect(retextOps(changed, cue, "new words")).toEqual([]);
  });

  it("turns captions off for the listed clips that have them on, keeping the words", () => {
    const doc = captioned();
    const ops = captionsOffOps(doc, ["c1", "c2", "x1"]);
    expect(ops).toEqual([{ op: "update_clip", clipId: "c1", patch: { captions: false } }]);
    expect(apply(doc, ops).captions?.transcripts?.a).toEqual(HELLO);
  });
});

it("one undo of an edit that dropped a file's words brings them back exactly", () => {
  const doc = apply(plainDoc(), [{ op: "set_transcript", assetId: "gone", words: HELLO }]);
  const store = makeStore({ doc });
  const before = structuredClone(store.getState().doc);
  expect(store.getState().edit(captionOps(before, { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS }), "auto captions").ok).toBe(true);
  expect(store.getState().doc.captions?.transcripts).toEqual({ a: HELLO });
  store.getState().undo();
  expect(store.getState().doc.captions?.transcripts).toStrictEqual({ gone: HELLO });
  const off = structuredClone(before);
  (off.tracks[0].clips[0] as Clip & { captions?: boolean }).captions = false;
  expect(store.getState().doc).toStrictEqual(off);
});

it("one undo after captioning a file restores the project exactly, and redo brings it all back", () => {
  const store = makeStore({ doc: plainDoc() });
  const before = structuredClone(store.getState().doc);
  const ops = captionOps(before, { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS });
  expect(store.getState().edit(ops, "auto captions").ok).toBe(true);
  const after = structuredClone(store.getState().doc);
  expect(after.captions?.transcripts?.a).toEqual(HELLO);
  store.getState().undo();
  // The track, the stored style and the words are gone; the clip's switch is back off (update_clip's way back writes
  // the neutral false, which draws exactly as no switch).
  const off = structuredClone(before);
  (off.tracks[0].clips[0] as Clip & { captions?: boolean }).captions = false;
  expect(store.getState().doc).toStrictEqual(off);
  expect(store.getState().doc.captions).toBeUndefined();
  expect(docCues(store.getState().doc)).toEqual([]);
  store.getState().redo();
  expect(store.getState().doc).toEqual(after);
});

// A transcriber that answers by the file's id: words, or a failure. It reports one progress step of each stage first.
function pretendTranscriber(answers: Record<string, CaptionWord[] | TranscribeError>) {
  const heard: string[] = [];
  const transcriber: Transcriber = {
    async transcribe(file, opts = {}) {
      const id = await file.text();
      heard.push(id);
      const steps: TranscribeProgress[] = [
        { stage: "model", done: 42, total: 100 },
        { stage: "sound", done: 0, total: 185 },
        { stage: "speech", done: 70, total: 185 },
      ];
      steps.forEach((p) => opts.onProgress?.(p));
      const answer = answers[id];
      if (!answer) throw new TranscribeError("unknown", "no answer");
      if (answer instanceof TranscribeError) throw answer;
      return answer;
    },
  };
  return { transcriber, heard };
}

const ASSETS: AssetView[] = [
  assetView({ id: "a", name: "intake" }),
  assetView({ id: "b", name: "b-roll", originalFileId: "orig-b", previewFileId: "prev-b" }),
  assetView({ id: "m", kind: "audio", name: "voiceover", originalFileId: "orig-m", previewStatus: "none", previewFileId: null, posterFileId: null }),
];

function fakeDeps(over: Omit<Partial<AutoCaptionDeps>, "assets"> & { answers?: Record<string, CaptionWord[] | TranscribeError>; saved?: Record<string, CaptionWord[]>; assets?: AssetView[] } = {}) {
  const { answers = {}, saved = {}, assets = ASSETS, ...rest } = over;
  const pretend = pretendTranscriber(answers);
  const files: MediaFiles = {
    get: vi.fn(async (fileId: string) => ({ ok: true as const, blob: new Blob([fileId]) })),
    put: async () => {},
  };
  const deps: AutoCaptionDeps = {
    transcriber: pretend.transcriber,
    fetchSaved: vi.fn(async (assetId: string) => saved[assetId] ?? null),
    save: vi.fn(async () => true),
    files,
    assets: () => Object.fromEntries(assets.map((a) => [a.id, a])),
    ensure: vi.fn(async () => []),
    fonts: () => FONTS,
    ...rest,
  };
  return { deps, heard: pretend.heard };
}

describe("runAutoCaptions", () => {
  it("uses the saved words without transcribing, as one undo step", async () => {
    const store = makeStore({ doc: plainDoc() });
    store.getState().select(["c1"]);
    const { deps, heard } = fakeDeps({ saved: { a: HELLO } });
    const stages: string[] = [];
    const outcome = await runAutoCaptions(store, deps, { onProgress: (p) => stages.push(p.stage) });
    expect(outcome).toEqual({ captioned: 1, silent: [], failed: [], cancelled: false });
    // Checking first; "saved" only once there are saved words.
    expect(stages).toEqual(["checking", "saved"]);
    expect(heard).toEqual([]);
    expect(deps.save).not.toHaveBeenCalled();
    const doc = store.getState().doc;
    expect(doc.captions?.transcripts?.a).toEqual(HELLO);
    expect(clipOf(doc, "c1").captions).toBe(true);
    expect(doc.tracks.some((t) => t.kind === "caption")).toBe(true);
    expect(store.getState().undoStack.map((e) => e.label)).toEqual(["auto captions"]);
  });

  it("transcribes the preview copy and saves the words when none are saved, reporting each stage", async () => {
    const store = makeStore({ doc: plainDoc() });
    store.getState().select(["c1"]);
    const { deps, heard } = fakeDeps({ answers: { "prev-a": HELLO } });
    const progress: AutoCaptionProgress[] = [];
    const outcome = await runAutoCaptions(store, deps, { onProgress: (p) => progress.push(p) });
    expect(outcome.captioned).toBe(1);
    expect(heard).toEqual(["prev-a"]);
    expect(deps.save).toHaveBeenCalledWith("a", HELLO, SPEECH_MODEL); // English as spoken: marked with the bare model
    // "sound" first while the file itself is read, before the transcriber reports anything.
    expect(progress.map((p) => p.stage)).toEqual(["checking", "sound", "model", "sound", "speech"]);
    expect(progress[1]).toEqual({ file: 1, files: 1, name: "intake", stage: "sound", done: 0, total: 0 });
    expect(progress[4]).toEqual({ file: 1, files: 1, name: "intake", stage: "speech", done: 70, total: 185 });
  });

  it("transcribes again with redo, ignoring the saved words", async () => {
    const store = makeStore({ doc: plainDoc() });
    store.getState().select(["c1"]);
    const fresh = [w("fresh", 0, 300)];
    const { deps, heard } = fakeDeps({ saved: { a: HELLO }, answers: { "prev-a": fresh } });
    const stages: string[] = [];
    await runAutoCaptions(store, deps, { redo: true, onProgress: (p) => stages.push(p.stage) });
    expect(deps.fetchSaved).not.toHaveBeenCalled();
    expect(stages[0]).toBe("sound");
    expect(heard).toEqual(["prev-a"]);
    expect(store.getState().doc.captions?.transcripts?.a).toEqual(fresh);
    expect(deps.save).toHaveBeenCalledWith("a", fresh, SPEECH_MODEL);
  });

  it("tries the original file once when the preview copy has no sound it can read", async () => {
    for (const code of ["no-sound", "undecodable"] as const) {
      const store = makeStore({ doc: plainDoc() });
      store.getState().select(["c1"]);
      const { deps, heard } = fakeDeps({ answers: { "prev-a": new TranscribeError(code, "x"), "orig-a": HELLO } });
      const outcome = await runAutoCaptions(store, deps, {});
      expect(heard).toEqual(["prev-a", "orig-a"]);
      expect(outcome.captioned).toBe(1);
    }
  });

  it("says a file is silent and leaves the project untouched: no sound track, no sound, no speech", async () => {
    const cases: { assets?: AssetView[]; answers?: Record<string, CaptionWord[] | TranscribeError> }[] = [
      { assets: [assetView({ id: "a", name: "intake", hasAudio: false })] },
      { answers: { "prev-a": new TranscribeError("no-sound", "x"), "orig-a": new TranscribeError("no-sound", "x") } },
      { answers: { "prev-a": [] } },
    ];
    for (const c of cases) {
      const store = makeStore({ doc: plainDoc() });
      store.getState().select(["c1"]);
      const before = structuredClone(store.getState().doc);
      const { deps } = fakeDeps(c);
      const outcome = await runAutoCaptions(store, deps, {});
      expect(outcome).toEqual({ captioned: 0, silent: ["intake"], failed: [], cancelled: false });
      expect(store.getState().doc).toStrictEqual(before);
      expect(store.getState().undoStack).toEqual([]);
    }
  });

  it("reports a file that fails, with why, and leaves the project untouched for it", async () => {
    const store = makeStore({ doc: plainDoc() });
    store.getState().select(["c1", "s1"]);
    const { deps } = fakeDeps({ answers: { "prev-a": new TranscribeError("model", "x"), "orig-m": HELLO } });
    const outcome = await runAutoCaptions(store, deps, {});
    expect(outcome.failed).toEqual([{ name: "intake", why: "the speech model couldn't be loaded." }]);
    expect(outcome.captioned).toBe(1);
    const doc = store.getState().doc;
    expect(doc.captions?.transcripts).toEqual({ m: HELLO });
    expect(clipOf(doc, "c1").captions).toBeUndefined();
  });

  it("says why a file can't be read: removed, still uploading, or its file unreadable", async () => {
    const run = async (asset: AssetView, files?: MediaFiles) => {
      const store = makeStore({ doc: plainDoc() });
      store.getState().select(["c1"]);
      const { deps } = fakeDeps({ assets: [asset], ...(files && { files }) });
      return (await runAutoCaptions(store, deps, {})).failed;
    };
    expect(await run(assetView({ id: "a", name: "intake", removed: true }))).toEqual([{ name: "intake", why: "it was removed from the media library." }]);
    expect(await run(assetView({ id: "a", name: "intake", status: "uploading", originalFileId: null }))).toEqual([{ name: "intake", why: "it isn't ready yet." }]);
    const broken: MediaFiles = { get: async () => ({ ok: false, problem: "offline" }), put: async () => {} };
    expect(await run(assetView({ id: "a", name: "intake" }), broken)).toEqual([{ name: "intake", why: "its file couldn't be read." }]);
  });

  it("captions only clips still there when the words arrive", async () => {
    const store = makeStore({ doc: plainDoc() });
    store.getState().select(["c1"]);
    const doc = plainDoc();
    doc.tracks[0].clips = [video("c1", 0, 30), video("c3", 40, 30)];
    store.getState().replaceServer(doc, 6);
    store.getState().select([]);
    const { deps } = fakeDeps({
      fetchSaved: vi.fn(async (assetId: string) => {
        if (assetId === "a") store.getState().edit([{ op: "remove_clip", clipId: "c3" }], "delete");
        return assetId === "a" ? HELLO : null;
      }),
      assets: [ASSETS[0]],
    });
    const outcome = await runAutoCaptions(store, deps, {});
    expect(outcome.captioned).toBe(1);
    expect(clipOf(store.getState().doc, "c1").captions).toBe(true);
    expect(findClip(store.getState().doc, "c3")).toBeNull();
  });

  it("stops at a cancel mid-file, keeping the files already done", async () => {
    const store = makeStore({ doc: plainDoc() });
    const controller = new AbortController();
    const heard: string[] = [];
    const transcriber: Transcriber = {
      transcribe: (file, opts = {}) =>
        file.text().then((id) => {
          heard.push(id);
          if (id === "prev-a") return HELLO;
          // The second file is cancelled while it is being heard.
          return new Promise<CaptionWord[]>((_, reject) => {
            opts.signal?.addEventListener("abort", () => reject(new TranscribeError("cancelled", "x")));
            controller.abort();
          });
        }),
    };
    const { deps } = fakeDeps({ transcriber });
    const outcome = await runAutoCaptions(store, deps, { signal: controller.signal });
    expect(outcome).toEqual({ captioned: 1, silent: [], failed: [], cancelled: true });
    expect(heard).toEqual(["prev-a", "prev-b"]);
    const doc = store.getState().doc;
    expect(Object.keys(doc.captions?.transcripts ?? {})).toEqual(["a"]);
    expect(clipOf(doc, "c2").captions).toBeUndefined();
    expect(store.getState().undoStack.map((e) => e.label)).toEqual(["auto captions"]);
  });

  it("keeps a person's fixes: a file with words in the project uses them, with nothing fetched or heard", async () => {
    const doc = plainDoc();
    doc.tracks[0].clips.push(video("c3", 60, 30));
    const store = makeStore({ doc });
    store.getState().select(["c1"]);
    await runAutoCaptions(store, fakeDeps({ saved: { a: HELLO } }).deps, {});
    // A person fixes a word.
    expect(store.getState().edit([{ op: "splice_caption_words", assetId: "a", index: 0, remove: 1, text: "howdy" }], "edit caption").ok).toBe(true);
    const fixed = store.getState().doc.captions!.transcripts!.a;
    expect(fixed[0].t).toBe("howdy");

    // A second clip of the same file: switched on with the project's words.
    store.getState().select(["c3"]);
    const second = fakeDeps({ saved: { a: HELLO }, answers: { "prev-a": [w("other", 0, 300)] } });
    expect(await runAutoCaptions(store, second.deps, {})).toEqual({ captioned: 1, silent: [], failed: [], cancelled: false });
    expect(second.deps.fetchSaved).not.toHaveBeenCalled();
    expect(second.heard).toEqual([]);
    expect(store.getState().doc.captions?.transcripts?.a).toEqual(fixed);
    expect(clipOf(store.getState().doc, "c3").captions).toBe(true);
    expect(store.getState().undoStack.at(-1)?.ops.map((o) => o.op)).toEqual(["update_clip"]);

    // Nothing selected, with another file in the project: the fix stays and the other file is captioned.
    store.getState().select([]);
    const third = fakeDeps({ saved: { a: HELLO, b: HELLO }, answers: { "orig-m": HELLO } });
    const outcome = await runAutoCaptions(store, third.deps, {});
    expect(outcome).toEqual({ captioned: 3, silent: [], failed: [], cancelled: false });
    expect(third.deps.fetchSaved).not.toHaveBeenCalledWith("a", expect.anything());
    expect(third.heard).toEqual(["orig-m"]);
    const after = store.getState().doc;
    expect(after.captions?.transcripts?.a).toEqual(fixed);
    expect(after.captions?.transcripts?.b).toEqual(HELLO);
    expect(clipOf(after, "c2").captions).toBe(true);
  });

  it("Transcribe again still replaces the project's words", async () => {
    const store = makeStore({ doc: apply(plainDoc(), captionOps(plainDoc(), { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS })) });
    store.getState().select(["c1"]);
    const fresh = [w("fresh", 0, 300)];
    const { deps, heard } = fakeDeps({ answers: { "prev-a": fresh } });
    await runAutoCaptions(store, deps, { redo: true });
    expect(heard).toEqual(["prev-a"]);
    expect(store.getState().doc.captions?.transcripts?.a).toEqual(fresh);
  });

  it("never saves an empty result, and takes saved words that are an empty list as none saved", async () => {
    const silent = makeStore({ doc: plainDoc() });
    silent.getState().select(["c1"]);
    const quiet = fakeDeps({ answers: { "prev-a": [] } });
    expect((await runAutoCaptions(silent, quiet.deps, {})).silent).toEqual(["intake"]);
    expect(quiet.deps.save).not.toHaveBeenCalled();

    const store = makeStore({ doc: plainDoc() });
    store.getState().select(["c1"]);
    const { deps, heard } = fakeDeps({ saved: { a: [] }, answers: { "prev-a": HELLO } });
    expect((await runAutoCaptions(store, deps, {})).captioned).toBe(1);
    expect(heard).toEqual(["prev-a"]);
    expect(store.getState().doc.captions?.transcripts?.a).toEqual(HELLO);
  });

  it("does not start on a locked Captions track: says so, with nothing fetched or heard", async () => {
    const doc = plainDoc();
    doc.tracks.splice(2, 0, { id: "cap", kind: "caption", name: "Captions", muted: false, hidden: false, locked: true, clips: [] });
    const store = makeStore({ doc });
    const notices = noticesOf(store);
    const { deps, heard } = fakeDeps({ saved: { a: HELLO } });
    const outcome = await runAutoCaptions(store, deps, {});
    expect(outcome).toEqual({ captioned: 0, silent: [], failed: [], cancelled: false });
    expect(notices).toEqual(["That track is locked."]);
    expect(deps.fetchSaved).not.toHaveBeenCalled();
    expect(deps.ensure).not.toHaveBeenCalled();
    expect(heard).toEqual([]);
    expect(store.getState().queue).toEqual([]);
  });

  describe("the limit on files with words", () => {
    // A project whose 50 files each have words and a clip ("f0" … "f49"), plus "a" (c1) with none yet.
    function fullDoc(unusedLast = false) {
      const doc = plainDoc();
      doc.tracks[0].clips = [video("c1", 0, 30)];
      doc.tracks[2].clips = [];
      const transcripts: Record<string, CaptionWord[]> = {};
      for (let i = 0; i < LIMITS.captionFilesPerProject; i++) {
        transcripts[`f${i}`] = [w("hi", 0, 100)];
        if (!(unusedLast && i === LIMITS.captionFilesPerProject - 1)) doc.tracks[2].clips.push(audio(`s${i}`, i * 10, 10, `f${i}`));
      }
      doc.captions = { transcripts };
      return doc;
    }

    it("refuses a new file before hearing it when the project already keeps words for 50 files", async () => {
      const store = makeStore({ doc: fullDoc() });
      store.getState().select(["c1"]);
      const before = structuredClone(store.getState().doc);
      const { deps, heard } = fakeDeps({ answers: { "prev-a": HELLO } });
      const outcome = await runAutoCaptions(store, deps, {});
      expect(outcome).toEqual({ captioned: 0, silent: [], failed: [{ name: "intake", why: "this project already has captions for 50 files." }], cancelled: false });
      expect(heard).toEqual([]);
      expect(deps.fetchSaved).not.toHaveBeenCalled();
      expect(store.getState().doc).toStrictEqual(before);
    });

    it("counts only the files a clip still uses, and drops the others in the same edit", async () => {
      const store = makeStore({ doc: fullDoc(true) });
      store.getState().select(["c1"]);
      const { deps } = fakeDeps({ answers: { "prev-a": HELLO } });
      expect((await runAutoCaptions(store, deps, {})).captioned).toBe(1);
      const transcripts = store.getState().doc.captions?.transcripts ?? {};
      expect(transcripts.a).toEqual(HELLO);
      expect(transcripts[`f${LIMITS.captionFilesPerProject - 1}`]).toBeUndefined();
      expect(Object.keys(transcripts)).toHaveLength(LIMITS.captionFilesPerProject);
    });
  });

  it("never throws: a dep that throws or rejects fails that file", async () => {
    const run = async (over: Parameters<typeof fakeDeps>[0]) => {
      const store = makeStore({ doc: plainDoc() });
      store.getState().select(["c1"]);
      const before = structuredClone(store.getState().doc);
      const outcome = await runAutoCaptions(store, fakeDeps(over).deps, {});
      expect(store.getState().doc).toStrictEqual(before);
      return outcome;
    };
    const why = "something went wrong. Try again.";
    const rejecting: MediaFiles = { get: () => Promise.reject(new Error("down")), put: async () => {} };
    expect(await run({ files: rejecting, ensure: vi.fn(() => Promise.reject(new Error("down"))) })).toEqual({ captioned: 0, silent: [], failed: [{ name: "intake", why }], cancelled: false });
    const throwing = fakeDeps().deps;
    throwing.assets = () => {
      throw new Error("broken library");
    };
    const store = makeStore({ doc: plainDoc() });
    store.getState().select(["c1"]);
    expect(await runAutoCaptions(store, throwing, {})).toEqual({ captioned: 0, silent: [], failed: [{ name: "a file", why }], cancelled: false });
  });
});

describe("captions in another language", () => {
  // A transcriber that writes down what it was asked for.
  function listening() {
    const asked: { language?: string; translate?: boolean }[] = [];
    const transcriber: Transcriber = {
      async transcribe(_file, opts = {}) {
        asked.push({ language: opts.language, translate: opts.translate });
        return HELLO;
      },
    };
    return { transcriber, asked };
  }
  const run = async (speech: { language: string; translate: boolean } | undefined, saved: Record<string, CaptionWord[]> = {}) => {
    const store = makeStore({ doc: plainDoc() });
    store.getState().select(["c1"]);
    const heard = listening();
    // The server keeps one set of words a file, marked with what they were heard as.
    const { deps } = fakeDeps({ transcriber: heard.transcriber, fetchSaved: vi.fn(async (_assetId: string, tag: string) => saved[tag] ?? null) });
    const outcome = await runAutoCaptions(store, deps, { speech });
    return { deps, asked: heard.asked, outcome };
  };

  it("hears the language picked, and marks the saved words with it", async () => {
    const spanish = await run({ language: "spanish", translate: false });
    expect(spanish.asked).toEqual([{ language: "spanish", translate: false }]);
    expect(spanish.deps.fetchSaved).toHaveBeenCalledWith("a", `${SPEECH_MODEL}#spanish`);
    expect(spanish.deps.save).toHaveBeenCalledWith("a", HELLO, `${SPEECH_MODEL}#spanish`);
    const translated = await run({ language: "spanish", translate: true });
    expect(translated.asked).toEqual([{ language: "spanish", translate: true }]);
    expect(translated.deps.save).toHaveBeenCalledWith("a", HELLO, `${SPEECH_MODEL}#spanish>english`);
  });
  it("uses saved words only when they were heard as the same thing", async () => {
    // The server has this file's words as English: someone wanting Spanish hears it again.
    const english = { [SPEECH_MODEL]: HELLO };
    expect((await run({ language: "spanish", translate: false }, english)).asked).toHaveLength(1);
    expect((await run(undefined, english)).asked).toHaveLength(0);
    expect((await run({ language: "spanish", translate: false }, { [`${SPEECH_MODEL}#spanish`]: HELLO })).asked).toHaveLength(0);
  });
  it("makes a choice whole before it runs: Chinese is always written in English, and a language it does not know is English", async () => {
    expect((await run({ language: "chinese", translate: false })).asked).toEqual([{ language: "chinese", translate: true }]);
    const unknown = await run({ language: "klingon", translate: true });
    expect(unknown.asked).toEqual([{ language: "english", translate: false }]);
    expect(unknown.deps.save).toHaveBeenCalledWith("a", HELLO, SPEECH_MODEL);
  });
});
