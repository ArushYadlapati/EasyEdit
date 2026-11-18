import type { BrandFonts } from "@/lib/brand/types";
import { nearestWeight } from "@/lib/brand/fonts";
import { addTrackOps } from "@/lib/editor/commands";
import { findClip, type EditorStore } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import type { MediaFiles } from "@/lib/media/media-files";
import { playbackFileFor } from "@/lib/media/playback";
import type { AssetView } from "@/lib/media/types";
import { defaultCaptionStyle, transcriptOf, type CaptionWord, type Clip, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import type { Cue } from "./cues";
import { retextCue } from "./cues";
import { TranscribeError, type Transcriber } from "./speech/client";
import type { TranscribeStage } from "./speech/protocol";

// What the Captions tab does to the project: which clips Auto captions works on, the edits it makes, and the run that
// hears each file and makes them.

const hasSpeech = (clip: Clip): clip is MediaClip => clip.type === "video" || clip.type === "audio";

// The selected video and audio clips; with nothing selected, every video and audio clip in the project. A selection of
// only other kinds of clip has nothing to caption: it never falls back to the whole project.
export function captionTargets(doc: TimelineDoc, selectedClipIds: readonly string[]): MediaClip[] {
  if (selectedClipIds.length === 0) return doc.tracks.flatMap((track) => track.clips.filter(hasSpeech));
  return selectedClipIds.flatMap((id) => {
    const clip = findClip(doc, id)?.clip;
    return clip && hasSpeech(clip) ? [clip] : [];
  });
}

const sameWords = (a: readonly CaptionWord[] | undefined, b: readonly CaptionWord[]) =>
  !!a && a.length === b.length && a.every((x, i) => x.t === b[i].t && x.s === b[i].s && x.e === b[i].e);

// Everything one file's captions need, and only what is missing: the Captions track; the style, in the kit's title
// font, when none is stored (so captions look like the brand from the start); the file's words; the switch on each clip.
export function captionOps(doc: TimelineDoc, input: { assetId: string; words: CaptionWord[]; clipIds: string[]; fonts: BrandFonts }): OpInput[] {
  const { assetId, words, clipIds, fonts } = input;
  const ops: OpInput[] = [...addTrackOps(doc, "caption")];
  if (!doc.captions?.style) {
    const font = fonts.title;
    ops.push({ op: "set_caption_style", patch: { ...defaultCaptionStyle(doc), fontFamily: font, fontWeight: nearestWeight(font, 700) } });
  }
  const before = transcriptOf(doc, assetId);
  if (!sameWords(before, words)) ops.push({ op: "set_transcript", assetId, words, expect: { words: before?.length ?? null } });
  for (const clipId of clipIds) {
    const clip = findClip(doc, clipId)?.clip;
    if (clip && hasSpeech(clip) && !clip.captions) ops.push({ op: "update_clip", clipId, patch: { captions: true } });
  }
  return ops;
}

// The edit that makes a caption line read as typed. Nothing when the text is the same, or when the line's words have
// changed since it was shown (a teammate's fix came first): the guard would refuse it anyway.
export function retextOps(doc: TimelineDoc, cue: Cue, text: string): OpInput[] {
  const words = transcriptOf(doc, cue.assetId);
  if (!words || cue.words.length === 0) return [];
  const index = cue.words[0].index;
  const now = words.slice(index, index + cue.words.length);
  if (now.length !== cue.words.length || now.some((word, i) => word.t !== cue.words[i].text)) return [];
  const splice = retextCue(cue, words, text);
  if (!splice) return [];
  return [{ op: "splice_caption_words", assetId: cue.assetId, ...splice, expect: { words: now } }];
}

// Turns captions off for the listed clips that have them on. The words stay, so turning them on again needs no wait.
export function captionsOffOps(doc: TimelineDoc, clipIds: readonly string[]): OpInput[] {
  return clipIds.flatMap((clipId): OpInput[] => {
    const clip = findClip(doc, clipId)?.clip;
    return clip && hasSpeech(clip) && clip.captions ? [{ op: "update_clip", clipId, patch: { captions: false } }] : [];
  });
}

// What a run needs from the page; tests pass fakes. The real ones are made in captions-context.tsx.
export type AutoCaptionDeps = {
  transcriber: Transcriber;
  fetchSaved(assetId: string): Promise<CaptionWord[] | null>;
  save(assetId: string, words: CaptionWord[]): Promise<boolean>;
  files: MediaFiles;
  assets(): Record<string, AssetView>;
  ensure(ids: string[]): Promise<string[]>;
  fonts(): BrandFonts;
};

// file counts from 1. "saved": asking the server for words saved before.
export type AutoCaptionProgress = { file: number; files: number; name: string; stage: "saved" | TranscribeStage; done: number; total: number };
// silent: names of files with no speech; failed: why each other file has no captions.
export type AutoCaptionOutcome = { captioned: number; silent: string[]; failed: { name: string; why: string }[]; cancelled: boolean };

// Why a file could not be captioned, finishing "Couldn't caption <name>: ".
const WHY = {
  missing: "it isn't in the media library.",
  removed: "it was removed from the media library.",
  notReady: "it isn't ready yet.",
  tooLong: `it's longer than ${LIMITS.captionAudioMinutes} minutes.`,
  unreadable: "its file couldn't be read.",
  undecodable: "its sound couldn't be read.",
  model: "the speech model couldn't be loaded.",
  unknown: "something went wrong. Try again.",
} as const;

// What hearing one file came to.
type Heard = { words: CaptionWord[] } | { silent: true } | { why: string } | { cancelled: true };

class Cancelled extends Error {}

// Reads one file and hears it. A video's preview copy is a re-encode that can lose or garble the sound, so when it
// has none it can read, the original is heard once instead.
async function hear(asset: AssetView, deps: AutoCaptionDeps, signal: AbortSignal | undefined, report: (stage: TranscribeStage, done: number, total: number) => void): Promise<Heard> {
  const playback = playbackFileFor(asset);
  // A preview copy still being made, or none made: the original has the same sound.
  const first = playback.fileId !== null ? playback : { fileId: asset.originalFileId!, from: "original" as const };
  const tries = [first.fileId];
  if (first.from === "preview" && asset.originalFileId) tries.push(asset.originalFileId);

  for (const [i, fileId] of tries.entries()) {
    // Reading the file can take a while (it may come from Drive): said as reading the sound, which it is the start of.
    report("sound", 0, 0);
    const got = await deps.files.get(fileId);
    if (signal?.aborted) return { cancelled: true };
    if (!got.ok) return { why: WHY.unreadable };
    try {
      const words = await deps.transcriber.transcribe(got.blob, { signal, onProgress: (p) => report(p.stage, p.done, p.total) });
      return { words };
    } catch (error) {
      const code = error instanceof TranscribeError ? error.code : "unknown";
      if (code === "cancelled") return { cancelled: true };
      if ((code === "no-sound" || code === "undecodable") && i + 1 < tries.length) continue;
      if (code === "no-sound") return { silent: true };
      if (code === "undecodable") return { why: WHY.undecodable };
      if (code === "too-long") return { why: WHY.tooLong };
      if (code === "model") return { why: WHY.model };
      return { why: WHY.unknown };
    }
  }
  return { why: WHY.unknown };
}

// Why this asset can't be heard at all, if it can't.
function unusable(asset: AssetView | undefined): string | null {
  if (!asset) return WHY.missing;
  if (asset.removed) return WHY.removed;
  if (asset.status !== "ready" || asset.originalFileId === null) return WHY.notReady;
  if (asset.durationMs !== null && asset.durationMs > LIMITS.captionAudioMinutes * 60_000) return WHY.tooLong;
  return null;
}

// Auto captions: each file of the target clips in turn, its saved words or else heard here, then one edit (one undo
// step) per file against the project as it is by then, on the target clips still in it. A cancel stops before the next
// step and keeps what is done. A file with nothing to caption changes nothing. Never throws.
export async function runAutoCaptions(
  store: EditorStore,
  deps: AutoCaptionDeps,
  opts: { redo?: boolean; signal?: AbortSignal; onProgress?: (p: AutoCaptionProgress) => void } = {},
): Promise<AutoCaptionOutcome> {
  const { redo = false, signal, onProgress } = opts;
  const outcome: AutoCaptionOutcome = { captioned: 0, silent: [], failed: [], cancelled: false };
  const begin = store.getState();
  const targets = captionTargets(begin.doc, begin.selection.clipIds);
  const clipIds = targets.map((clip) => clip.id);
  const assetIds = [...new Set(targets.map((clip) => clip.assetId))];
  const stopped = () => {
    if (signal?.aborted) throw new Cancelled();
  };

  try {
    stopped();
    // Assets the library has not seen yet (a teammate's upload) are fetched first; one it can't answer is "missing".
    await deps.ensure(assetIds).catch(() => []);
    for (const [i, assetId] of assetIds.entries()) {
      stopped();
      let name = "a file";
      try {
        const asset = deps.assets()[assetId];
        name = asset?.name ?? name;
        const why = unusable(asset);
        if (why) {
          outcome.failed.push({ name, why });
          continue;
        }
        if (asset.kind === "image" || (asset.kind === "video" && !asset.hasAudio)) {
          outcome.silent.push(name);
          continue;
        }
        const report = (stage: AutoCaptionProgress["stage"], done = 0, total = 0) => onProgress?.({ file: i + 1, files: assetIds.length, name, stage, done, total });

        let words: CaptionWord[] | null = null;
        if (!redo) {
          report("saved");
          words = await deps.fetchSaved(assetId).catch(() => null);
          stopped();
        }
        if (!words) {
          const heard = await hear(asset, deps, signal, report);
          if ("cancelled" in heard) throw new Cancelled();
          if ("silent" in heard) {
            outcome.silent.push(name);
            continue;
          }
          if ("why" in heard) {
            outcome.failed.push({ name, why: heard.why });
            continue;
          }
          words = heard.words;
          // The next project with this file gets its words at once. A failed save costs only that.
          await deps.save(assetId, words).catch(() => false);
          stopped();
        }
        if (words.length === 0) {
          outcome.silent.push(name);
          continue;
        }

        // The project may have changed while the file was heard: only target clips still there, still of this file.
        const state = store.getState();
        const ids = clipIds.filter((id) => {
          const clip = findClip(state.doc, id)?.clip;
          return !!clip && hasSpeech(clip) && clip.assetId === assetId;
        });
        if (ids.length === 0) continue;
        const ops = captionOps(state.doc, { assetId, words, clipIds: ids, fonts: deps.fonts() });
        const result = ops.length > 0 ? state.edit(ops, "auto captions") : ({ ok: true } as const);
        if (result.ok) outcome.captioned++;
        else outcome.failed.push({ name, why: result.message.charAt(0).toLowerCase() + result.message.slice(1) });
      } catch (error) {
        if (error instanceof Cancelled) throw error;
        outcome.failed.push({ name, why: WHY.unknown });
      }
    }
  } catch (error) {
    // Only a cancel gets here: every other failure is kept against its file above.
    outcome.cancelled = error instanceof Cancelled;
  }
  return outcome;
}
