import { captionStyleOf, captionTrack, rewordRun, transcriptOf } from "@/lib/timeline/captions";
import type { CaptionPreset, CaptionWord, MediaClip, TimelineDoc } from "@/lib/timeline/types";

// A spoken word placed on the timeline. index is its place in the file's word list; start and end are timeline frames.
export type CueWord = { index: number; text: string; start: number; end: number };
// One caption line: [start, end) in timeline frames, from one clip.
export type Cue = { clipId: string; assetId: string; start: number; end: number; words: CueWord[]; text: string };

// A pause longer than pauseMs starts a new line; a line stays up holdMs after its last word; a line holds at most
// maxChars characters (the "word" preset shows one word, so it has no limit).
export const CUE_RULES = { pauseMs: 600, holdMs: 400, maxChars: { block: 28, karaoke: 28, bar: 42 } } as const;

// A sentence ends in . ? or !, perhaps followed by a closing quote or bracket.
const SENTENCE_END = /[.?!]["'’”)\]}]*$/;

const cache = new WeakMap<readonly CaptionWord[], Map<string, Cue[]>>();

// The caption lines one clip shows for its file's words. The words are in the file's own milliseconds; this is the
// inverse of the picture's mapping (render/source-time.ts), so a word shows on the frame where it is heard.
// Results are kept per words array and clip timing, because the compositor asks on every frame.
export function clipCues(clip: MediaClip, words: readonly CaptionWord[], fps: number, preset: CaptionPreset): Cue[] {
  const key = [clip.id, clip.assetId, clip.start, clip.duration, clip.in, clip.speed, fps, preset].join("|");
  let perWords = cache.get(words);
  if (!perWords) cache.set(words, (perWords = new Map()));
  const kept = perWords.get(key);
  if (kept) return kept;
  const made = build(clip, words, fps, preset);
  perWords.set(key, made);
  return made;
}

function build(clip: MediaClip, words: readonly CaptionWord[], fps: number, preset: CaptionPreset): Cue[] {
  const clipEnd = clip.start + clip.duration;
  const outFrame = clip.in + clip.duration * clip.speed; // file frame where the clip stops
  const maxChars = preset === "word" ? 0 : CUE_RULES.maxChars[preset];
  const holdFrames = Math.ceil((CUE_RULES.holdMs * fps) / 1000);

  // Group the words this clip plays into lines.
  const groups: { index: number; word: CaptionWord }[][] = [];
  let prev: CaptionWord | null = null;
  words.forEach((word, index) => {
    const from = (word.s * fps) / 1000;
    const to = (word.e * fps) / 1000;
    const middle = (from + to) / 2;
    if (middle < clip.in || middle >= outFrame) return;
    const current = groups.at(-1);
    let breakBefore = !current || preset === "word";
    if (!breakBefore && prev) {
      breakBefore =
        word.s - prev.e > CUE_RULES.pauseMs ||
        SENTENCE_END.test(prev.t) ||
        [...current!.map((g) => g.word.t), word.t].join(" ").length > maxChars;
    }
    if (breakBefore) groups.push([{ index, word }]);
    else current!.push({ index, word });
    prev = word;
  });

  const placed = groups.map((group) => {
    const cueWords: CueWord[] = group.map(({ index, word }) => {
      const from = clip.start + ((word.s * fps) / 1000 - clip.in) / clip.speed;
      const to = clip.start + ((word.e * fps) / 1000 - clip.in) / clip.speed;
      const start = Math.min(Math.max(Math.floor(from), clip.start), clipEnd - 1);
      const end = Math.min(Math.max(Math.ceil(to), start + 1), clipEnd);
      return { index, text: word.t, start, end };
    });
    return cueWords;
  });

  // A line ends at the earliest of: its hold, the next line, the clip's end. A line with no length (two lines that
  // start on one frame at a high speed) could never be seen, so it is left out rather than overlap its neighbour.
  const cues: Cue[] = [];
  placed.forEach((cueWords, i) => {
    const start = cueWords[0].start;
    const next = placed[i + 1]?.[0].start ?? Infinity;
    const end = Math.min(cueWords[cueWords.length - 1].end + holdFrames, next, clipEnd);
    if (end <= start) return;
    cues.push({ clipId: clip.id, assetId: clip.assetId, start, end, words: cueWords, text: cueWords.map((x) => x.text).join(" ") });
  });
  return cues;
}

// Every line in the project, from each video or audio clip with captions on whose file has words. Hidden and muted
// tracks still count: the caption track decides what shows, not the track the sound is on. Earliest first; lines that
// start together keep the order of their tracks.
export function docCues(doc: TimelineDoc): Cue[] {
  const preset = captionStyleOf(doc).preset;
  const all: Cue[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if ((clip.type !== "video" && clip.type !== "audio") || !clip.captions) continue;
      const words = transcriptOf(doc, clip.assetId);
      if (!words?.length) continue;
      all.push(...clipCues(clip, words, doc.fps, preset));
    }
  }
  return all.map((cue, i) => ({ cue, i })).sort((a, b) => a.cue.start - b.cue.start || a.i - b.i).map((x) => x.cue);
}

// The lines on screen at a frame, each with the position of the word being spoken: the last whose start has come.
export function cuesAt(doc: TimelineDoc, frame: number): { cue: Cue; lit: number }[] {
  const out: { cue: Cue; lit: number }[] = [];
  for (const cue of docCues(doc)) {
    if (frame < cue.start || frame >= cue.end) continue;
    let lit = 0;
    cue.words.forEach((word, i) => {
      if (word.start <= frame) lit = i;
    });
    out.push({ cue, lit });
  }
  return out;
}

// Captions are drawn when the project has a Captions track and it is not hidden.
export function captionsShow(doc: TimelineDoc): boolean {
  const track = captionTrack(doc);
  return !!track && !track.hidden;
}

// The edit that turns a line's words into the typed text (see rewordRun). Same words: nothing to do. The result is
// the arguments of a splice_caption_words op.
export function retextCue(
  cue: Cue,
  fileWords: readonly CaptionWord[],
  text: string,
): { index: number; remove: number; insert: CaptionWord[] } | null {
  const index = cue.words[0].index;
  const remove = cue.words.length;
  const old = fileWords.slice(index, index + remove);
  const insert = rewordRun(old, text);
  if (insert.length === old.length && insert.every((word, i) => word.t === old[i].t)) return null;
  return { index, remove, insert };
}
