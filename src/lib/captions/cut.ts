import { findClip, type EditorStore } from "@/lib/editor/store";
import { transcriptOf, type CaptionWord, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { isCaptioned } from "./cues";

// Cutting a video by its words: the parts of a clip where chosen words are said, a pause runs long or a filler word
// sits are taken out, and what follows on the clip's track closes up. The words themselves are kept with the file, so
// nothing about the captions needs changing: a clip that no longer plays a word no longer shows it.

export const PAUSE_SECONDS = 0.6; // a silence between two words at least this long is a pause worth cutting
export const PAUSE_KEEP_SECONDS = 0.12; // the breath left either side of a cut pause

// Sounds people make while they think. Compared without case or punctuation.
export const FILLERS: ReadonlySet<string> = new Set(["um", "umm", "uhm", "uh", "uhh", "er", "erm", "ah", "hmm", "hm", "mm", "mhm"]);

// A part of one clip, in timeline frames, the end not included.
export type CutRange = { clipId: string; from: number; to: number };

type Found = { clip: MediaClip; words: readonly CaptionWord[] };

const speaks = (clip: { type: string }): clip is MediaClip => clip.type === "video" || clip.type === "audio";

// The clips whose words can cut them: video and audio clips that play forward, have captions on and a transcript, on
// an unlocked track. Among `clipIds` when any of those qualify, else all of them in the project.
export function cuttable(doc: TimelineDoc, clipIds: readonly string[] = []): Found[] {
  const all = doc.tracks.flatMap((track) =>
    track.locked
      ? []
      : track.clips.flatMap((clip): Found[] => {
          if (!speaks(clip) || !isCaptioned(doc, clip) || clip.speed <= 0) return [];
          const words = transcriptOf(doc, clip.assetId);
          return words?.length ? [{ clip, words }] : [];
        }),
  );
  const chosen = all.filter(({ clip }) => clipIds.includes(clip.id));
  return chosen.length > 0 ? chosen : all;
}

// A moment of the clip's file, in milliseconds, as a timeline frame (not rounded).
const frameOf = (clip: MediaClip, ms: number, fps: number) => clip.start + ((ms * fps) / 1000 - clip.in) / clip.speed;

// The frames a word of the clip's file takes on the timeline, kept inside the clip; null when the clip does not play it.
export function wordRange(clip: MediaClip, word: CaptionWord, fps: number): CutRange | null {
  const end = clip.start + clip.duration;
  const from = Math.max(clip.start, Math.floor(frameOf(clip, word.s, fps)));
  const to = Math.min(end, Math.ceil(frameOf(clip, word.e, fps)));
  return to > from ? { clipId: clip.id, from, to } : null;
}

// The parts where the picked words are said. index: the word's place in its file's words.
export function wordRanges(doc: TimelineDoc, picks: readonly { clipId: string; index: number }[]): CutRange[] {
  return picks.flatMap(({ clipId, index }) => {
    const clip = findClip(doc, clipId)?.clip;
    const word = clip && speaks(clip) ? transcriptOf(doc, clip.assetId)?.[index] : undefined;
    const range = clip && speaks(clip) && word ? wordRange(clip, word, doc.fps) : null;
    return range ? [range] : [];
  });
}

const plain = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// The parts where a filler word is said.
export function fillerRanges(doc: TimelineDoc, clipIds: readonly string[] = []): CutRange[] {
  return cuttable(doc, clipIds).flatMap(({ clip, words }) =>
    words.flatMap((word) => {
      const range = FILLERS.has(plain(word.t)) ? wordRange(clip, word, doc.fps) : null;
      return range ? [range] : [];
    }),
  );
}

// The long silences between words a clip plays, each less a breath at either side.
export function pauseRanges(doc: TimelineDoc, clipIds: readonly string[] = []): CutRange[] {
  const { fps } = doc;
  return cuttable(doc, clipIds).flatMap(({ clip, words }) => {
    const end = clip.start + clip.duration;
    const ranges: CutRange[] = [];
    for (let i = 0; i + 1 < words.length; i++) {
      const gapMs = words[i + 1].s - words[i].e;
      if (gapMs < PAUSE_SECONDS * 1000 * clip.speed) continue; // the pause as it is heard at the clip's speed
      const keep = PAUSE_KEEP_SECONDS * fps;
      const from = Math.max(clip.start, Math.ceil(frameOf(clip, words[i].e, fps) + keep));
      const to = Math.min(end, Math.floor(frameOf(clip, words[i + 1].s, fps) - keep));
      if (to > from) ranges.push({ clipId: clip.id, from, to });
    }
    return ranges;
  });
}

export type Cut = { ops: OpInput[]; parts: number; frames: number };

// The ops that take the ranges out. Each clip's ranges are joined where they touch or overlap, then cut from its end
// towards its start, so a cut never moves a place that is still to be cut; every cut closes the gap on the clip's own
// track. A range of a clip that is gone, on a locked track or outside the clip is left out.
export function cutOps(doc: TimelineDoc, ranges: readonly CutRange[], genId: () => string): Cut {
  const byClip = new Map<string, { from: number; to: number }[]>();
  for (const range of ranges) byClip.set(range.clipId, [...(byClip.get(range.clipId) ?? []), { from: range.from, to: range.to }]);
  const clips = [...byClip.keys()]
    .flatMap((clipId) => {
      const found = findClip(doc, clipId);
      return found && !found.track.locked ? [found] : [];
    })
    // Later clips first: a cut only moves what comes after it on its track.
    .sort((a, b) => b.clip.start - a.clip.start);
  const ops: OpInput[] = [];
  let parts = 0;
  let frames = 0;
  for (const { clip } of clips) {
    const end = clip.start + clip.duration;
    const joined: { from: number; to: number }[] = [];
    for (const range of byClip.get(clip.id)!.sort((a, b) => a.from - b.from)) {
      const from = Math.max(clip.start, range.from);
      const to = Math.min(end, range.to);
      if (to <= from) continue;
      const last = joined.at(-1);
      if (last && from <= last.to) last.to = Math.max(last.to, to);
      else joined.push({ from, to });
    }
    for (const { from, to } of joined.reverse()) {
      parts += 1;
      frames += to - from;
      if (from <= clip.start && to >= end) {
        ops.push({ op: "remove_clip", clipId: clip.id, ripple: true });
        continue;
      }
      // The piece to take out gets an id of its own: the clip's, when the piece is its start.
      let piece = clip.id;
      if (to < end) ops.push({ op: "split_clip", clipId: clip.id, at: to, newClipId: genId() });
      if (from > clip.start) {
        piece = genId();
        ops.push({ op: "split_clip", clipId: clip.id, at: from, newClipId: piece });
      }
      ops.push({ op: "remove_clip", clipId: piece, ripple: true });
    }
  }
  return { ops, parts, frames };
}

// "Cut 3 parts, 2.4 s shorter."
export function cutMessage(cut: Cut, fps: number): string {
  return `Cut ${cut.parts === 1 ? "1 part" : `${cut.parts} parts`}, ${(cut.frames / fps).toFixed(1)} s shorter.`;
}

// Makes the cut as one change, and says how much went. Says so instead when there is nothing to cut.
export function runCut(store: EditorStore, ranges: (doc: TimelineDoc) => CutRange[], genId: () => string, nothing: string, label = "cut words"): boolean {
  const state = store.getState();
  if (!state.canEdit || state.gesture !== null) return false;
  const cut = cutOps(state.doc, ranges(state.doc), genId);
  if (cut.ops.length === 0) {
    state.notify("info", nothing);
    return false;
  }
  if (!state.edit(cut.ops, label).ok) return false;
  state.notify("info", cutMessage(cut, state.doc.fps));
  return true;
}
