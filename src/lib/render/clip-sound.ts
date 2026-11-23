import type { Clip, MediaClip, TimelineDoc, Track } from "@/lib/timeline";
import { isKeyframed, volumeAt } from "@/lib/timeline/keyframes";

// Which clips the preview plays, which of them sound and how loud. The preview's media plan and the export both
// decide from here, so a file sounds like the editor. Worker-safe.

export const MIN_SOUND_SPEED = 0.0625; // the speeds a clip sounds at, both ends included; these may narrow,
export const MAX_SOUND_SPEED = 16; // never widen past the preview's element rates

// A media clip the preview plays: audio wherever it is, a video or image only on a track that is shown. This also
// decides which pictures show, so a muted track's video is still played (and drawn), silent.
export function playsInPreview(track: Track, clip: Clip): clip is MediaClip {
  if (clip.type === "audio") return true;
  return (clip.type === "video" || clip.type === "image") && !track.hidden;
}

// The clip's gain: its volume, linear, where 1 is as recorded, or the loudest its volume keyframes take it. Nothing
// for an image or text, a clip the preview does not play, or any clip on a muted track. Speed plays no part: the
// preview's rate decides that.
export function soundGain(track: Track, clip: Clip): number {
  if (!playsInPreview(track, clip) || clip.type === "image" || track.muted) return 0;
  const keys = clip.keyframes?.volume;
  return keys && keys.length > 0 ? Math.max(...keys.map((k) => k.value)) : clip.volume;
}

// The clip's gain while the playhead is on `frame`: its volume there, keyframes counted in. 0 where it has no gain.
export function gainAt(track: Track, clip: Clip, frame: number): number {
  return soundGain(track, clip) === 0 ? 0 : volumeAt(clip, frame);
}

// How long the clip's fades really are, in frames: the fade in first, as much of it as the clip is long, then the
// fade out in what is left. So the two never overlap, whatever the clip was trimmed to since they were set.
export function fadeFrames(clip: Pick<MediaClip, "duration" | "fadeIn" | "fadeOut">): { in: number; out: number } {
  const fadeIn = Math.min(clip.fadeIn ?? 0, clip.duration);
  return { in: fadeIn, out: Math.min(clip.fadeOut ?? 0, clip.duration - fadeIn) };
}

// A fade's gain `t` of the way through it, 0 at silence and 1 at full: the square, which the ear takes as an even
// rise where a straight line seems to arrive all at once.
export function fadeCurve(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x;
}

// What the fades leave of a sound `at` units after it starts, when it is `length` long and fades over `fadeIn` at its
// start and `fadeOut` at its end, all in one unit (frames in the preview, samples in the export). 1 where neither reaches.
export function fadeGain(at: number, length: number, fadeIn: number, fadeOut: number): number {
  let gain = 1;
  if (fadeIn > 0 && at < fadeIn) gain = fadeCurve(at / fadeIn);
  if (fadeOut > 0 && at > length - fadeOut) gain *= fadeCurve((length - at) / fadeOut);
  return gain;
}

// The fades' share of a clip's gain while the playhead is on `frame`, read at the middle of the frame so the first
// frame of a fade in is already heard.
export function clipFadeAt(clip: MediaClip, frame: number): number {
  const fade = fadeFrames(clip);
  if (fade.in === 0 && fade.out === 0) return 1;
  return fadeGain(frame - clip.start + 0.5, clip.duration, fade.in, fade.out);
}

// What the export hears: nothing where the clip's gain is 0 or its speed is outside the speeds that sound. A clip
// whose volume is keyframed has a gain of 1 here, and its keyframes shape it sample by sample.
export function clipSound(track: Track, clip: Clip): { gain: number } | null {
  const gain = soundGain(track, clip);
  if (gain === 0) return null;
  const { speed } = clip as MediaClip; // a clip with a gain is a media clip
  if (speed < MIN_SOUND_SPEED || speed > MAX_SOUND_SPEED) return null;
  return { gain: isKeyframed(clip, "volume") ? 1 : gain };
}

export type SoundingClip = { track: Track; clip: MediaClip; gain: number };

// Every clip the export hears, tracks in order, each track's clips in order.
export function soundingClips(doc: TimelineDoc): SoundingClip[] {
  const sounding: SoundingClip[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      const sound = clipSound(track, clip);
      if (sound) sounding.push({ track, clip: clip as MediaClip, gain: sound.gain });
    }
  }
  return sounding;
}
