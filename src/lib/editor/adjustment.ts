import { LIMITS } from "@/lib/limits";
import { DEFAULT_TRANSFORM, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { nextTrackName } from "./placement";

// Adding an adjustment layer: a clip with no picture that changes the colours of everything under it.

// How long a new one lasts, where it has the room.
export const ADJUSTMENT_SECONDS = 5;

export type AdjustmentPlan = { ok: true; ops: OpInput[]; clipId: string } | { ok: false; reason: "tracks" };

// A new adjustment layer starting at the frame. It goes on the front-most video or overlay track when that track is
// free there (shortened to fit before the track's next clip), so it changes every picture and leaves text and shapes
// alone. Otherwise it gets an overlay track of its own, right in front of that one. ids: the new clip's id and, if a
// track is made, the track's.
export function addAdjustmentOps(doc: TimelineDoc, frame: number, ids: { clip: string; track: string }): AdjustmentPlan {
  const wanted = Math.max(1, Math.round(ADJUSTMENT_SECONDS * doc.fps));
  const top = doc.tracks.findLastIndex((t) => t.kind === "video" || t.kind === "overlay");
  const clip = (duration: number) => ({ id: ids.clip, type: "adjustment" as const, start: frame, duration, transform: { ...DEFAULT_TRANSFORM } });
  const track = top >= 0 ? doc.tracks[top] : null;
  if (track && !track.locked) {
    const inside = track.clips.some((c) => c.start <= frame && frame < c.start + c.duration);
    const next = Math.min(...track.clips.filter((c) => c.start > frame).map((c) => c.start), Infinity);
    if (!inside && track.clips.length < LIMITS.clipsPerTrack) {
      return { ok: true, clipId: ids.clip, ops: [{ op: "add_clip", trackId: track.id, clip: clip(Math.min(wanted, next - frame)) }] };
    }
  }
  if (doc.tracks.length >= LIMITS.tracksPerProject) return { ok: false, reason: "tracks" };
  return {
    ok: true,
    clipId: ids.clip,
    ops: [
      { op: "add_track", track: { id: ids.track, kind: "overlay", name: nextTrackName(doc, "overlay") }, index: top + 1 },
      { op: "add_clip", trackId: ids.track, clip: clip(wanted) },
    ],
  };
}
