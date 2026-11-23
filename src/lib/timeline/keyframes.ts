import type { Clip, Ease, Keyframe, KeyframeProp, Keyframes, Transform } from "./types";

// The properties that move and fade a clip's picture, which are fields of its transform.
export type TransformProp = Exclude<KeyframeProp, "volume">;
export const TRANSFORM_PROPS: readonly TransformProp[] = ["x", "y", "scale", "rotation", "opacity"];

// Every property a clip can key: those, and a video's or audio clip's volume.
export const KEYFRAME_PROPS: readonly KeyframeProp[] = [...TRANSFORM_PROPS, "volume"];

// p runs 0..1 between two keyframes.
export function ease(kind: Ease, p: number): number {
  switch (kind) {
    case "ease_in":
      return p * p * p;
    case "ease_out":
      return 1 - (1 - p) ** 3;
    case "ease_in_out":
      return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    case "hold":
      return p < 1 ? 0 : 1;
    default:
      return p;
  }
}

// The list must be sorted and not empty. Outside its first and last keyframe the nearest value holds.
export function valueAt(list: readonly Keyframe[], at: number): number {
  if (at <= list[0].at) return list[0].value;
  const last = list[list.length - 1];
  if (at >= last.at) return last.value;
  let i = 0;
  while (list[i + 1].at <= at) i++;
  const a = list[i];
  const b = list[i + 1];
  return a.value + (b.value - a.value) * ease(a.ease ?? "linear", (at - a.at) / (b.at - a.at));
}

export function isKeyframed(clip: Clip, prop: KeyframeProp): boolean {
  return (clip.keyframes?.[prop]?.length ?? 0) > 0;
}

// The clip's transform at a timeline frame. Hands back the clip's own object when nothing is keyframed, so callers
// can tell cheaply that nothing moves.
export function effectiveTransform(clip: Clip, frame: number): Transform {
  const keyed = TRANSFORM_PROPS.filter((p) => isKeyframed(clip, p));
  if (keyed.length === 0) return clip.transform;
  const out = { ...clip.transform };
  for (const p of keyed) out[p] = valueAt(clip.keyframes![p]!, frame - clip.start);
  return out;
}

// How loud a clip is at a timeline frame: its keyframed volume there, else its volume. 0 for a clip with no sound.
export function volumeAt(clip: Clip, frame: number): number {
  if (clip.type !== "video" && clip.type !== "audio") return 0;
  return isKeyframed(clip, "volume") ? valueAt(clip.keyframes!.volume!, frame - clip.start) : clip.volume;
}

// A property's value at a timeline frame, keyframes counted in.
export function propValue(clip: Clip, prop: KeyframeProp, frame: number): number {
  return prop === "volume" ? volumeAt(clip, frame) : effectiveTransform(clip, frame)[prop];
}

// The update_clip patch that sets a property where it lives when it is not keyframed: the transform, or the volume.
export function basePatch(prop: KeyframeProp, value: number): Record<string, unknown> {
  return prop === "volume" ? { volume: value } : { transform: { [prop]: value } };
}

// False only when the clip is invisible for its whole length, so it can be skipped when drawing.
export function mayShow(clip: Clip): boolean {
  return clip.transform.opacity > 0 || (clip.keyframes?.opacity?.some((k) => k.value > 0) ?? false);
}

export function keyframeAt(clip: Clip, prop: KeyframeProp, at: number): Keyframe | undefined {
  return clip.keyframes?.[prop]?.find((k) => k.at === at);
}

export function setKeyframe(list: readonly Keyframe[], at: number, value: number): Keyframe[] {
  const i = list.findIndex((k) => k.at >= at);
  if (i === -1) return [...list, { at, value }];
  if (list[i].at === at) return list.map((k, j) => (j === i ? { ...k, value } : k));
  return [...list.slice(0, i), { at, value }, ...list.slice(i)];
}

export function removeKeyframe(list: readonly Keyframe[], at: number): Keyframe[] {
  return list.filter((k) => k.at !== at);
}

export function shiftKeyframes(k: Keyframes | undefined, by: number): Keyframes | undefined {
  if (!k) return k;
  const out: Keyframes = {};
  for (const p of KEYFRAME_PROPS) {
    const list = k[p];
    if (list) out[p] = list.map((f) => ({ ...f, at: f.at + by }));
  }
  return out;
}
