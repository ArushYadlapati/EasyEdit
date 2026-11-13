import { PLACEHOLDER_LABELS, playbackFileFor } from "@/lib/media/playback";
import type { LibraryState } from "@/lib/media/library-store";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import type { ClipMedia } from "./media-schedule";

// Which file each clip of an export draws from: the one the editor plays, or why it must wait, or the preview's
// placeholder. Runs on the page, before the worker starts.

export type ClipPlan =
  | { kind: "use"; fileId: string; from: "preview" | "original" }
  | { kind: "wait"; why: "uploading" | "preparing" | "library" } // library: the asset is not known yet and the library has not loaded
  | { kind: "placeholder"; label: string }; // a PLACEHOLDER_LABELS text

export type ExportMediaPlan = {
  clips: Record<string, ClipPlan>; // every clip that draws media
  fileIds: string[]; // each file once, in the order the timeline first uses it
};

// The video and image clips that draw, in drawing order: tracks in order, each track's clips in order. A clip on a
// hidden track or at opacity 0 draws nothing; audio is not drawn.
function drawnMediaClips(doc: TimelineDoc): MediaClip[] {
  const clips: MediaClip[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.type !== "video" && clip.type !== "image") continue;
      if (clip.transform.opacity <= 0) continue;
      clips.push(clip);
    }
  }
  return clips;
}

// The assets of the clips that draw, each once, in the order the timeline first uses them.
export function exportAssetIds(doc: TimelineDoc): string[] {
  return [...new Set(drawnMediaClips(doc).map((clip) => clip.assetId))];
}

function planClip(clip: MediaClip, library: Pick<LibraryState, "assets" | "loaded">): ClipPlan {
  const asset = library.assets[clip.assetId];
  if (asset === undefined && !library.loaded) return { kind: "wait", why: "library" };
  const file = playbackFileFor(asset);
  if (file.fileId !== null) return { kind: "use", fileId: file.fileId, from: file.from };
  if (file.why === "uploading" || file.why === "preparing") return { kind: "wait", why: file.why };
  return { kind: "placeholder", label: PLACEHOLDER_LABELS[file.why] };
}

// The preview's rule for every clip that draws: it plays these files and shows these labels. A removed or missing
// asset is drawn as its placeholder, never refused.
export function planExportMedia(doc: TimelineDoc, library: Pick<LibraryState, "assets" | "loaded">): ExportMediaPlan {
  const clips: Record<string, ClipPlan> = {};
  const fileIds = new Set<string>();
  for (const clip of drawnMediaClips(doc)) {
    const plan = planClip(clip, library);
    clips[clip.id] = plan;
    if (plan.kind === "use") fileIds.add(plan.fileId);
  }
  return { clips, fileIds: [...fileIds] };
}

// What the worker is told about each clip: its file, or its placeholder's text. A waiting clip is left out.
export function jobClips(plan: ExportMediaPlan): Record<string, ClipMedia> {
  const clips: Record<string, ClipMedia> = {};
  for (const [clipId, clip] of Object.entries(plan.clips)) {
    if (clip.kind === "use") clips[clipId] = { fileId: clip.fileId };
    else if (clip.kind === "placeholder") clips[clipId] = { label: clip.label };
  }
  return clips;
}
