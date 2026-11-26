import { DEFAULT_TRANSFORM, VOLUME_MAX, type Clip, type Keyframe, type MediaClip, type OpInput, type TimelineDoc, type Track } from "@/lib/timeline";
import { isKeyframed } from "@/lib/timeline/keyframes";
import { placeClips } from "./placement";

// Pure builders for the commands that change how clips sound. Each returns ops and never touches the store; an empty
// list means the command has nothing to do.

export const VOLUME_STEP = 0.1; // one press of the louder or quieter key: ten percent of as recorded

type Sounding = { track: Track; clip: MediaClip };

// A clip with sound of its own: a video or an audio clip. An image, a text, a shape and an empty slot have none.
export function hasOwnSound(clip: Clip): clip is MediaClip {
  return clip.type === "video" || clip.type === "audio";
}

// The clips among these ids that sound, in document order, with their tracks.
export function soundClipsOf(doc: TimelineDoc, clipIds: string[]): Sounding[] {
  const wanted = new Set(clipIds);
  return doc.tracks.flatMap((track) => track.clips.flatMap((clip) => (wanted.has(clip.id) && hasOwnSound(clip) ? [{ track, clip }] : [])));
}

const unlocked = (sounding: Sounding[]) => sounding.filter(({ track }) => !track.locked);

// What Clean up voice sets: the steady noise under a voice turned down, the rumble taken out, the gaps between words
// turned down a little, speech lifted where it is understood, and loud and quiet words brought closer together.
export const VOICE_CLEANUP = { lowCut: true, gate: 0.25, bass: 0, mid: 3, treble: 1, compress: 0.5, denoise: 0.4 } as const;
const CLEANUP_OFF = { lowCut: false, gate: 0, bass: 0, mid: 0, treble: 0, compress: 0, denoise: 0 } as const;

// Sets the selected sounding clips' clean-up to the voice settings, or with `off` takes all clean-up off them. Clips
// on a locked track, and clips already there, are left out. count: the clips changed.
export function cleanUpOps(doc: TimelineDoc, clipIds: string[], off = false): { ops: OpInput[]; count: number } {
  const want: Record<string, boolean | number> = off ? CLEANUP_OFF : VOICE_CLEANUP;
  const ops: OpInput[] = [];
  for (const { clip } of unlocked(soundClipsOf(doc, clipIds))) {
    const now: Record<string, boolean | number | undefined> = clip.sound ?? {};
    if (Object.keys(want).every((key) => (now[key] ?? CLEANUP_OFF[key as keyof typeof CLEANUP_OFF]) === want[key])) continue;
    ops.push({ op: "update_clip", clipId: clip.id, patch: { sound: { ...want } } });
  }
  return { ops, count: ops.length };
}

// One step louder (1) or quieter (-1) for every selected clip that sounds, on tenths of as recorded, from silent to
// VOLUME_MAX. Clips on a locked track are left out.
export function volumeStepOps(doc: TimelineDoc, clipIds: string[], direction: 1 | -1): OpInput[] {
  return unlocked(soundClipsOf(doc, clipIds)).flatMap(({ clip }): OpInput[] => {
    const steps = Math.round(clip.volume / VOLUME_STEP) + direction;
    const volume = Math.min(VOLUME_MAX, Math.max(0, Math.round(steps * VOLUME_STEP * 100) / 100));
    return volume === clip.volume ? [] : [{ op: "update_clip", clipId: clip.id, patch: { volume } }];
  });
}

// Silences the selected clips that sound; when every one of them is already silent, puts them back to as recorded.
export function muteOps(doc: TimelineDoc, clipIds: string[]): OpInput[] {
  const clips = unlocked(soundClipsOf(doc, clipIds)).map(({ clip }) => clip);
  const volume = clips.some((clip) => clip.volume > 0) ? 0 : 1;
  return clips.flatMap((clip): OpInput[] => (clip.volume === volume ? [] : [{ op: "update_clip", clipId: clip.id, patch: { volume } }]));
}

export type Separated = { ok: true; ops: OpInput[]; clipIds: string[] } | { ok: false; why: "nothing" | "room" };

// Takes the sound off each selected video clip and puts it on an audio clip of its own, at the same time and from the
// same moment of the same file, on an audio track with room (a new one when none has). The video clip goes silent; its
// volume, fades and captions go with the sound. hasSound says whether a file has any; without it every video counts.
// A clip that plays backward or holds one frame has no sound to take.
export function separateAudioOps(doc: TimelineDoc, clipIds: string[], genId: () => string, hasSound: (assetId: string) => boolean = () => true): Separated {
  const videos = unlocked(soundClipsOf(doc, clipIds))
    .map(({ clip }) => clip)
    .filter((clip) => clip.type === "video" && clip.volume > 0 && clip.speed > 0 && hasSound(clip.assetId));
  if (videos.length === 0) return { ok: false, why: "nothing" };
  const sounds = videos.map((video): MediaClip => {
    const { fadeIn = 0, fadeOut = 0 } = video;
    return {
      id: "",
      type: "audio",
      assetId: video.assetId,
      start: video.start,
      duration: video.duration,
      in: video.in,
      speed: video.speed,
      volume: video.volume,
      transform: { ...DEFAULT_TRANSFORM },
      ...(fadeIn > 0 && { fadeIn }),
      ...(fadeOut > 0 && { fadeOut }),
      ...(video.captions && { captions: true }),
    };
  });
  const placement = placeClips(doc, sounds.map((clip) => ({ clip, trackId: null })), genId);
  if (!placement.ok) return { ok: false, why: "room" };
  // Each video and its sound stay linked, under the group the video already has or a new one, so moving one moves both.
  const groups = videos.map((video) => video.group ?? genId());
  for (const op of placement.ops) {
    const at = op.op === "add_clip" ? placement.clipIds.indexOf(op.clip.id ?? "") : -1;
    if (op.op === "add_clip" && at !== -1) op.clip.group = groups[at];
  }
  const silenced = videos.map((video, i): OpInput => {
    const patch: Record<string, unknown> = { volume: 0 };
    if (video.group !== groups[i]) patch.group = groups[i];
    if ((video.fadeIn ?? 0) > 0) patch.fadeIn = 0;
    if ((video.fadeOut ?? 0) > 0) patch.fadeOut = 0;
    if (video.captions) patch.captions = false;
    return { op: "update_clip", clipId: video.id, patch };
  });
  return { ok: true, ops: [...placement.ops, ...silenced], clipIds: placement.clipIds };
}

