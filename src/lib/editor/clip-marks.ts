import { fadeFrames } from "@/lib/render/clip-sound";
import { asDrawn } from "@/lib/render/compositor";
import { effectWindows } from "@/lib/render/effects";
import { KEYFRAME_PROPS } from "@/lib/timeline/keyframes";
import type { Clip, Track } from "@/lib/timeline";

// fadeIn, fadeOut: how long the clip's sound fades at each end, as it is heard. volume: its volume when it has sound of
// its own and is not as recorded, else null.
export type ClipMarks = { keyframes: number[]; inFrames: number; outFrames: number; fadeIn: number; fadeOut: number; volume: number | null };

// What the timeline draws on a clip: where its keyframes sit (frames from its start, one mark per frame even when
// several properties are keyed there; keyframes outside the clip are not drawn) and how long its in and out effects run
// as drawn, so a clip the next one crossfades in from shows no out-effect; and for a video or audio clip its sound's
// fades and its volume when that is not as recorded. track: the clip's own track.
export function clipMarks(track: Track, clip: Clip): ClipMarks {
  const frames = new Set<number>();
  for (const prop of KEYFRAME_PROPS) {
    for (const k of clip.keyframes?.[prop] ?? []) if (k.at >= 0 && k.at < clip.duration) frames.add(k.at);
  }
  const { inFrames, outFrames } = effectWindows(asDrawn(track, clip));
  const sounds = clip.type === "video" || clip.type === "audio";
  const fade = sounds ? fadeFrames(clip) : { in: 0, out: 0 };
  return {
    keyframes: [...frames].sort((a, b) => a - b),
    inFrames,
    outFrames,
    fadeIn: fade.in,
    fadeOut: fade.out,
    volume: sounds && clip.volume !== 1 ? clip.volume : null,
  };
}
