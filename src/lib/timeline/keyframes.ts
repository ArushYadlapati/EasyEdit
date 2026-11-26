import { ADJUST_KEYS, adjustOf, type AdjustKey, type FullAdjust } from "./adjust";
import type { Clip, Crop, Ease, Keyframe, KeyframeCurve, KeyframeProp, Keyframes, Transform } from "./types";

// The properties that move and fade a clip's picture, which are fields of its transform.
export type TransformProp = "x" | "y" | "scale" | "rotation" | "opacity";
export const TRANSFORM_PROPS: readonly TransformProp[] = ["x", "y", "scale", "rotation", "opacity"];

// The four sides of its crop, each with the side of the transform's crop it sets.
export type CropProp = "cropLeft" | "cropTop" | "cropRight" | "cropBottom";
export const CROP_PROPS: readonly CropProp[] = ["cropLeft", "cropTop", "cropRight", "cropBottom"];
export const CROP_SIDE: Record<CropProp, keyof Crop> = { cropLeft: "left", cropTop: "top", cropRight: "right", cropBottom: "bottom" };

// Every property a clip can key: those, a video's or audio clip's volume, and a picture's colour changes and
// stylised effects.
export const KEYFRAME_PROPS: readonly KeyframeProp[] = [...TRANSFORM_PROPS, "volume", ...ADJUST_KEYS, ...CROP_PROPS];

export function isCropProp(prop: KeyframeProp): prop is CropProp {
  return (CROP_PROPS as readonly string[]).includes(prop);
}

export function isAdjustProp(prop: KeyframeProp): prop is AdjustKey {
  return (ADJUST_KEYS as readonly string[]).includes(prop);
}

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

// A hand-shaped travel: how far along (0 to 1, and past either when the curve overshoots) at share p of the time. The
// curve gives time and distance both as functions of its own parameter, so that parameter is found for p first: time
// only ever runs forward (each x handle is between 0 and 1), so halving the range always closes in on it.
export function bezierAt(curve: KeyframeCurve, p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const [x1, y1, x2, y2] = curve;
  const along = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  let t = p;
  for (let i = 0; i < 40; i++) {
    const x = along(x1, x2, t);
    if (Math.abs(x - p) < 1e-7) break;
    if (x < p) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return along(y1, y2, t);
}

// How far a keyframe's travel has come at share p of the way to the next one.
export function travel(from: Pick<Keyframe, "ease" | "curve">, p: number): number {
  if (from.curve && from.ease !== "hold") return bezierAt(from.curve, p);
  return ease(from.ease ?? "linear", p);
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
  return a.value + (b.value - a.value) * travel(a, (at - a.at) / (b.at - a.at));
}

export function isKeyframed(clip: Clip, prop: KeyframeProp): boolean {
  return (clip.keyframes?.[prop]?.length ?? 0) > 0;
}

// The least of a picture a crop leaves across or down, whatever its keyframes say at one moment.
const CROP_LEAST = 0.02;

// A crop with two opposite sides brought back, in proportion, where they would leave less than that.
function fitCrop(crop: Crop): Crop {
  const fit = (a: number, b: number): [number, number] => {
    const most = 1 - CROP_LEAST;
    return a + b <= most ? [a, b] : [(a * most) / (a + b), (b * most) / (a + b)];
  };
  const [left, right] = fit(crop.left, crop.right);
  const [top, bottom] = fit(crop.top, crop.bottom);
  return { left, top, right, bottom };
}

// The clip's transform at a timeline frame: each keyed property at its value there, the sides of its crop among
// them. Hands back the clip's own object when nothing is keyframed, so callers can tell cheaply that nothing moves.
export function effectiveTransform(clip: Clip, frame: number): Transform {
  const keyed = TRANSFORM_PROPS.filter((p) => isKeyframed(clip, p));
  const sides = CROP_PROPS.filter((p) => isKeyframed(clip, p));
  if (keyed.length === 0 && sides.length === 0) return clip.transform;
  const out = { ...clip.transform };
  for (const p of keyed) out[p] = valueAt(clip.keyframes![p]!, frame - clip.start);
  if (sides.length > 0) {
    const crop = { left: 0, top: 0, right: 0, bottom: 0, ...clip.transform.crop };
    for (const p of sides) crop[CROP_SIDE[p]] = Math.min(1, Math.max(0, valueAt(clip.keyframes![p]!, frame - clip.start)));
    out.crop = fitCrop(crop);
  }
  return out;
}

// How loud a clip is at a timeline frame: its keyframed volume there, else its volume. 0 for a clip with no sound.
export function volumeAt(clip: Clip, frame: number): number {
  if (clip.type !== "video" && clip.type !== "audio") return 0;
  return isKeyframed(clip, "volume") ? valueAt(clip.keyframes!.volume!, frame - clip.start) : clip.volume;
}

// A picture's or an adjustment layer's colour changes and stylised effects at a timeline frame: each one's keyframed
// value there, else the clip's own. Every key is given; any other clip has them all at 0.
export function adjustAt(clip: Clip, frame: number): FullAdjust {
  if (clip.type !== "video" && clip.type !== "image" && clip.type !== "adjustment") return adjustOf(undefined);
  const out = adjustOf(clip.adjust);
  if (!clip.keyframes) return out;
  for (const key of ADJUST_KEYS) {
    const list = clip.keyframes[key];
    if (list && list.length > 0) out[key] = valueAt(list, frame - clip.start);
  }
  return out;
}

// A property's value at a timeline frame, keyframes counted in.
export function propValue(clip: Clip, prop: KeyframeProp, frame: number): number {
  if (prop === "volume") return volumeAt(clip, frame);
  if (isAdjustProp(prop)) return adjustAt(clip, frame)[prop];
  const t = effectiveTransform(clip, frame);
  return isCropProp(prop) ? (t.crop?.[CROP_SIDE[prop]] ?? 0) : t[prop];
}

// The update_clip patch that sets a property where it lives when it is not keyframed: the transform, the volume, or
// the colour changes. A crop is one value in the transform, so a side is set with the clip's other three.
export function basePatch(clip: Clip, prop: KeyframeProp, value: number): Record<string, unknown> {
  if (prop === "volume") return { volume: value };
  if (isAdjustProp(prop)) return { adjust: { [prop]: value } };
  if (isCropProp(prop)) return { transform: { crop: fitCrop({ left: 0, top: 0, right: 0, bottom: 0, ...clip.transform.crop, [CROP_SIDE[prop]]: value }) } };
  return { transform: { [prop]: value } };
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
