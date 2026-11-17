import { asDrawn } from "@/lib/render/compositor";
import { effectWindows } from "@/lib/render/effects";
import { KEYFRAME_PROPS } from "@/lib/timeline/keyframes";
import type { Clip, Track } from "@/lib/timeline";

export type ClipMarks = { keyframes: number[]; inFrames: number; outFrames: number };

// What the timeline draws on a clip: where its keyframes sit (frames from its start, one mark per frame even when
// several properties are keyed there; keyframes outside the clip are not drawn) and how long its in and out effects run
// as drawn, so a clip the next one crossfades in from shows no out-effect. track: the clip's own track.
export function clipMarks(track: Track, clip: Clip): ClipMarks {
  const frames = new Set<number>();
  for (const prop of KEYFRAME_PROPS) {
    for (const k of clip.keyframes?.[prop] ?? []) if (k.at >= 0 && k.at < clip.duration) frames.add(k.at);
  }
  const { inFrames, outFrames } = effectWindows(asDrawn(track, clip));
  return { keyframes: [...frames].sort((a, b) => a - b), inFrames, outFrames };
}
