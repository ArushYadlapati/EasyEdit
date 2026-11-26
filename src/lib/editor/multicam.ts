import type { Clip, MediaClip, OpInput, TimelineDoc, Track } from "@/lib/timeline";
import { displayRows } from "./geometry";

// Multicam: several cameras' videos of the same moment, one above the other on their own tracks (lined up by their
// sound, say), cut between as one programme. Each track is an angle. Cutting to an angle at the playhead cuts every
// angle's clip there and, from there to that clip's end or its next cut, shows the angle picked and hides the
// others. A hidden stretch is a clip at no opacity: it is still there to cut back to, costs nothing to draw, and
// everything else in the editor treats it as the clip it is. Pure builders: each returns ops and never touches the store.

export type Angle = { trackId: string; name: string };
type Video = MediaClip & { type: "video" };
const isVideo = (clip: Clip): clip is Video => clip.type === "video";
const isAngleTrack = (track: Track) => track.kind === "video" || track.kind === "overlay";

// The angles among these clips: each video or overlay track that holds one of them (a video), from the top row of
// the timeline down. Fewer than two is no multicam.
export function anglesOf(doc: TimelineDoc, clipIds: readonly string[]): Angle[] {
  const picked = new Set(clipIds);
  return displayRows(doc)
    .filter((track) => isAngleTrack(track) && track.clips.some((clip) => picked.has(clip.id) && isVideo(clip)))
    .map((track) => ({ trackId: track.id, name: track.name }));
}

// An angle's video under a frame, if it has one there.
function under(doc: TimelineDoc, trackId: string, frame: number): Video | undefined {
  return doc.tracks.find((track) => track.id === trackId)?.clips.find((clip): clip is Video => isVideo(clip) && clip.start <= frame && frame < clip.start + clip.duration);
}

// The angle showing at a frame: the one whose video there is not hidden. Null when none or more than one is (before
// the first cut every angle shows, the top one over the rest).
export function shownAngle(doc: TimelineDoc, angles: readonly Angle[], frame: number): string | null {
  const showing = angles.filter((angle) => (under(doc, angle.trackId, frame)?.transform.opacity ?? 0) > 0);
  return showing.length === 1 ? showing[0].trackId : null;
}

export type AngleCut = { ok: true; ops: OpInput[]; newClipIds: string[] } | { ok: false; why: "one-angle" | "locked" | "nothing-here" | "already" };

// The ops that cut to an angle at a frame. The angle picked is shown, and every other angle hidden, from the frame
// to where the programme next changes angle, or to the end of the picked angle's clip when it does not: so a first
// cut runs to the end of that camera's footage, and a cut made between two others changes only the stretch between
// them. Clips are cut at the two ends of that stretch where they reach past them. Asking for what already shows
// changes nothing. newClipIds: the clips the cuts made.
export function cutToAngleOps(doc: TimelineDoc, angles: readonly Angle[], trackId: string, frame: number, genId: () => string): AngleCut {
  if (angles.length < 2 || !angles.some((angle) => angle.trackId === trackId)) return { ok: false, why: "one-angle" };
  const picked = under(doc, trackId, frame);
  if (!picked) return { ok: false, why: "nothing-here" };
  const tracks = angles.map((angle) => doc.tracks.find((track) => track.id === angle.trackId)!);
  const videos = (track: Track) => track.clips.filter(isVideo);
  // Where the stretch ends: the first place after the frame where another angle takes over, if the picked clip lasts that long.
  const now = shownAngle(doc, angles, frame);
  const edges = [...new Set(tracks.flatMap((track) => videos(track).flatMap((clip) => [clip.start, clip.start + clip.duration])))].filter((edge) => edge > frame).sort((a, b) => a - b);
  let end = picked.start + picked.duration;
  for (const edge of edges) {
    if (edge >= end) break;
    if (shownAngle(doc, angles, edge) !== now) {
      end = edge;
      break;
    }
  }

  const ops: OpInput[] = [];
  const newClipIds: string[] = [];
  let locked = false;
  // Sets one clip's opacity over the part of it inside the stretch, cutting it at the stretch's ends where it reaches past them.
  const set = (track: Track, clip: Video, opacity: number) => {
    if (track.locked) return void (locked = true);
    const from = Math.max(clip.start, frame);
    const to = Math.min(clip.start + clip.duration, end);
    let target = clip.id;
    if (from > clip.start) {
      target = genId();
      newClipIds.push(target);
      ops.push({ op: "split_clip", clipId: clip.id, at: from, newClipId: target });
    }
    if (to < clip.start + clip.duration) {
      const rest = genId();
      newClipIds.push(rest);
      ops.push({ op: "split_clip", clipId: target, at: to, newClipId: rest });
    }
    ops.push({ op: "update_clip", clipId: target, patch: { transform: { opacity } } });
  };
  for (const track of tracks) {
    if (track.id === trackId) {
      if (picked.transform.opacity === 0) set(track, picked, 1);
      continue;
    }
    for (const clip of videos(track)) {
      const overlaps = clip.start < end && clip.start + clip.duration > frame;
      if (overlaps && clip.transform.opacity > 0) set(track, clip, 0);
    }
  }
  if (locked) return { ok: false, why: "locked" };
  return ops.length === 0 ? { ok: false, why: "already" } : { ok: true, ops, newClipIds };
}

// The ops that take the programme's sound from one angle: that angle's videos as loud as recorded where they were
// silent, and every other angle's silent. Only the clips given are changed.
export function angleSoundOps(doc: TimelineDoc, clipIds: readonly string[], angles: readonly Angle[], trackId: string): OpInput[] {
  const picked = new Set(clipIds);
  const ops: OpInput[] = [];
  for (const angle of angles) {
    const track = doc.tracks.find((t) => t.id === angle.trackId);
    if (!track || track.locked) continue;
    for (const clip of track.clips) {
      if (!picked.has(clip.id) || !isVideo(clip)) continue;
      const volume = angle.trackId === trackId ? (clip.volume > 0 ? clip.volume : 1) : 0;
      if (volume !== clip.volume) ops.push({ op: "update_clip", clipId: clip.id, patch: { volume } });
    }
  }
  return ops;
}

// The angle whose sound is heard: the only one with a video among these clips that is not silent. Null otherwise.
export function soundAngle(doc: TimelineDoc, clipIds: readonly string[], angles: readonly Angle[]): string | null {
  const picked = new Set(clipIds);
  const loud = angles.filter((angle) => doc.tracks.find((t) => t.id === angle.trackId)?.clips.some((clip) => picked.has(clip.id) && isVideo(clip) && clip.volume > 0));
  return loud.length === 1 ? loud[0].trackId : null;
}
