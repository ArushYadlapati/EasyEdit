import { mediaWants } from "@/lib/editor/media-plan";
import type { LibraryState } from "@/lib/media/library-store";
import { playbackFileFor, posterFileFor } from "@/lib/media/playback";
import { activeClips } from "@/lib/render/compositor";
import { thumbnailFrame } from "@/lib/render/thumbnail-frame";
import type { TimelineDoc } from "@/lib/timeline";

export const THUMBNAIL_LONG_SIDE = 640;
export const THUMBNAIL_QUALITY = 0.8;
export const THUMBNAIL_SOURCE_MAX_SIDE = 1280; // a picture is decoded no larger than this on its long side

// The picture's size: the project's shape, THUMBNAIL_LONG_SIDE on its long side, so a smaller project is scaled up.
export function thumbnailSize(doc: { width: number; height: number }): { width: number; height: number } {
  const k = THUMBNAIL_LONG_SIDE / Math.max(doc.width, doc.height);
  return { width: Math.max(1, Math.round(doc.width * k)), height: Math.max(1, Math.round(doc.height * k)) };
}

// One picture the frame needs. fileId: the file to decode, or null to draw the still. stillId: the asset's library
// still, the fallback when the file cannot be read or decoded.
export type ThumbnailSource = { clipId: string; kind: "video" | "image"; fileId: string | null; seconds: number; stillId: string | null };
export type ThumbnailPlan =
  | { kind: "draw"; frame: number; sources: ThumbnailSource[] }
  | { kind: "wait" } // shown media is uploading or having its preview made, or the library has not loaded
  | { kind: "skip" }; // shown media was removed or is missing, or has neither a file nor a still

// What drawing the thumbnail needs, settled before anything is read: each picture under its frame, or why it cannot
// be drawn yet (wait) or at all (skip). Every picture is looked at, so a skip anywhere wins over a wait anywhere.
export function planThumbnail(doc: TimelineDoc, library: Pick<LibraryState, "assets" | "loaded">): ThumbnailPlan {
  const frame = thumbnailFrame(doc);
  const seconds = new Map(mediaWants(doc, frame, { playing: false, rate: 1 }).map((want) => [want.clipId, want.seconds]));
  const sources: ThumbnailSource[] = [];
  let wait = false;
  let skip = false;
  for (const { clip } of activeClips(doc, frame)) {
    if (clip.type !== "video" && clip.type !== "image") continue;
    const asset = library.assets[clip.assetId];
    if (asset === undefined && !library.loaded) {
      wait = true;
      continue;
    }
    const file = playbackFileFor(asset);
    const stillId = posterFileFor(asset);
    if (file.fileId !== null) {
      sources.push({ clipId: clip.id, kind: clip.type, fileId: file.fileId, seconds: seconds.get(clip.id) ?? 0, stillId });
    } else if (file.why === "uploading" || file.why === "preparing") {
      wait = true;
    } else if (file.why === "no-preview" && stillId !== null) {
      sources.push({ clipId: clip.id, kind: clip.type, fileId: null, seconds: seconds.get(clip.id) ?? 0, stillId });
    } else {
      skip = true;
    }
  }
  if (skip) return { kind: "skip" };
  if (wait) return { kind: "wait" };
  return { kind: "draw", frame, sources };
}
