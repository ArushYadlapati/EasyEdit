import type { OpInput, TimelineDoc } from "@/lib/timeline";

// Linked clips: clips that share a group are selected together on the timeline, so one drag moves them all and one
// Delete removes them all. Pure lookups and builders.

// The clips linked with these, themselves included, in document order. A clip in no group stands for itself.
export function withGroups(doc: TimelineDoc, clipIds: readonly string[]): string[] {
  const asked = new Set(clipIds);
  const groups = new Set<string>();
  for (const track of doc.tracks) for (const clip of track.clips) if (asked.has(clip.id) && clip.group) groups.add(clip.group);
  if (groups.size === 0) return [...clipIds];
  const all: string[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) if (asked.has(clip.id) || (clip.group && groups.has(clip.group))) all.push(clip.id);
  }
  return all;
}

type Found = { id: string; group: string | null; locked: boolean };

function found(doc: TimelineDoc, clipIds: readonly string[]): Found[] {
  const asked = new Set(clipIds);
  return doc.tracks.flatMap((track) => track.clips.flatMap((clip) => (asked.has(clip.id) ? [{ id: clip.id, group: clip.group ?? null, locked: track.locked }] : [])));
}

// Links the clips under one new group. Null with fewer than two of them, with one on a locked track, or when they are
// one group already.
export function groupOps(doc: TimelineDoc, clipIds: readonly string[], genId: () => string): OpInput[] | null {
  const clips = found(doc, clipIds);
  if (clips.length < 2 || clips.some((clip) => clip.locked)) return null;
  if (clips[0].group !== null && clips.every((clip) => clip.group === clips[0].group)) return null;
  const group = genId();
  return clips.map((clip): OpInput => ({ op: "update_clip", clipId: clip.id, patch: { group } }));
}

// Takes each of the clips out of its group. Null when none of them is in one, or one is on a locked track. A clip
// left alone in its group is just a clip: nothing else is linked with it.
export function ungroupOps(doc: TimelineDoc, clipIds: readonly string[]): OpInput[] | null {
  const clips = found(doc, clipIds).filter((clip) => clip.group !== null);
  if (clips.length === 0 || clips.some((clip) => clip.locked)) return null;
  return clips.map((clip): OpInput => ({ op: "update_clip", clipId: clip.id, patch: { group: null } }));
}
