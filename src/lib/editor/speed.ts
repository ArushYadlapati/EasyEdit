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

// Speed ramps: a clip that changes speed as it plays. A clip has one speed, so a ramp is the clip cut into short
// pieces, each a little faster or slower than the one before, linked so they are moved as one. Ten pieces at thirty
// frames a second read as one smooth change.

// How fast each part of the clip plays, as a multiple of its own speed, at share p (0 to 1) of the way through its
// footage.
export type RampId = "speed_up" | "slow_down" | "hero" | "bullet" | "flash_in" | "flash_out";
const smooth = (p: number) => p * p * (3 - 2 * p);
const between = (a: number, b: number, p: number) => a + (b - a) * smooth(Math.min(1, Math.max(0, p)));
export const RAMPS: readonly { id: RampId; label: string; says: string; at(p: number): number }[] = [
  { id: "speed_up", label: "Speed up", says: "Starts as it is and ends three times as fast.", at: (p) => between(1, 3, p) },
  { id: "slow_down", label: "Slow down", says: "Starts as it is and ends at a third of the speed.", at: (p) => between(1, 1 / 3, p) },
  { id: "hero", label: "Hero", says: "Fast, slow in the middle, fast again.", at: (p) => between(0.4, 2.5, Math.abs(p - 0.5) * 2) },
  { id: "bullet", label: "Bullet", says: "As it is, with a moment of slow motion in the middle.", at: (p) => between(0.25, 1, (Math.abs(p - 0.5) - 0.1) / 0.2) },
  { id: "flash_in", label: "Flash in", says: "Rushes in four times as fast, then settles.", at: (p) => between(4, 1, p / 0.35) },
  { id: "flash_out", label: "Flash out", says: "Plays as it is, then rushes out four times as fast.", at: (p) => between(1, 4, (p - 0.65) / 0.35) },
];

export const RAMP_PIECES = 10;

export type Ramped = { ok: true; ops: OpInput[]; clipIds: string[] } | { ok: false; why: "not-a-clip" | "too-short" | "no-room" };

// The ops that turn one forward video or audio clip into a ramp: its footage in up to RAMP_PIECES equal parts, each
// at its own speed. The whole gets longer or shorter with it, so every later clip on the track moves by the
// difference and nothing is covered or left as a gap. The first piece keeps the clip's id and its way in, the last
// its way out; the pieces share a link. ids: a new id each call. clipsCap: the most clips a track holds.
export function rampOps(doc: TimelineDoc, clipId: string, rampId: RampId, ids: () => string, clipsCap = Infinity): Ramped {
  const track = doc.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  const ramp = RAMPS.find((r) => r.id === rampId);
  if (!track || track.locked || !clip || !ramp || !hasSpeed(clip) || clip.speed <= 0) return { ok: false, why: "not-a-clip" };
  const used = Math.round(clip.duration * clip.speed); // frames of footage
  const pieces = Math.min(RAMP_PIECES, Math.floor(used / 2));
  if (pieces < 3) return { ok: false, why: "too-short" };
  if (track.clips.length + pieces - 1 > clipsCap) return { ok: false, why: "no-room" };

  const group = clip.group ?? ids();
  const made: Record<string, unknown>[] = [];
  let at = clip.start;
  let from = 0; // each piece starts on the frame of footage after the one before ended on, so nothing is skipped
  for (let i = 0; i < pieces; i++) {
    const footage = Math.round((used * (i + 1)) / pieces) - from;
    // Two places, as the Speed field keeps, and never past what a clip may be set to.
    const speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(clip.speed * ramp.at((i + 0.5) / pieces) * 100) / 100));
    // As long as its footage lasts at that speed, and never a frame more than the footage has.
    const duration = Math.max(1, Math.floor(footage / speed + 1e-9));
    const piece: Record<string, unknown> = { ...structuredClone(clip), id: i === 0 ? clip.id : ids(), start: at, duration, in: clip.in + from, speed, group };
    // A way in belongs to the first piece and a way out to the last; the cuts between pieces are plain.
    if (i > 0) for (const key of ["transitionIn", "fadeIn"]) delete piece[key];
    if (i < pieces - 1) for (const key of ["transitionOut", "fadeOut"]) delete piece[key];
    // Keyframes count from each clip's own start: the pieces carry on where the one before left off.
    if (clip.keyframes) piece.keyframes = Object.fromEntries(Object.entries(clip.keyframes).map(([prop, list]) => [prop, list?.map((k) => ({ ...k, at: k.at - (at - clip.start) }))]));
    made.push(piece);
    at += duration;
    from += Math.round(duration * speed);
  }
  const by = at - (clip.start + clip.duration);
  const later = track.clips.filter((c) => c.id !== clip.id && c.start >= clip.start + clip.duration).sort((a, b) => a.start - b.start);
  const shift = (order: typeof later): OpInput[] => order.map((c) => ({ op: "move_clip", clipId: c.id, start: c.start + by }));
  const add: OpInput[] = made.map((piece) => ({ op: "add_clip", trackId: track.id, clip: piece }) as OpInput);
  const remove: OpInput = { op: "remove_clip", clipId: clip.id };
  // Longer: what follows makes room first, the last clip going first. Shorter: the pieces go in, then what follows closes up.
  const ops = by > 0 ? [...shift([...later].reverse()), remove, ...add] : [remove, ...add, ...(by < 0 ? shift(later) : [])];
  return { ok: true, ops, clipIds: made.map((piece) => piece.id as string) };
}
