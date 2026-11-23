import { effectiveTransform, reversedTiming, type MediaClip, type OpInput, type TimelineDoc, type Track } from "@/lib/timeline";
import { trimBounds } from "./media-clips";

// Pure builders for the commands that change how fast and which way a clip plays. Each returns ops and never touches
// the store.

export const SPEED_MIN = 0.1; // the rates the Speed field takes: a tenth of as recorded to sixteen times
export const SPEED_MAX = 16; // past this the preview and the export play no sound
export const FREEZE_SECONDS = 2; // how long a new freeze frame holds

// A clip whose speed can be set: a video or an audio clip. An image has no speed to hear or see.
export function hasSpeed(clip: { type: string }): clip is MediaClip {
  return clip.type === "video" || clip.type === "audio";
}

// How fast a clip plays, whichever way: 1 is as recorded, 0 a held frame.
export function rateOf(clip: Pick<MediaClip, "speed">): number {
  return Math.abs(clip.speed);
}

// "2× faster", "Half speed", "Normal speed": the rate in words, beside the Speed field.
export function rateLabel(rate: number): string {
  if (rate === 0) return "Holds one frame";
  if (rate === 1) return "Normal speed";
  const times = (n: number) => String(Number(n.toFixed(2)));
  return rate > 1 ? `${times(rate)}× faster` : `${times(1 / rate)}× slower`;
}

// What a clip that does not play as recorded says on the timeline: "2×", "0.5×", "Reverse", "Reverse 2×", "Hold".
export function speedBadge(speed: number): string {
  if (speed === 0) return "Hold";
  const times = `${Number(Math.abs(speed).toFixed(2))}×`;
  if (speed > 0) return times;
  return speed === -1 ? "Reverse" : `Reverse ${times}`;
}

// The frames between a clip's start and the next clip on its track: how long it can get. Infinity with none after it.
export function roomAfter(track: Track, clip: { id: string; start: number }): number {
  const next = Math.min(Infinity, ...track.clips.filter((c) => c.id !== clip.id && c.start > clip.start).map((c) => c.start));
  return next - clip.start;
}

// Sets how fast a clip plays, keeping its way round and the footage it shows: at twice the speed it is half as long.
// It never grows into the clip after it (room) or past its media (lengthFrames, when known), so slowing a clip down
// with no room shows less of its footage. A held frame keeps its length. Null for a rate that is no number or a clip
// with no speed; [] when nothing changes.
export function speedOps(clip: MediaClip, rate: number, room: number, lengthFrames?: number): OpInput[] | null {
  if (!hasSpeed(clip) || !Number.isFinite(rate)) return null;
  const next = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(rate * 100) / 100));
  const speed = clip.speed < 0 ? -next : next;
  if (speed === clip.speed) return [];
  const wanted = clip.speed === 0 ? clip.duration : Math.max(1, Math.round(Math.abs(Math.round(clip.duration * clip.speed)) / next));
  const mediaEnd = trimBounds({ ...clip, speed }, lengthFrames)?.maxEnd;
  const longest = Math.min(room, mediaEnd === undefined ? Infinity : mediaEnd - clip.start);
  const duration = Math.max(1, Math.min(wanted, longest));
  const setSpeed: OpInput = { op: "update_clip", clipId: clip.id, patch: { speed } };
  if (duration === clip.duration) return [setSpeed];
  const trim: OpInput = { op: "trim_clip", clipId: clip.id, edge: "end", to: clip.start + duration };
  // A shorter clip is trimmed first and a longer one sped first, so the clip fits its media after each step, and
  // after each step of the undo too.
  return duration < clip.duration ? [trim, setSpeed] : [setSpeed, trim];
}

type Found = { track: Track; clip: MediaClip };

function videosOf(doc: TimelineDoc, clipIds: string[]): Found[] {
  const wanted = new Set(clipIds);
  return doc.tracks.flatMap((track) =>
    track.locked ? [] : track.clips.flatMap((clip) => (wanted.has(clip.id) && clip.type === "video" ? [{ track, clip }] : [])),
  );
}

// Turns each selected video clip round: the same frames, last to first, and back again on a clip that already plays
// backward. A held frame and a clip on a locked track are left out.
export function reverseOps(doc: TimelineDoc, clipIds: string[]): OpInput[] {
  return videosOf(doc, clipIds).flatMap(({ clip }): OpInput[] => {
    const timing = reversedTiming(clip);
    return timing ? [{ op: "update_clip", clipId: clip.id, patch: timing }] : [];
  });
}

export type Frozen = { ok: true; ops: OpInput[]; clipId: string } | { ok: false };

// Holds the frame under the playhead: the selected video clip there is cut at the playhead and a clip that holds that
// frame for FREEZE_SECONDS goes in at the cut, pushing what follows on its track later. The held clip looks as the
// clip does on that frame, keyframes counted in. Not ok when no selected video clip on an unlocked track is under the
// playhead, or the one there already holds a frame.
export function freezeFrameOps(doc: TimelineDoc, clipIds: string[], playhead: number, genId: () => string): Frozen {
  const under = videosOf(doc, clipIds).find(({ clip }) => clip.start <= playhead && playhead < clip.start + clip.duration && clip.speed !== 0);
  if (!under) return { ok: false };
  const { track, clip } = under;
  const at = playhead - clip.start;
  const clipId = genId();
  const held: OpInput = {
    op: "add_clip",
    trackId: track.id,
    ripple: true,
    clip: {
      id: clipId,
      type: "video",
      assetId: clip.assetId,
      start: playhead,
      duration: Math.max(1, Math.round(FREEZE_SECONDS * doc.fps)),
      in: Math.max(0, Math.floor(clip.in + at * clip.speed)),
      speed: 0,
      volume: clip.volume,
      transform: structuredClone(effectiveTransform(clip, playhead)),
    },
  };
  const ops: OpInput[] = at > 0 ? [{ op: "split_clip", clipId: clip.id, at: playhead, newClipId: genId() }, held] : [held];
  return { ok: true, ops, clipId };
}

// Whether any of these clips is a video on an unlocked track: one that could be turned round or frozen.
export function hasVideo(doc: TimelineDoc, clipIds: string[]): boolean {
  return videosOf(doc, clipIds).length > 0;
}
