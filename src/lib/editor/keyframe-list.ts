import type { Clip, Ease, Keyframe, KeyframeProp, OpInput } from "@/lib/timeline";
import { KEYFRAME_PROPS, effectiveTransform, removeKeyframe } from "@/lib/timeline/keyframes";

// A clip's keyframes as list rows for the Effects tab, and the ops that edit them. A keyframe's `at` counts from the
// clip's start, and may sit outside the clip (a trim can leave those; they still shape the curve).

export type KeyframeRow = { prop: KeyframeProp; keyframes: Keyframe[] };

// Only the keyed properties, in KEYFRAME_PROPS order, each list sorted by `at`.
export function keyframeRows(clip: Clip): KeyframeRow[] {
  const rows: KeyframeRow[] = [];
  for (const prop of KEYFRAME_PROPS) {
    const list = clip.keyframes?.[prop] ?? [];
    if (list.length > 0) rows.push({ prop, keyframes: [...list].sort((a, b) => a.at - b.at) });
  }
  return rows;
}

const update = (clip: Clip, patch: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: clip.id, patch }];

// Changes the keyframe at `at`. A move onto another keyframe's `at` replaces that one. [] when there is no keyframe
// at `at` or the patch changes nothing.
export function editKeyframeOps(clip: Clip, prop: KeyframeProp, at: number, patch: { at?: number; value?: number; ease?: Ease }): OpInput[] {
  const list = clip.keyframes?.[prop] ?? [];
  const old = list.find((k) => k.at === at);
  if (!old) return [];
  const next: Keyframe = { ...old };
  if (patch.at !== undefined) next.at = patch.at;
  if (patch.value !== undefined) next.value = patch.value;
  if (patch.ease !== undefined) next.ease = patch.ease;
  if (next.at === old.at && next.value === old.value && next.ease === old.ease) return [];
  const rest = list.filter((k) => k.at !== at && k.at !== next.at);
  const sorted = [...rest, next].sort((a, b) => a.at - b.at);
  return update(clip, { keyframes: { [prop]: sorted } });
}

// Removes the keyframe at `at`. Removing the last one puts its value on the transform, so the clip stays where it was.
export function deleteKeyframeOps(clip: Clip, prop: KeyframeProp, at: number): OpInput[] {
  const list = clip.keyframes?.[prop] ?? [];
  if (!list.some((k) => k.at === at)) return [];
  const next = removeKeyframe(list, at);
  const patch: Record<string, unknown> = { keyframes: { [prop]: next } };
  if (next.length === 0) patch.transform = { [prop]: effectiveTransform(clip, clip.start + at)[prop] };
  return update(clip, patch);
}

// Drops every keyframe of the property, keeping the value shown at the clip's first frame on the transform.
export function clearKeyframesOps(clip: Clip, prop: KeyframeProp): OpInput[] {
  if ((clip.keyframes?.[prop]?.length ?? 0) === 0) return [];
  return update(clip, { keyframes: { [prop]: [] }, transform: { [prop]: effectiveTransform(clip, clip.start)[prop] } });
}
