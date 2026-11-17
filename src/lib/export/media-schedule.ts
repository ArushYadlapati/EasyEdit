import { crossfadeFrames, crossfadeInto } from "@/lib/render/compositor";
import { sourceSeconds } from "@/lib/render/source-time";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { mayShow } from "@/lib/timeline/keyframes";

// Which moment of which file each drawn clip of an export needs at each frame, and the last frame each file is used,
// so the worker knows when to open a decoder and when it may let go of it.

export type ClipMedia = { fileId: string } | { label: string }; // the file a clip draws from, or its placeholder's text

export type ScheduledClip = {
  clipId: string;
  kind: "video" | "image";
  fileId: string;
  start: number; // the first timeline frame it draws
  end: number; // the frame after its last
  seconds: number[]; // a video's moment for each frame start … end − 1; empty for an image
};

export type MediaSchedule = { clips: ScheduledClip[]; lastUse: Record<string, number> }; // lastUse: fileId → the last frame any clip of it draws

// Every video or image clip that draws a picture from a file, in the compositor's drawing order: tracks in order, each
// track's clips in order. A clip on a hidden track, invisible for its whole length, shown as a placeholder or with no
// entry draws none. A clip the next one crossfades in from draws on under it for the crossfade's length, its moments
// running on past its out point.
export function mediaSchedule(doc: TimelineDoc, clips: Record<string, ClipMedia>): MediaSchedule {
  const scheduled: ScheduledClip[] = [];
  const lastUse: Record<string, number> = {};
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.type !== "video" && clip.type !== "image") continue;
      if (!mayShow(clip)) continue;
      const media = clips[clip.id];
      if (!media || !("fileId" in media)) continue;
      const into = crossfadeInto(track, clip);
      const start = clip.start;
      const end = clip.start + clip.duration + (into ? crossfadeFrames(track, into) : 0);
      const seconds = clip.type === "video" ? Array.from({ length: end - start }, (_, i) => sourceSeconds(clip, start + i, doc.fps)) : [];
      scheduled.push({ clipId: clip.id, kind: clip.type, fileId: media.fileId, start, end, seconds });
      lastUse[media.fileId] = Math.max(lastUse[media.fileId] ?? -1, end - 1);
    }
  }
  return { clips: scheduled, lastUse };
}

// The text of a clip's placeholder in the export: its own label when it has one, else the compositor's default.
export function exportPlaceholderLabel(clips: Record<string, ClipMedia>): (clip: MediaClip) => string {
  return (clip) => {
    const media = clips[clip.id];
    if (media && "label" in media) return media.label;
    return clip.type === "video" ? "Video" : "Image";
  };
}
