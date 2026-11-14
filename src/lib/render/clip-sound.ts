import type { Clip, MediaClip, TimelineDoc, Track } from "@/lib/timeline";

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

// The preview's gain: the clip's volume, linear, never above 1. Nothing for an image or text, a clip the preview
// does not play, or any clip on a muted track. Speed plays no part: the preview's rate decides that.
export function soundGain(track: Track, clip: Clip): number {
  if (!playsInPreview(track, clip) || clip.type === "image" || track.muted) return 0;
  return Math.min(clip.volume, 1);
}

// What the export hears: nothing where the preview's gain is 0 or the clip's speed is outside the speeds that sound.
export function clipSound(track: Track, clip: Clip): { gain: number } | null {
  const gain = soundGain(track, clip);
  if (gain === 0) return null;
  const { speed } = clip as MediaClip; // a clip with a gain is a media clip
  return speed >= MIN_SOUND_SPEED && speed <= MAX_SOUND_SPEED ? { gain } : null;
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
