import type { Clip, KeyframeProp, MediaClip, OpInput, Transform } from "@/lib/timeline";
import { KEYFRAME_PROPS, effectiveTransform, isKeyframed, keyframeAt, removeKeyframe, setKeyframe } from "@/lib/timeline/keyframes";

// Making and changing a clip's keyframes from the editor. Frames given here are timeline frames; a keyframe's `at`
// counts from the clip's start.

// none: the property is not keyframed; elsewhere: it is, but not at this frame; here: a keyframe sits at this frame.
export type KeyState = "none" | "elsewhere" | "here";

const KEN_BURNS_ZOOM = 1.15;

const round4 = (n: number) => Number(n.toFixed(4));

export function keyState(clip: Clip, prop: KeyframeProp, frame: number): KeyState {
  if (!isKeyframed(clip, prop)) return "none";
  return keyframeAt(clip, prop, frame - clip.start) ? "here" : "elsewhere";
}

// The frame inside the clip nearest the playhead, so an edit made while the playhead is off the clip keys a frame
// people can see.
export function clipFrame(clip: Clip, playhead: number): number {
  return Math.min(Math.max(playhead, clip.start), clip.start + clip.duration - 1);
}

// Adds a keyframe at the frame with the value shown there, or removes the one already there. Removing the last one
// also puts its value on the transform, which the property falls back to, so the clip stays where it was.
export function toggleKeyframeOps(clip: Clip, prop: KeyframeProp, frame: number): OpInput[] {
  const at = frame - clip.start;
  const list = clip.keyframes?.[prop] ?? [];
  const value = effectiveTransform(clip, frame)[prop];
  if (keyState(clip, prop, frame) !== "here") {
    return [{ op: "update_clip", clipId: clip.id, patch: { keyframes: { [prop]: setKeyframe(list, at, value) } } }];
  }
  const next = removeKeyframe(list, at);
  const patch: Record<string, unknown> = { keyframes: { [prop]: next } };
  if (next.length === 0) patch.transform = { [prop]: value };
  return [{ op: "update_clip", clipId: clip.id, patch }];
}

// A change to the clip's transform made at a frame: each keyframed property gets a keyframe there, and everything
// else (an un-keyframed property, the crop, the stretch) goes on the transform, all in one update_clip.
export function writeTransformOps(clip: Clip, frame: number, patch: Partial<Transform>): OpInput[] {
  const transform: Record<string, unknown> = {};
  const keyframes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const prop = KEYFRAME_PROPS.find((p) => p === key);
    if (prop && isKeyframed(clip, prop)) keyframes[prop] = setKeyframe(clip.keyframes![prop]!, frame - clip.start, value as number);
    else transform[key] = value;
  }
  const out: Record<string, unknown> = {};
  if (Object.keys(transform).length > 0) out.transform = transform;
  if (Object.keys(keyframes).length > 0) out.keyframes = keyframes;
  return Object.keys(out).length > 0 ? [{ op: "update_clip", clipId: clip.id, patch: out }] : [];
}

// The timeline frame of the nearest keyframe of any property before or after the frame. Keyframes outside the clip,
// which a trim can leave, only shape the curve, so they are skipped.
export function neighbourKeyframe(clip: Clip, frame: number, dir: "prev" | "next"): number | null {
  const end = clip.start + clip.duration;
  let best: number | null = null;
  for (const prop of KEYFRAME_PROPS) {
    for (const k of clip.keyframes?.[prop] ?? []) {
      const at = clip.start + k.at;
      if (at < clip.start || at >= end) continue;
      if (dir === "prev" ? at < frame && (best === null || at > best) : at > frame && (best === null || at < best)) best = at;
    }
  }
  return best;
}

// A slow push in: the scale keyed from what the clip shows at its start to 1.15 times that on its last frame.
export function kenBurnsOps(clip: MediaClip): OpInput[] {
  const base = effectiveTransform(clip, clip.start).scale;
  const scale = [
    { at: 0, value: base },
    { at: Math.max(1, clip.duration - 1), value: round4(base * KEN_BURNS_ZOOM) },
  ];
  return [{ op: "update_clip", clipId: clip.id, patch: { keyframes: { scale } } }];
}
