import type { BrandFonts } from "@/lib/brand/types";
import { nearestWeight } from "@/lib/brand/fonts";
import { addTrackOps } from "@/lib/editor/commands";
import { explainOpError } from "@/lib/editor/messages";
import { findClip, type EditorStore } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import type { MediaFiles } from "@/lib/media/media-files";
import { playbackFileFor } from "@/lib/media/playback";
import type { AssetView } from "@/lib/media/types";
import { nanoid } from "nanoid";
import { DEFAULT_TRANSFORM, captionTrack, defaultCaptionStyle, transcriptOf, type CaptionClip, type CaptionWord, type Clip, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import type { Cue } from "./cues";
import { captionsOver, clipsUnder, docCues, isCaptioned, overlaps, retextCue } from "./cues";

export { isCaptioned };
import { TranscribeError, type Transcriber } from "./speech/client";
import { DEFAULT_SPEECH, speechChoice, speechTag, type SpeechChoice } from "./speech/languages";
import type { TranscribeStage } from "./speech/protocol";

// What the Captions tab does to the project: which clips Auto captions works on, the edits it makes, and the run that
// hears each file and makes them.

const hasSpeech = (clip: Clip): clip is MediaClip => clip.type === "video" || clip.type === "audio";

// The selected video and audio clips; with nothing selected, every video and audio clip in the project. A selected
// caption clip stands for the clips of its file under it. A selection of only other kinds of clip has nothing to
// caption: it never falls back to the whole project.
export function captionTargets(doc: TimelineDoc, selectedClipIds: readonly string[]): MediaClip[] {
  if (selectedClipIds.length === 0) return doc.tracks.flatMap((track) => track.clips.filter(hasSpeech));
  const out = new Map<string, MediaClip>();
  for (const id of selectedClipIds) {
    const clip = findClip(doc, id)?.clip;
    if (!clip) continue;
    if (hasSpeech(clip)) out.set(clip.id, clip);
    else if (clip.type === "caption") for (const under of clipsUnder(doc, clip)) out.set(under.id, under);
  }
  return [...out.values()];
}

const sameWords = (a: readonly CaptionWord[] | undefined, b: readonly CaptionWord[]) =>
  !!a && a.length === b.length && a.every((x, i) => x.t === b[i].t && x.s === b[i].s && x.e === b[i].e);

// The files whose words the project keeps though no clip uses them any more. A clip of the file keeps its words
// whether its captions are on or off, so turning them off and on again keeps a person's fixes.
export function unusedTranscripts(doc: TimelineDoc): string[] {
  const used = new Set(doc.tracks.flatMap((track) => track.clips.flatMap((clip) => ("assetId" in clip ? [clip.assetId] : []))));
  return Object.keys(doc.captions?.transcripts ?? {}).filter((assetId) => !used.has(assetId));
}

// Everything one file's captions need, and only what is missing: the Captions track; the style, in the kit's title
// font, when none is stored (so captions look like the brand from the start); the file's words; and for each clip a
// caption clip as long as it, linked with it so the two move together. A clip that already has a caption clip of its
// file over it keeps what it has (a person may have split it, or deleted a part), and a caption clip only fills the
// Captions track where it is free. Clips of the file with their captions switched on the old way get caption clips
// too, and the switch goes off. Words differing from the file's are written over them. The same edit drops the words of
// files no clip uses, before the new ones, so a project does not keep growing and the drop is undone with the rest.
export function captionOps(doc: TimelineDoc, input: { assetId: string; words: CaptionWord[]; clipIds: string[]; fonts: BrandFonts; genId?: () => string }): OpInput[] {
  const { assetId, words, clipIds, fonts, genId = () => nanoid(10) } = input;
  const ops: OpInput[] = [];
  const track = captionTrack(doc);
  const trackId = track?.id ?? genId();
  if (!track) ops.push(...addTrackOps(doc, "caption").map((op) => (op.op === "add_track" ? { ...op, track: { ...op.track, id: trackId } } : op)));
  if (!doc.captions?.style) {
    const font = fonts.title;
    ops.push({ op: "set_caption_style", patch: { ...defaultCaptionStyle(doc), fontFamily: font, fontWeight: nearestWeight(font, 700) } });
  }
  const before = transcriptOf(doc, assetId);
  const changes: OpInput[] = [];
  if (!sameWords(before, words)) changes.push({ op: "set_transcript", assetId, words, expect: { words: before?.length ?? null } });

  const taken = (track?.clips ?? []).map((clip) => ({ start: clip.start, duration: clip.duration, assetId: clip.type === "caption" ? clip.assetId : null }));
  const flagged = doc.tracks.flatMap((t) => t.clips.filter((clip) => hasSpeech(clip) && clip.assetId === assetId && clip.captions)).map((clip) => clip.id);
  for (const clipId of [...new Set([...clipIds, ...flagged])]) {
    const clip = findClip(doc, clipId)?.clip;
    if (!clip || !hasSpeech(clip)) continue;
    const patch: { group?: string; captions?: boolean } = {};
    if (clip.captions) patch.captions = false;
    if (!taken.some((t) => t.assetId === clip.assetId && overlaps(t, clip))) {
      const gaps = freeSpans(clip.start, clip.start + clip.duration, taken);
      if (gaps.length > 0) {
        const group = clip.group ?? genId();
        if (!clip.group) patch.group = group;
        for (const gap of gaps) {
          changes.push({ op: "add_clip", trackId, clip: { type: "caption", assetId: clip.assetId, start: gap.start, duration: gap.duration, transform: { ...DEFAULT_TRANSFORM }, group } });
          taken.push({ ...gap, assetId: clip.assetId });
        }
      }
    }
    if (Object.keys(patch).length > 0) changes.push({ op: "update_clip", clipId, patch });
  }
  if (ops.length === 0 && changes.length === 0) return [];
  for (const unused of unusedTranscripts(doc)) {
    if (unused !== assetId) ops.push({ op: "set_transcript", assetId: unused, words: null, expect: { words: transcriptOf(doc, unused)!.length } });
  }
  return [...ops, ...changes];
}

// Projects from before caption clips switched captions on with a flag on each clip. This edit gives each such clip
// its caption clip (as Auto captions would, linked with it, only where the Captions track is free) and switches the
// flag off. The ids are made from the clip's, so two people opening the project at once make the same edit and the
// second is refused rather than doubling the captions. Nothing without a Captions track to put them on, or when it is
// locked; nothing for a flag on a clip whose file has no words (it shows nothing either way).
export function upgradeCaptionOps(doc: TimelineDoc): OpInput[] {
  const track = captionTrack(doc);
  if (!track || track.locked) return [];
  const taken = track.clips.map((clip) => ({ start: clip.start, duration: clip.duration, assetId: clip.type === "caption" ? clip.assetId : null }));
  const ops: OpInput[] = [];
  for (const t of doc.tracks) {
    if (t.locked) continue;
    for (const clip of t.clips) {
      if (!hasSpeech(clip) || !clip.captions || !transcriptOf(doc, clip.assetId)?.length) continue;
      const patch: { group?: string; captions: boolean } = { captions: false };
      if (!taken.some((x) => x.assetId === clip.assetId && overlaps(x, clip))) {
        const gaps = freeSpans(clip.start, clip.start + clip.duration, taken);
        const group = clip.group ?? `cap-${clip.id}`.slice(0, 40);
        if (gaps.length > 0 && !clip.group) patch.group = group;
        gaps.forEach((gap, i) => {
          const id = `cap-${clip.id}${i === 0 ? "" : `-${i}`}`;
          ops.push({ op: "add_clip", trackId: track.id, clip: { id, type: "caption", assetId: clip.assetId, start: gap.start, duration: gap.duration, transform: { ...DEFAULT_TRANSFORM }, group } });
          taken.push({ ...gap, assetId: clip.assetId });
        });
      }
      ops.push({ op: "update_clip", clipId: clip.id, patch });
    }
  }
  return ops;
}

// Split into lines: each caption clip becomes one caption clip per line it shows, cut where each next line starts, so
// a line can be moved, trimmed or deleted on its own. The pieces keep the clip's group. "one": a clip with one line or
// none has nothing to split; "room": the Captions track, or one request, would hold too many clips; "locked": the
// Captions track is locked.
export function splitIntoLinesOps(doc: TimelineDoc, clipIds: readonly string[], genId: () => string = () => nanoid(10)): { ok: true; ops: OpInput[] } | { ok: false; why: "one" | "room" | "locked" } {
  const track = captionTrack(doc);
  const picked = new Set(clipIds);
  const captions = (track?.clips ?? []).filter((clip): clip is CaptionClip => clip.type === "caption" && picked.has(clip.id));
  if (!track || captions.length === 0) return { ok: false, why: "one" };
  if (track.locked) return { ok: false, why: "locked" };
  const cues = docCues(doc);
  const ops: OpInput[] = [];
  for (const caption of captions) {
    const starts = [...new Set(cues.filter((cue) => cue.captionId === caption.id).map((cue) => cue.start))]
      .sort((a, b) => a - b)
      .filter((at) => at > caption.start && at < caption.start + caption.duration);
    let piece = caption.id;
    for (const at of starts) {
      const next = genId();
      ops.push({ op: "split_clip", clipId: piece, at, newClipId: next });
      piece = next;
    }
  }
  if (ops.length === 0) return { ok: false, why: "one" };
  if (ops.length > LIMITS.opsPerRequest || track.clips.length + ops.length > LIMITS.clipsPerTrack) return { ok: false, why: "room" };
  return { ok: true, ops };
}

// Split into lines on the selected caption clips, as one edit; says why when there is nothing to split.
export function splitIntoLines(store: EditorStore): void {
  const state = store.getState();
  if (!state.canEdit) return;
  const result = splitIntoLinesOps(state.doc, state.selection.clipIds);
  if (!result.ok) {
    state.notify(result.why === "one" ? "info" : "error", result.why === "one" ? "These captions have only one line." : result.why === "locked" ? explainOpError("TRACK_LOCKED") : "That would make too many caption clips. Split a shorter piece.");
    return;
  }
  state.edit(result.ops, "split captions into lines");
}

// The parts of [from, to) no span covers, in order.
function freeSpans(from: number, to: number, spans: readonly { start: number; duration: number }[]): { start: number; duration: number }[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: { start: number; duration: number }[] = [];
  let at = from;
  for (const span of sorted) {
    const end = span.start + span.duration;
    if (end <= at || span.start >= to) continue;
    if (span.start > at) out.push({ start: at, duration: span.start - at });
    at = Math.max(at, end);
    if (at >= to) break;
  }
  if (at < to) out.push({ start: at, duration: to - at });
  return out;
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

// Turns captions off for the listed clips that have them: the caption clips of their file over them go, and so does
// their own switch. A listed caption clip goes itself. The words stay, so turning them on again needs no wait.
export function captionsOffOps(doc: TimelineDoc, clipIds: readonly string[]): OpInput[] {
  const removed = new Set<string>();
  const ops: OpInput[] = [];
  const remove = (caption: CaptionClip) => {
    if (removed.has(caption.id)) return;
    removed.add(caption.id);
    ops.push({ op: "remove_clip", clipId: caption.id });
  };
  for (const clipId of clipIds) {
    const clip = findClip(doc, clipId)?.clip;
    if (!clip) continue;
    if (clip.type === "caption") remove(clip);
    if (!hasSpeech(clip)) continue;
    captionsOver(doc, clip).forEach(remove);
    if (clip.captions) ops.push({ op: "update_clip", clipId, patch: { captions: false } });
  }
  return ops;
}

// What a run needs from the page; tests pass fakes. The real ones are made in captions-context.tsx.
// tag: what the saved words are marked with (speechTag: the model and the language they were heard as).
export type AutoCaptionDeps = {
  transcriber: Transcriber;
  fetchSaved(assetId: string, tag: string): Promise<CaptionWord[] | null>;
  save(assetId: string, words: CaptionWord[], tag: string): Promise<boolean>;
  files: MediaFiles;
  assets(): Record<string, AssetView>;
  ensure(ids: string[]): Promise<string[]>;
  fonts(): BrandFonts;
};

// file counts from 1. "checking": asking the server for words saved before; "saved": using the ones it had.
export type AutoCaptionProgress = { file: number; files: number; name: string; stage: "checking" | "saved" | TranscribeStage; done: number; total: number };
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
  full: `this project already has captions for ${LIMITS.captionFilesPerProject} files.`,
  unknown: "something went wrong. Try again.",
} as const;

// What hearing one file came to.
type Heard = { words: CaptionWord[] } | { silent: true } | { why: string } | { cancelled: true };

class Cancelled extends Error {}

// Reads one file and hears it. A video's preview copy is a re-encode that can lose or garble the sound, so when it
// has none it can read, the original is heard once instead.
async function hear(asset: AssetView, deps: AutoCaptionDeps, speech: SpeechChoice, signal: AbortSignal | undefined, report: (stage: TranscribeStage, done: number, total: number) => void): Promise<Heard> {
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
      const words = await deps.transcriber.transcribe(got.blob, { signal, onProgress: (p) => report(p.stage, p.done, p.total), ...speech });
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

// Auto captions: each file of the target clips in turn, then one edit (one undo step) per file against the project as it
// is by then, on the target clips still in it. A file's words are the project's own when it has some (they may hold a
// person's fixes), else the saved ones, else heard here; "Transcribe again" (redo) always hears it. A cancel stops
// before the next step and keeps what is done. A file with nothing to caption changes nothing. A locked Captions track
// stops it before it starts. speech: the language spoken and whether to write it in English; only words saved as
// that are used, and the words heard are saved as that. Never throws.
export async function runAutoCaptions(
  store: EditorStore,
  deps: AutoCaptionDeps,
  opts: { redo?: boolean; signal?: AbortSignal; onProgress?: (p: AutoCaptionProgress) => void; speech?: SpeechChoice } = {},
): Promise<AutoCaptionOutcome> {
  const { redo = false, signal, onProgress } = opts;
  const speech = speechChoice(opts.speech ?? DEFAULT_SPEECH);
  const tag = speechTag(speech);
  const outcome: AutoCaptionOutcome = { captioned: 0, silent: [], failed: [], cancelled: false };
  const begin = store.getState();
  if (captionTrack(begin.doc)?.locked) {
    begin.notify("error", explainOpError("TRACK_LOCKED"));
    return outcome;
  }
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

        const now = store.getState().doc;
        const own = transcriptOf(now, assetId);
        let words: CaptionWord[] | null = !redo && own && own.length > 0 ? own : null;
        // A file new to the project must fit beside the files whose words it keeps (the ones no clip uses go in the
        // same edit), else hearing it would be wasted.
        if (!own) {
          const kept = Object.keys(now.captions?.transcripts ?? {}).length - unusedTranscripts(now).length;
          if (kept + 1 > LIMITS.captionFilesPerProject) {
            outcome.failed.push({ name, why: WHY.full });
            continue;
          }
        }
        if (!words && !redo) {
          report("checking");
          // Saved words that are an empty list are taken as none: a file heard as silent once may be heard again.
          const saved = await deps.fetchSaved(assetId, tag).catch(() => null);
          stopped();
          if (saved && saved.length > 0) {
            words = saved;
            report("saved");
          }
        }
        if (!words) {
          const heard = await hear(asset, deps, speech, signal, report);
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
          // The next project with this file gets its words at once. A failed save costs only that. No words are not
          // saved, so the file can be heard again.
          if (words.length > 0) {
            await deps.save(assetId, words, tag).catch(() => false);
            stopped();
          }
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
