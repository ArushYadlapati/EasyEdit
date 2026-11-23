import type { MediaClip } from "./types";

// A video clip's speed is signed. Above 0 it plays forward at that rate. Below 0 it plays backward, and `in` is then
// the frame of its file it shows first, the latest one it uses. At 0 it holds the one frame at `in` for its whole
// length (a freeze frame). Audio and image clips only run forward. A clip that plays backward or holds has no sound.

type Timed = Pick<MediaClip, "in" | "duration" | "speed">;

export function isHeld(clip: Pick<MediaClip, "speed">): boolean {
  return clip.speed === 0;
}

export function isReversed(clip: Pick<MediaClip, "speed">): boolean {
  return clip.speed < 0;
}

// The frames of its file a clip uses: `from` is the earliest, `to` the one after the latest.
export function sourceRange(clip: Timed): { from: number; to: number } {
  if (clip.speed === 0) return { from: clip.in, to: clip.in + 1 };
  const end = clip.in + Math.round(clip.duration * clip.speed);
  return clip.speed > 0 ? { from: clip.in, to: end } : { from: end + 1, to: clip.in + 1 };
}

// Whether a clip stays inside a file that is `frames` long. No frame over is allowed at any speed.
export function fitsMedia(clip: Timed, frames: number): boolean {
  const { from, to } = sourceRange(clip);
  return from >= 0 && to <= frames;
}

// The same frames played the other way round: the `in` and speed to give the clip. Null for a clip that holds one
// frame, which has no way round.
export function reversedTiming(clip: Timed): { in: number; speed: number } | null {
  if (clip.speed === 0) return null;
  const { from, to } = sourceRange(clip);
  return { in: Math.max(0, clip.speed > 0 ? Math.max(from, to - 1) : from), speed: -clip.speed };
}
