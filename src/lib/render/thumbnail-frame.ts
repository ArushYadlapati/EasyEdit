import type { Clip, TimelineDoc } from "@/lib/timeline";
import { mayShow } from "@/lib/timeline/keyframes";
import { expandNests } from "@/lib/timeline/nest";

// A clip that puts something in the picture: a video, image or text clip visible at some point (a fade in from
// opacity 0 counts), and text that is not blank.
function shows(clip: Clip): boolean {
  if (clip.type === "audio" || clip.type === "placeholder" || !mayShow(clip)) return false;
  return clip.type !== "text" || clip.text.trim() !== "";
}

// The frame a project's thumbnail shows: one second into the earliest clip that shows anything on a shown track, or
// the middle of that clip when it is shorter than two seconds. A tie goes to the first in track order, then clip
// order. Frame 0 when nothing shows.
export function thumbnailFrame(doc: TimelineDoc): number {
  let first: Clip | null = null;
  for (const track of expandNests(doc).tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (shows(clip) && (first === null || clip.start < first.start)) first = clip;
    }
  }
  if (first === null) return 0;
  return first.start + Math.min(doc.fps, Math.floor(first.duration / 2));
}
