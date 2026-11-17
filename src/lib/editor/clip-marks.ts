import { effectWindows } from "@/lib/render/effects";
import { KEYFRAME_PROPS } from "@/lib/timeline/keyframes";
import type { Clip } from "@/lib/timeline";

export type ClipMarks = { keyframes: number[]; inFrames: number; outFrames: number };

// What the timeline draws on a clip: where its keyframes sit (frames from its start, one mark per frame even when
// several properties are keyed there; keyframes outside the clip are not drawn) and how long its in and out effects run.
export function clipMarks(clip: Clip): ClipMarks {
  const frames = new Set<number>();
  for (const prop of KEYFRAME_PROPS) {
    for (const k of clip.keyframes?.[prop] ?? []) if (k.at >= 0 && k.at < clip.duration) frames.add(k.at);
  }
  const { inFrames, outFrames } = effectWindows(clip);
  return { keyframes: [...frames].sort((a, b) => a - b), inFrames, outFrames };
}
