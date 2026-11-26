import { LIMITS } from "@/lib/limits";
import { thinTo } from "@/lib/media/motion";
import { mediaSize } from "@/lib/render/compositor";
import type { MediaClip, OpInput, TimelineDoc } from "@/lib/timeline";

// Reframe: a video shot in one shape, shown in a project of another (a wide shot in an upright project). The clip is
// made to fill the frame, and is moved along the side that does not fit so that what moves in it stays in view. This
// file works out whether there is anything to do and turns what was found into the edit. Pure.

export const REFRAME_TOLERANCE = 0.004; // keyframes are left out while the path stays within this share of the frame
const FITS = 1.02; // a picture within 2% of the frame's shape has nothing to reframe

type Video = MediaClip & { type: "video" };
export type ReframeRefusal = "not-a-video" | "locked" | "fits" | "turned" | "backwards" | "too-long" | "no-size";
// axis: the way the picture is larger than the frame once it fills it. shown: its size that way, in frames (above 1).
// first, last: the frames of its file the clip plays.
export type ReframePlan = { ok: true; clip: Video; axis: "x" | "y"; shown: number; first: number; last: number } | { ok: false; why: ReframeRefusal };

export function reframePlan(doc: TimelineDoc, clipId: string, source: { width: number; height: number } | null): ReframePlan {
  const track = doc.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip || clip.type !== "video") return { ok: false, why: "not-a-video" };
  if (track.locked) return { ok: false, why: "locked" };
  if (!source || source.width <= 0 || source.height <= 0) return { ok: false, why: "no-size" };
  const video = clip as Video;
  if (video.transform.rotation !== 0 || video.transform.flipH || video.transform.flipV) return { ok: false, why: "turned" };
  if (video.speed <= 0) return { ok: false, why: "backwards" };
  // The picture filling the frame, at its own size: how far it reaches past the frame each way.
  const filled = mediaSize(doc, { ...video, transform: { ...video.transform, fit: "cover", crop: undefined } }, source);
  const across = filled.width / doc.width;
  const down = filled.height / doc.height;
  if (across < FITS && down < FITS) return { ok: false, why: "fits" };
  const first = Math.max(0, Math.round(video.in));
  const last = Math.round(video.in + video.duration * video.speed);
  if (last - first + 1 > LIMITS.steadyFrames) return { ok: false, why: "too-long" };
  return across >= down ? { ok: true, clip: video, axis: "x", shown: across, first, last } : { ok: true, clip: video, axis: "y", shown: down, first, last };
}

// Where the picture's middle goes on the frame (0 to 1) so that the place `at` of the picture (0 to 1 along the side
// that does not fit) is in the middle of the frame: as near as the picture's edges allow, since it must still fill it.
export function reframePlace(shown: number, at: number): number {
  const reach = Math.max(0, (shown - 1) / 2);
  return Math.min(0.5 + reach, Math.max(0.5 - reach, 0.5 + (0.5 - at) * shown));
}

// The edit that reframes a clip: it fills the frame at its own size, sits in the middle the other way, and has
// position keyframes along the side that does not fit, through the places found (as few as keep the path), in place
// of any it had. found: where the action is in the picture (0 to 1 each way) at frames of the clip's file, in any
// order. [] with fewer than two frames to go by.
export function reframeOps(plan: Extract<ReframePlan, { ok: true }>, found: readonly { sourceFrame: number; u: number; v: number }[]): OpInput[] {
  const { clip, axis, shown } = plan;
  const byFrame = new Map<number, { at: number; x: number; y: number }>();
  for (const point of found) {
    const at = Math.round((point.sourceFrame - clip.in) / clip.speed);
    if (at < 0 || at >= clip.duration || byFrame.has(at)) continue;
    const place = reframePlace(shown, axis === "x" ? point.u : point.v);
    byFrame.set(at, { at, x: axis === "x" ? place : 0.5, y: axis === "y" ? place : 0.5 });
  }
  const points = [...byFrame.values()].sort((a, b) => a.at - b.at);
  if (points.length < 2) return [];
  const kept = thinTo(points, LIMITS.keyframesPerProperty, REFRAME_TOLERANCE);
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const keys = kept.map((p) => ({ at: p.at, value: round(axis === "x" ? p.x : p.y) }));
  return [
    {
      op: "update_clip",
      clipId: clip.id,
      patch: {
        transform: { fit: "cover", scale: 1, x: axis === "x" ? keys[0].value : 0.5, y: axis === "y" ? keys[0].value : 0.5 },
        keyframes: { x: axis === "x" ? keys : [], y: axis === "y" ? keys : [], scale: [] },
      },
    },
  ];
}
