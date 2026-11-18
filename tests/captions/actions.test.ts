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
import { TranscribeError, type TranscribeProgress, type Transcriber } from "@/lib/captions/speech/client";
import type { BrandFonts } from "@/lib/brand/types";
import { findClip } from "@/lib/editor/store";
import type { MediaFiles } from "@/lib/media/media-files";
import type { AssetView } from "@/lib/media/types";
import { DEFAULT_TRANSFORM, applyOps, createEmptyDoc, defaultCaptionStyle, prepareOps, type CaptionWord, type Clip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, text, video } from "../editor/fixtures";
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

  it("adds only what is missing", () => {
    const once = apply(plainDoc(), captionOps(plainDoc(), { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS }));
    expect(captionOps(once, { assetId: "a", words: HELLO, clipIds: ["c1"], fonts: FONTS })).toEqual([]);
    const more = [...HELLO, w("again", 1000, 1300)];
    expect(captionOps(once, { assetId: "a", words: more, clipIds: ["c1", "c2"], fonts: FONTS })).toEqual([
      { op: "set_transcript", assetId: "a", words: more, expect: { words: 2 } },
      { op: "update_clip", clipId: "c2", patch: { captions: true } },
    ]);
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

  it("turns captions off for the listed clips that have them on", () => {
    const doc = captioned();
    expect(captionsOffOps(doc, ["c1", "c2", "x1"])).toEqual([{ op: "update_clip", clipId: "c1", patch: { captions: false } }]);
  });
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
    const outcome = await runAutoCaptions(store, deps, {});
    expect(outcome).toEqual({ captioned: 1, silent: [], failed: [], cancelled: false });
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
    expect(deps.save).toHaveBeenCalledWith("a", HELLO);
    // "sound" first while the file itself is read, before the transcriber reports anything.
    expect(progress.map((p) => p.stage)).toEqual(["saved", "sound", "model", "sound", "speech"]);
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
    expect(deps.save).toHaveBeenCalledWith("a", fresh);
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
