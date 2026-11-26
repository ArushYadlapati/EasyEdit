import type { MediaClip, OpInput, TimelineDoc, Track } from "@/lib/timeline";
import { soundClipsOf } from "./sound";

// Sync by sound: which clip stays, and the ops that put another where its sound lines up. Pure builders.

type Sounding = { track: Track; clip: MediaClip };

// Of the selected clips that sound and play forward as recorded, the one that stays where it is and the ones that
// move to it. The first video stays (the picture is what the rest is cut to); with no video, the earliest clip.
// skipped: selected sounding clips left out for playing at another speed or backward. Null with fewer than two.
export function syncPlan(doc: TimelineDoc, clipIds: string[]): { stays: Sounding; moves: Sounding[]; skipped: number } | null {
  const all = soundClipsOf(doc, clipIds);
  const usable = all.filter(({ clip }) => clip.speed === 1);
  if (usable.length < 2) return null;
  const byStart = [...usable].sort((a, b) => a.clip.start - b.clip.start);
  const stays = byStart.find(({ clip }) => clip.type === "video") ?? byStart[0];
  return { stays, moves: usable.filter((s) => s !== stays), skipped: all.length - usable.length };
}

// The ops that start a clip at `start`. A start before the timeline's own is the clip's later part, from frame 0:
// what would fall before it is trimmed off. [] when it is already there; null when none of it would be left.
export function placeAtOps(clip: MediaClip, start: number): OpInput[] | null {
  if (start === clip.start) return [];
  if (start >= 0) return [{ op: "move_clip", clipId: clip.id, start }];
  const cut = -start;
  if (cut >= clip.duration) return null;
  return [
    { op: "trim_clip", clipId: clip.id, edge: "start", to: clip.start + cut },
    { op: "move_clip", clipId: clip.id, start: 0 },
  ];
}