export const DUCK_LEVEL = 0.25; // what is left of a ducked clip's volume: a quarter, about 12 dB down
export const DUCK_RAMP_SECONDS = 0.3; // how long it takes to go down, and to come back
export const DUCK_GAP_SECONDS = 0.6; // a pause in the speech shorter than this is ducked through

type Span = { from: number; to: number }; // timeline frames, the end not included

// Joins spans that touch, overlap or lie no more than `gap` frames apart.
function joined(spans: Span[], gap: number): Span[] {
  const out: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && span.from - last.to <= gap) last.to = Math.max(last.to, span.to);
    else out.push({ ...span });
  }
  return out;
}

// Where a clip is heard speaking, in timeline frames: each word of its file's transcript that it plays, when it has
// one, so the music comes back in the pauses; else the whole clip.
function speechSpans(doc: TimelineDoc, clip: MediaClip): Span[] {
  const whole = { from: clip.start, to: clip.start + clip.duration };
  const words = doc.captions?.transcripts?.[clip.assetId];
  if (!words || words.length === 0) return [whole];
  const spans: Span[] = [];
  for (const word of words) {
    const from = clip.start + ((word.s * doc.fps) / 1000 - clip.in) / clip.speed;
    const to = clip.start + ((word.e * doc.fps) / 1000 - clip.in) / clip.speed;
    if (to <= whole.from || from >= whole.to) continue;
    spans.push({ from: Math.max(whole.from, Math.floor(from)), to: Math.min(whole.to, Math.ceil(to)) });
  }
  return spans;
}

export type Ducked = { ok: true; ops: OpInput[]; clips: number } | { ok: false; why: "nothing" | "silent" };

// Turns each selected clip down while other clips are heard over it, and back up after: volume keyframes that fall to
// DUCK_LEVEL of its volume over DUCK_RAMP_SECONDS before the other sound starts and rise again after it ends. The
// other sound is every clip that sounds and is not selected; where a file has captions, only its words count. A clip
// already keyed gets a fresh set. Not ok with no selected clip that sounds on an unlocked track ("nothing"), or when
// nothing else is heard over any of them ("silent").
export function duckOps(doc: TimelineDoc, clipIds: string[]): Ducked {
  const music = unlocked(soundClipsOf(doc, clipIds)).map(({ clip }) => clip).filter((clip) => clip.speed > 0);
  if (music.length === 0) return { ok: false, why: "nothing" };
  const chosen = new Set(clipIds);
  const gap = Math.round(DUCK_GAP_SECONDS * doc.fps);
  const ramp = Math.max(1, Math.round(DUCK_RAMP_SECONDS * doc.fps));
  const heard = doc.tracks.flatMap((track) =>
    track.muted ? [] : track.clips.filter((clip): clip is MediaClip => hasOwnSound(clip) && !chosen.has(clip.id) && clip.speed > 0 && (clip.volume > 0 || isKeyframed(clip, "volume"))),
  );
  const speech = joined(heard.flatMap((clip) => speechSpans(doc, clip)), gap);
  const ops: OpInput[] = [];
  for (const clip of music) {
    const end = clip.start + clip.duration;
    const over = speech.filter((span) => span.to > clip.start && span.from < end);
    if (over.length === 0) continue;
    const base = clip.volume;
    const low = Math.round(base * DUCK_LEVEL * 100) / 100;
    // Frames from the clip's start. Ramps that would cross are met half way, and nothing is keyed outside the clip.
    const keys: Keyframe[] = [];
    const put = (at: number, value: number) => {
      const frame = Math.min(clip.duration - 1, Math.max(0, at));
      const last = keys.at(-1);
      if (last && frame <= last.at) {
        if (frame === last.at) last.value = Math.min(last.value, value);
        return;
      }
      keys.push({ at: frame, value });
    };
    over.forEach((span, i) => {
      const from = span.from - clip.start;
      const to = span.to - clip.start;
      const before = i === 0 ? -Infinity : over[i - 1].to - clip.start;
      const after = i === over.length - 1 ? Infinity : over[i + 1].from - clip.start;
      if (from - ramp > before && from - ramp >= 0) put(from - ramp, base);
      put(from, low);
      put(Math.max(from, to - 1), low);
      if (to - 1 + ramp < after - ramp && to - 1 + ramp <= clip.duration - 1) put(to - 1 + ramp, base);
    });
    ops.push({ op: "update_clip", clipId: clip.id, patch: { keyframes: { volume: keys } } });
  }
  return ops.length === 0 ? { ok: false, why: "silent" } : { ok: true, ops, clips: ops.length };
}
