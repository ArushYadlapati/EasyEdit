import { captionStyleOf, captionTrack, rewordRun, transcriptOf } from "@/lib/timeline/captions";
import type { CaptionClip, CaptionPreset, CaptionWord, Clip, MediaClip, TimelineDoc } from "@/lib/timeline/types";

// A spoken word placed on the timeline. index is its place in the file's word list; start and end are timeline frames.
export type CueWord = { index: number; text: string; start: number; end: number };
// One caption line: [start, end) in timeline frames, from one clip. captionId: the caption clip it shows in; null for a
// line of a clip whose captions were switched on the old way (its own captions flag, before caption clips).
export type Cue = { clipId: string; assetId: string; start: number; end: number; words: CueWord[]; text: string; captionId: string | null };

// Which line a cue is, kept while its words are retyped: its clip, its caption clip, and where its words start in the
// file's list (a retype replaces the words from there, so that place stays).
export type CueKey = { clipId: string; captionId: string | null; index: number };
export const cueKey = (cue: Cue): CueKey => ({ clipId: cue.clipId, captionId: cue.captionId, index: cue.words[0].index });
// The key as text, for a lookup or a React key.
export const cueKeyText = (key: CueKey): string => `${key.clipId}:${key.index}`;
export const sameCue = (cue: Cue, key: CueKey): boolean => cue.clipId === key.clipId && cue.captionId === key.captionId && cue.words[0]?.index === key.index;

// The line a key names in the project as it is now, if it is still there.
export function findCue(doc: TimelineDoc, key: CueKey): Cue | null {
  return docCues(doc).find((cue) => sameCue(cue, key)) ?? null;
}

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
  // A clip that plays backward or holds one frame has no sound, so nothing is said in it.
  if (clip.speed <= 0) return [];
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
    cues.push({ clipId: clip.id, assetId: clip.assetId, start, end, words: cueWords, text: cueWords.map((x) => x.text).join(" "), captionId: null });
  });
  return cues;
}

// Every line in the project. A caption clip on the Captions track shows the lines of its file's video and audio clips
// (on any track) that fall inside it: the words that start inside it, the line ending where it ends. Two caption clips
// of one file never show a word twice. A clip with its own captions flag on (how captions were switched on before
// caption clips) shows all its lines, unless a caption clip of its file lies over it. Hidden and muted tracks still count: the
// caption track decides what shows, not the track the sound is on. Earliest first; lines that start together keep
// the order of their tracks.
export function docCues(doc: TimelineDoc): Cue[] {
  const preset = captionStyleOf(doc).preset;
  const media: MediaClip[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) if ((clip.type === "video" || clip.type === "audio") && transcriptOf(doc, clip.assetId)?.length) media.push(clip);
  }
  const lines = (clip: MediaClip) => clipCues(clip, transcriptOf(doc, clip.assetId)!, doc.fps, preset);
  const captions = captionClipsOf(doc);

  const all: Cue[] = [];
  for (const clip of media) if (clip.captions && !captions.some((c) => c.assetId === clip.assetId && overlaps(c, clip))) all.push(...lines(clip));
  // The words caption clips show already, each as its place in the file and the frame it lands on: a video and the
  // sound taken from it (Separate audio) play the same words at the same frames, and show them once.
  const shown = new Set<string>();
  for (const caption of captions) {
    const from = caption.start;
    const to = caption.start + caption.duration;
    for (const clip of media) {
      if (clip.assetId !== caption.assetId || clip.start >= to || clip.start + clip.duration <= from) continue;
      for (const cue of lines(clip)) {
        if (cue.end <= from || cue.start >= to) continue;
        const key = (word: CueWord) => `${clip.assetId}:${word.index}@${word.start}`;
        const words = cue.words.filter((word) => word.start >= from && word.start < to && !shown.has(key(word)));
        if (words.length === 0) continue;
        for (const word of words) shown.add(key(word));
        const whole = words.length === cue.words.length;
        const start = words[0].start;
        const end = Math.min(cue.end, to);
        if (end <= start) continue;
        all.push({ ...cue, start, end, words: whole ? cue.words : words.map((word) => ({ ...word, end: Math.min(word.end, end) })), text: whole ? cue.text : words.map((x) => x.text).join(" "), captionId: caption.id });
      }
    }
  }
  return all.map((cue, i) => ({ cue, i })).sort((a, b) => a.cue.start - b.cue.start || a.i - b.i).map((x) => x.cue);
}

export const overlaps = (a: { start: number; duration: number }, b: { start: number; duration: number }) => a.start < b.start + b.duration && b.start < a.start + a.duration;

// The video and audio clips of a caption clip's file that play while it lasts.
export function clipsUnder(doc: TimelineDoc, caption: CaptionClip): MediaClip[] {
  return doc.tracks.flatMap((track) => track.clips.filter((clip): clip is MediaClip => (clip.type === "video" || clip.type === "audio") && clip.assetId === caption.assetId && overlaps(clip, caption)));
}

// The caption clips of a clip's file that show while the clip plays.
export function captionsOver(doc: TimelineDoc, clip: MediaClip): CaptionClip[] {
  return captionClipsOf(doc).filter((caption) => caption.assetId === clip.assetId && overlaps(caption, clip));
}

// Whether a video or audio clip shows captions: a caption clip of its file over it, or its own captions switch (how
// captions were switched on before caption clips).
export function isCaptioned(doc: TimelineDoc, clip: Clip): boolean {
  return (clip.type === "video" || clip.type === "audio") && (!!clip.captions || captionsOver(doc, clip).length > 0);
}

// The caption clips on the Captions track, in time order.
export function captionClipsOf(doc: TimelineDoc): CaptionClip[] {
  return (captionTrack(doc)?.clips ?? []).filter((clip): clip is CaptionClip => clip.type === "caption");
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
