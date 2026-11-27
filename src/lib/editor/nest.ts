import { DEFAULT_TRANSFORM, NEST_ID_JOIN, isNest, placedTracks, type Clip, type NestTrack, type NestedClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { LIMITS } from "@/lib/limits";
import { placeClips, type PlaceItem } from "./placement";

// Nesting: several clips made into one, and a nest taken apart again. Pure builders: each returns ops and never
// touches the store.

export type NestRefusal = "nothing" | "slot" | "nest" | "captions" | "locked" | "too-many" | "no-room";
export type Nesting = { ok: true; ops: OpInput[]; clipId: string } | { ok: false; why: NestRefusal };

// The ops that make these clips one nest. The nest takes their place in time, from the first one's start to the last
// one's end, on the first video or overlay track of theirs that is free there once they are gone, else on a track
// made for it. Inside, each clip stays on a track like the one it was on, as far from the nest's start as it was
// from the first clip's. An empty slot cannot be nested (a template fills it by name), nor a nest, nor captions.
export function nestOps(doc: TimelineDoc, clipIds: readonly string[], genId: () => string): Nesting {
  const wanted = new Set(clipIds);
  const picked = doc.tracks.flatMap((track) => track.clips.filter((clip) => wanted.has(clip.id)).map((clip) => ({ track, clip })));
  if (picked.length === 0) return { ok: false, why: "nothing" };
  if (picked.some(({ clip }) => clip.type === "placeholder")) return { ok: false, why: "slot" };
  if (picked.some(({ clip }) => isNest(clip))) return { ok: false, why: "nest" };
  // Captions belong to the Captions track, which a nest has none of.
  if (picked.some(({ clip }) => clip.type === "caption")) return { ok: false, why: "captions" };
  if (picked.some(({ track }) => track.locked)) return { ok: false, why: "locked" };
  if (picked.length > LIMITS.clipsPerNest) return { ok: false, why: "too-many" };
  const from = Math.min(...picked.map(({ clip }) => clip.start));
  const to = Math.max(...picked.map(({ clip }) => clip.start + clip.duration));

  const tracks: NestTrack[] = doc.tracks.flatMap((track): NestTrack[] => {
    const own = track.clips.filter((clip) => wanted.has(clip.id));
    if (own.length === 0 || track.kind === "caption") return [];
    return [
      {
        id: track.id,
        kind: track.kind,
        name: track.name,
        muted: track.muted,
        hidden: track.hidden,
        locked: false,
        ...(track.volume !== undefined && { volume: track.volume }),
        clips: own.map((clip) => ({ ...(clip as NestedClip), start: clip.start - from })),
      },
    ];
  });

  // Where it goes is decided on the project as it will be once the clips are out of it.
  const without: TimelineDoc = { ...doc, tracks: doc.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => !wanted.has(clip.id)) })) };
  const home = picked.find(({ track }) => track.kind === "video" || track.kind === "overlay")?.track.id ?? null;
  const nest = { type: "nest" as const, start: from, duration: to - from, in: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, tracks };
  const placed = placeClips(without, [{ clip: { ...nest, id: "" } as Clip, trackId: home, kind: home === null ? "overlay" : undefined }], genId);
  if (!placed.ok) return { ok: false, why: "no-room" };
  const removals: OpInput[] = picked.map(({ clip }) => ({ op: "remove_clip", clipId: clip.id }));
  return { ok: true, ops: [...removals, ...placed.ops], clipId: placed.clipIds[0] };
}

export type Unnesting = { ok: true; ops: OpInput[]; clipIds: string[] } | { ok: false; why: "not-a-nest" | "locked" | "no-room" };

// The ops that take a nest apart: its clips back on the timeline where they play, each on the track it came from
// when that track is still there, takes it and is free, else on another or a new one. Only the part the nest plays
// comes back: a clip the nest was trimmed across is cut there. What was set on the nest itself (its place, its
// colours, its mask) goes with it.
export function unnestOps(doc: TimelineDoc, clipId: string, genId: () => string): Unnesting {
  const track = doc.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const nest = track?.clips.find((c) => c.id === clipId);
  if (!track || !isNest(nest)) return { ok: false, why: "not-a-nest" };
  if (track.locked) return { ok: false, why: "locked" };
  const without: TimelineDoc = { ...doc, tracks: doc.tracks.map((t) => (t === track ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t)) };
  const items: PlaceItem[] = placedTracks(nest).flatMap((inner) => {
    // The track it came from has the id the nest's own track kept: the part of the placed track's id after the nest's.
    const cameFrom = inner.id.slice(nest.id.length + NEST_ID_JOIN.length);
    return inner.clips.map((clip): PlaceItem => ({ clip, trackId: cameFrom, kind: inner.kind === "caption" ? undefined : inner.kind }));
  });
  const placed = placeClips(without, items, genId);
  if (!placed.ok) return { ok: false, why: "no-room" };
  return { ok: true, ops: [{ op: "remove_clip", clipId }, ...placed.ops], clipIds: placed.clipIds };
}
