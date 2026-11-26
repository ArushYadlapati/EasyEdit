import { TRACK_ACCEPTS, type MediaClip, type OpInput, type TimelineDoc, type Track, type TrackKind } from "@/lib/timeline";
import { nextTrackName, newTrackIndex } from "./placement";

// The two edits a source monitor makes: a part of a file, marked from In to Out, goes onto a track at the playhead.
// Insert makes room for it, pushing what follows on that track later. Overwrite takes the place of whatever is
// there. Pure builders: each returns ops and never touches the store.

export type SourceEditMode = "insert" | "overwrite";

// The tracks a clip of this type can go on, in the project's order: every unlocked track that takes it.
export function sourceTracks(doc: TimelineDoc, type: MediaClip["type"]): Track[] {
  return doc.tracks.filter((track) => !track.locked && TRACK_ACCEPTS[track.kind].includes(type));
}

// The kind of track made for a clip when the project has none that takes it.
const HOME: Record<MediaClip["type"], TrackKind> = { video: "video", image: "video", audio: "audio" };

// The ops that empty a track from frame `from` up to `to`: a clip wholly inside goes; one that reaches in from either
// side is trimmed back to the edge; one that covers the whole span is cut in two around it. Nothing ever grows, so
// the ops hold in any order.
export function clearSpanOps(track: Track, from: number, to: number, genId: () => string): OpInput[] {
  const ops: OpInput[] = [];
  for (const clip of track.clips) {
    const end = clip.start + clip.duration;
    if (end <= from || clip.start >= to) continue;
    if (clip.start >= from && end <= to) ops.push({ op: "remove_clip", clipId: clip.id });
    else if (clip.start < from && end > to) {
      // Its later part first, as a clip of its own after the span; then its earlier part back to the span's start.
      ops.push({ op: "split_clip", clipId: clip.id, at: to, newClipId: genId() });
      ops.push({ op: "trim_clip", clipId: clip.id, edge: "end", to: from });
    } else if (clip.start < from) ops.push({ op: "trim_clip", clipId: clip.id, edge: "end", to: from });
    else ops.push({ op: "trim_clip", clipId: clip.id, edge: "start", to });
  }
  return ops;
}

export type SourceEdit = { ok: true; ops: OpInput[]; clipId: string; trackId: string } | { ok: false; why: "locked" | "wrong-track" };

// Puts a new clip (its start is where it goes) on a track, as one change. trackId: the track; null for the first that
// takes it, or a new track when there is none. Insert: a clip the start falls inside is cut there, and everything
// from there on moves later by the new clip's length. Overwrite: what lies under the new clip is cleared away.
export function sourceEditOps(doc: TimelineDoc, clip: Omit<MediaClip, "id">, trackId: string | null, mode: SourceEditMode, genId: () => string): SourceEdit {
  const clipId = genId();
  const given = trackId === null ? null : doc.tracks.find((t) => t.id === trackId);
  if (trackId !== null) {
    if (!given || !TRACK_ACCEPTS[given.kind].includes(clip.type)) return { ok: false, why: "wrong-track" };
    if (given.locked) return { ok: false, why: "locked" };
  }
  const track = given ?? sourceTracks(doc, clip.type)[0];
  if (!track) {
    // No track takes it: it gets one of its own, where a new track of its kind goes.
    const id = genId();
    const kind = HOME[clip.type];
    const add: OpInput = { op: "add_track", track: { id, kind, name: nextTrackName(doc, kind) }, index: newTrackIndex(doc, kind) };
    return { ok: true, ops: [add, { op: "add_clip", trackId: id, clip: { ...clip, id: clipId } }], clipId, trackId: id };
  }
  const at = clip.start;
  if (mode === "overwrite") {
    const ops = [...clearSpanOps(track, at, at + clip.duration, genId), { op: "add_clip", trackId: track.id, clip: { ...clip, id: clipId } } as OpInput];
    return { ok: true, ops, clipId, trackId: track.id };
  }
  const under = track.clips.find((c) => c.start < at && c.start + c.duration > at);
  const ops: OpInput[] = under ? [{ op: "split_clip", clipId: under.id, at, newClipId: genId() }] : [];
  ops.push({ op: "add_clip", trackId: track.id, clip: { ...clip, id: clipId }, ripple: true });
  return { ok: true, ops, clipId, trackId: track.id };
}

// What a marked part of a file comes to: In and Out held inside the file and in order, at least a frame apart.
// seconds: the file's length (null for an image, which has none: its In is 0 and its Out is how long it shows).
export function markedSpan(inSeconds: number, outSeconds: number, seconds: number | null, fps: number): { inSeconds: number; durationSeconds: number } {
  const frame = 1 / fps;
  if (seconds === null) return { inSeconds: 0, durationSeconds: Math.max(frame, outSeconds - inSeconds) };
  const from = Math.min(Math.max(0, inSeconds), Math.max(0, seconds - frame));
  const to = Math.min(seconds, Math.max(from + frame, outSeconds));
  return { inSeconds: from, durationSeconds: to - from };
}
