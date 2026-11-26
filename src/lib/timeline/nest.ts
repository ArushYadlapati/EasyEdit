import { LIMITS } from "@/lib/limits";
import { shiftKeyframes } from "./keyframes";
import { TRACK_ACCEPTS } from "./presets";
import type { Clip, NestClip, NestedClip, TimelineDoc, Track } from "./types";

// Nests: several clips made into one. This file has what the rest needs to know about them: how long a nest's own
// timeline is, whether a nest is sound, its tracks as a project's tracks (for drawing it), and the project with
// every nest's clips laid out as ordinary clips where they play (for finding the media, sound and fonts it needs).
// Pure.

// A nest's clip, named apart from every other clip of the project: the nest's id, this, the clip's own id.
export const NEST_ID_JOIN = "/";
export const nestedId = (nestId: string, innerId: string) => `${nestId}${NEST_ID_JOIN}${innerId}`;

export function isNest(clip: Pick<Clip, "type"> | undefined): clip is NestClip {
  return clip?.type === "nest";
}

export function nestClips(nest: Pick<NestClip, "tracks">): NestedClip[] {
  return nest.tracks.flatMap((track) => track.clips);
}

// What a nest is called: the name it was given, else how many clips it holds.
export function nestName(nest: Pick<NestClip, "name" | "tracks">): string {
  if (nest.name) return nest.name;
  const count = nestClips(nest).length;
  return `Nest of ${count} ${count === 1 ? "clip" : "clips"}`;
}

// How long a nest's own timeline is: the end of its last clip.
export function nestLength(nest: Pick<NestClip, "tracks">): number {
  return Math.max(0, ...nestClips(nest).map((clip) => clip.start + clip.duration));
}

// Why this cannot be a nest, or null when it can: it holds something, no more than a nest may, on tracks that take
// what is on them without overlap, under ids of its own; and it plays a part of its timeline that is there.
export function nestProblem(nest: NestClip): string | null {
  const clips = nestClips(nest);
  if (clips.length === 0) return "a nest holds at least one clip";
  if (clips.length > LIMITS.clipsPerNest) return `a nest holds at most ${LIMITS.clipsPerNest} clips`;
  if (new Set(nest.tracks.map((track) => track.id)).size !== nest.tracks.length) return "a nest's tracks need ids of their own";
  if (new Set(clips.map((clip) => clip.id)).size !== clips.length) return "a nest's clips need ids of their own";
  for (const track of nest.tracks) {
    const inOrder = [...track.clips].sort((a, b) => a.start - b.start);
    for (const [i, clip] of inOrder.entries()) {
      if (!TRACK_ACCEPTS[track.kind].includes(clip.type)) return `its ${track.kind} track "${track.id}" does not take the ${clip.type} clip "${clip.id}"`;
      if (i > 0 && inOrder[i - 1].start + inOrder[i - 1].duration > clip.start) return `clips "${inOrder[i - 1].id}" and "${clip.id}" overlap on its track "${track.id}"`;
    }
  }
  const length = nestLength(nest);
  if (nest.in + nest.duration > length) return `it plays to frame ${nest.in + nest.duration} of a timeline ${length} frames long`;
  return null;
}

// A nest's tracks as a project's own, each clip named with the nest's id before its own (nestedId), so the media it
// is drawn from can be told apart from every other clip's. The same list each time for the same nest.
const TRACKS = new WeakMap<NestClip, Track[]>();
export function nestTracks(nest: NestClip): Track[] {
  let tracks = TRACKS.get(nest);
  if (!tracks) {
    tracks = nest.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({ ...clip, id: nestedId(nest.id, clip.id) })) }));
    TRACKS.set(nest, tracks);
  }
  return tracks;
}

// The frame of a nest's own timeline shown at a frame of the project's.
export function nestFrame(nest: Pick<NestClip, "start" | "in">, frame: number): number {
  return frame - nest.start + nest.in;
}

const WAY_IN = ["transitionIn", "animationIn", "fadeIn"] as const;
const WAY_OUT = ["transitionOut", "animationOut", "fadeOut"] as const;

// A nest's clips where they play in the project: each cut to the part the nest plays and moved to where that part
// is, keeping the same picture and sound on every frame. A clip cut at the nest's edge loses its way in or out there.
// The same lists each time for the same nest, since they depend on nothing else.
const PLACED = new WeakMap<NestClip, { tracks: Track[] }>();
export function placedTracks(nest: NestClip): Track[] {
  const kept = PLACED.get(nest);
  if (kept) return kept.tracks;
  const from = nest.in;
  const to = nest.in + nest.duration;
  const tracks = nestTracks(nest).map((track) => ({
    ...track,
    id: nestedId(nest.id, track.id),
    clips: track.clips.flatMap((clip): Clip[] => {
      const start = Math.max(clip.start, from);
      const end = Math.min(clip.start + clip.duration, to);
      if (end <= start) return [];
      const cut = start - clip.start; // frames taken off its start
      const copy: Record<string, unknown> = { ...clip, start: nest.start + (start - from), duration: end - start };
      if (cut > 0) {
        if (clip.type === "video" || clip.type === "audio") copy.in = clip.in + Math.round(cut * clip.speed);
        if ("keyframes" in clip && clip.keyframes) copy.keyframes = shiftKeyframes(clip.keyframes, -cut);
        for (const key of WAY_IN) delete copy[key];
      }
      if (end < clip.start + clip.duration) for (const key of WAY_OUT) delete copy[key];
      return [copy as Clip];
    }),
  }));
  PLACED.set(nest, { tracks });
  return tracks;
}

export function hasNests(doc: Pick<TimelineDoc, "tracks">): boolean {
  return doc.tracks.some((track) => track.clips.some(isNest));
}

// The project with every nest's clips laid out as ordinary clips where they play, on tracks of their own after the
// nest's track: what its media, its sound and its fonts are found from. The nests themselves stay where they are (a
// reader of clips passes over them). Each of those tracks is hidden or muted when the nest's own track is, and as
// loud as that track and the nest make it. A project with no nest comes back as it is.
const EXPANDED = new WeakSet<TimelineDoc>();
export function expandNests(doc: TimelineDoc): TimelineDoc {
  // Laid out already, or nothing to lay out.
  if (EXPANDED.has(doc) || !hasNests(doc)) return doc;
  const tracks: Track[] = [];
  for (const track of doc.tracks) {
    tracks.push(track);
    for (const clip of track.clips) {
      if (!isNest(clip)) continue;
      for (const inner of placedTracks(clip)) {
        tracks.push({
          ...inner,
          hidden: track.hidden || inner.hidden,
          muted: track.muted || inner.muted,
          locked: true,
          volume: (track.volume ?? 1) * (inner.volume ?? 1) * clip.volume,
        });
      }
    }
  }
  const expanded = { ...doc, tracks };
  EXPANDED.add(expanded);
  return expanded;
}

// Every clip of a project and of its nests, for a reader that needs them all whether or not they play (the files a
// project names, say). A nest's clips come with their own ids.
export function everyClip(doc: Pick<TimelineDoc, "tracks">): (Clip | NestedClip)[] {
  return doc.tracks.flatMap((track) => track.clips.flatMap((clip): (Clip | NestedClip)[] => (isNest(clip) ? [clip, ...nestClips(clip)] : [clip])));
}
