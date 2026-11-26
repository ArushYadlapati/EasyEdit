import { LIMITS } from "@/lib/limits";
import { thinTo } from "@/lib/media/motion";
import { mediaSize } from "@/lib/render/compositor";
import { effectiveTransform, type Clip, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";

// Follow: a text, a shape or an image kept on something in the video under it. Put it where the thing is at the
// playhead; the thing is then followed through the video's frames, and the clip gets position keyframes that keep it
// there. This file works out which video and which part of it, and turns what was found into the edit. Pure.

export const FOLLOW_MAX_SECONDS = 30; // the longest stretch followed at once
export const FOLLOW_TOLERANCE = 0.002; // keyframes are left out while the path stays within this share of the frame
const SMOOTH = 2; // frames on each side a found place is evened out with

type Video = MediaClip & { type: "video" };
export type FollowRefusal = "not-a-follower" | "locked" | "no-video" | "turned" | "too-long";
// u, v: where the follower's middle is in the video's whole picture at the playhead, 0 to 1 each way.
// from, to: the frames of the project followed through, the end not included.
export type FollowPlan = { ok: true; follower: Clip; video: Video; from: number; to: number; at: number; u: number; v: number } | { ok: false; why: FollowRefusal };

const FOLLOWERS: readonly Clip["type"][] = ["text", "shape", "image"];
const keyed = (clip: Clip, props: readonly string[]) => props.some((prop) => ((clip.keyframes as Record<string, unknown[]> | undefined)?.[prop]?.length ?? 0) > 0);

// The video's picture on the frame, in project pixels: where its middle is and how large it is drawn.
function pictureBox(doc: TimelineDoc, video: Video, source: { width: number; height: number } | null) {
  const size = mediaSize(doc, video, source);
  const t = video.transform;
  return { cx: t.x * doc.width, cy: t.y * doc.height, width: size.width * t.scale, height: size.height * t.scale };
}

// A place in the video's picture (0 to 1 each way) as a place on the frame (0 to 1 each way), and back.
export function pictureToFrame(doc: TimelineDoc, video: Video, source: { width: number; height: number } | null, u: number, v: number): { x: number; y: number } {
  const box = pictureBox(doc, video, source);
  return { x: (box.cx + (u - 0.5) * box.width) / doc.width, y: (box.cy + (v - 0.5) * box.height) / doc.height };
}
export function frameToPicture(doc: TimelineDoc, video: Video, source: { width: number; height: number } | null, x: number, y: number): { u: number; v: number } {
  const box = pictureBox(doc, video, source);
  return { u: (x * doc.width - box.cx) / box.width + 0.5, v: (y * doc.height - box.cy) / box.height + 0.5 };
}

// What following `followerId` at the playhead comes to. The video is the nearest one under the follower's track that
// plays forward at the playhead and has the follower's middle inside its picture; with none under it, the topmost
// such video anywhere. A video that is turned, flipped or itself moving by keyframes is not followed on: where a
// place of its picture lands on the frame would change from frame to frame. sourceOf: the picture size of a video's file.
export function followPlan(doc: TimelineDoc, followerId: string, playhead: number, sourceOf: (clip: Video) => { width: number; height: number } | null): FollowPlan {
  const home = doc.tracks.findIndex((track) => track.clips.some((clip) => clip.id === followerId));
  const follower = home < 0 ? undefined : doc.tracks[home].clips.find((clip) => clip.id === followerId);
  if (!follower || !FOLLOWERS.includes(follower.type) || playhead < follower.start || playhead >= follower.start + follower.duration) return { ok: false, why: "not-a-follower" };
  if (doc.tracks[home].locked) return { ok: false, why: "locked" };
  const middle = effectiveTransform(follower, playhead);
  const under = (track: (typeof doc.tracks)[number]): { video: Video; u: number; v: number } | null => {
    if (track.hidden) return null;
    for (const clip of track.clips) {
      if (clip.type !== "video" || clip.speed <= 0 || playhead < clip.start || playhead >= clip.start + clip.duration) continue;
      const video = clip as Video;
      const { u, v } = frameToPicture(doc, video, sourceOf(video), middle.x, middle.y);
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { video, u, v };
    }
    return null;
  };
  const below = doc.tracks.slice(0, home).reverse();
  const above = doc.tracks.slice(home + 1).reverse();
  let found: ReturnType<typeof under> = null;
  for (const track of [...below, ...above]) if ((found = under(track))) break;
  if (!found) return { ok: false, why: "no-video" };
  const { video, u, v } = found;
  if (video.transform.rotation !== 0 || video.transform.flipH || video.transform.flipV || keyed(video, ["x", "y", "scale", "rotation"])) return { ok: false, why: "turned" };
  const from = Math.max(follower.start, video.start);
  const to = Math.min(follower.start + follower.duration, video.start + video.duration);
  if (to - from > FOLLOW_MAX_SECONDS * doc.fps) return { ok: false, why: "too-long" };
  return { ok: true, follower, video, from, to, at: playhead, u, v };
}

// The edit that makes a clip follow: x and y keyframes through the places found, as few as keep the path (no more
// than a clip may hold), in place of any it had. found: where the thing is on the frame (0 to 1 each way) at frames
// of the project, in any order; a frame given twice counts once. [] with fewer than two frames to go by.
export function followOps(follower: Pick<Clip, "id" | "start" | "duration">, found: readonly { frame: number; x: number; y: number }[]): OpInput[] {
  const byFrame = new Map<number, { at: number; x: number; y: number }>();
  for (const { frame, x, y } of found) {
    const at = Math.round(frame) - follower.start;
    if (at < 0 || at >= follower.duration || byFrame.has(at)) continue;
    byFrame.set(at, { at, x, y });
  }
  const raw = [...byFrame.values()].sort((a, b) => a.at - b.at);
  if (raw.length < 2) return [];
  // A place is found to about a pixel of a small frame, so the path found trembles a little around the true one, and
  // a clip on it would visibly shake. Each point is evened out with the frames just before and just after it, as
  // many on one side as on the other, so the ends stay where they were found and a straight path stays straight.
  const points = raw.map((point, i) => {
    let reach = 0;
    while (reach < SMOOTH && i - reach - 1 >= 0 && i + reach + 1 < raw.length && raw[i - reach - 1].at === point.at - reach - 1 && raw[i + reach + 1].at === point.at + reach + 1) reach++;
    const near = raw.slice(i - reach, i + reach + 1);
    return { at: point.at, x: near.reduce((sum, p) => sum + p.x, 0) / near.length, y: near.reduce((sum, p) => sum + p.y, 0) / near.length };
  });
  const kept = thinTo(points, LIMITS.keyframesPerProperty, FOLLOW_TOLERANCE);
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return [
    {
      op: "update_clip",
      clipId: follower.id,
      patch: { keyframes: { x: kept.map((p) => ({ at: p.at, value: round(p.x) })), y: kept.map((p) => ({ at: p.at, value: round(p.y) })) } },
    },
  ];
}
