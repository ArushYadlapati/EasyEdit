import { clipFadeAt, playsInPreview, soundGain } from "@/lib/render/clip-sound";
import { tailAt } from "@/lib/render/compositor";
import { sourceSeconds } from "@/lib/render/source-time";
import type { MediaClip, TimelineDoc, Track } from "@/lib/timeline";

// What the preview's media should be doing at a frame: which clips show and sound, at what moment of their media,
// how fast and how loud. Pure, so the pool that drives the browser's elements only has to follow it.

// volume: the gain the clip should sound at right now, its fades counted in. 1 is as recorded, and it can be more.

export type MediaWant = { clipId: string; assetId: string; type: "video" | "image" | "audio"; seconds: number; rate: number; volume: number };

export const MIN_ELEMENT_RATE = 0.0625; // Edge throws when playbackRate is set outside these two
export const MAX_ELEMENT_RATE = 16;
export const PRELOAD_SECONDS = 2;
export const DRIFT_SECONDS = 0.1; // while playing, an element this far off is moved
export const STILL_SECONDS = 0.02; // while paused

const under = (clip: MediaClip, frame: number) => clip.start <= frame && frame < clip.start + clip.duration;

// What should be showing and sounding at this frame. A clip that cannot play at the browser's rate stands still and
// is moved to each frame instead, silent: backward, paused, or too slow or too fast for the element. Under a
// crossfade the outgoing clip plays on past its out point, silent, listed right before the clip fading in over it.
export function mediaWants(doc: TimelineDoc, frame: number, play: { playing: boolean; rate: number }): MediaWant[] {
  const wants: MediaWant[] = [];
  const want = (track: Track, clip: MediaClip, silent: boolean): MediaWant => {
    const product = play.rate * clip.speed;
    const rate = play.playing && product >= MIN_ELEMENT_RATE && product <= MAX_ELEMENT_RATE ? product : 0;
    return {
      clipId: clip.id,
      assetId: clip.assetId,
      type: clip.type,
      seconds: sourceSeconds(clip, frame, doc.fps),
      rate,
      volume: rate === 0 || silent ? 0 : soundGain(track, clip) * clipFadeAt(clip, frame),
    };
  };
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (!playsInPreview(track, clip) || !under(clip, frame)) continue;
      const tail = tailAt(track, clip, frame);
      if (tail && (tail.type === "video" || tail.type === "image")) wants.push(want(track, tail, true));
      wants.push(want(track, clip, false));
    }
  }
  return wants;
}

// The assets of the clips under the frame or starting within PRELOAD_SECONDS of it, each once, in document order.
export function upcomingAssetIds(doc: TimelineDoc, frame: number): string[] {
  const ahead = frame + PRELOAD_SECONDS * doc.fps;
  const ids = new Set<string>();
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (playsInPreview(track, clip) && clip.start <= ahead && frame < clip.start + clip.duration) ids.add(clip.assetId);
    }
  }
  return [...ids];
}

// Whether an element that is at elementSeconds should be moved to the wanted moment.
export function needsSeek(elementSeconds: number, want: MediaWant): boolean {
  return Math.abs(elementSeconds - want.seconds) > (want.rate > 0 ? DRIFT_SECONDS : STILL_SECONDS);
}
