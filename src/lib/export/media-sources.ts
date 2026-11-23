import { PLACEHOLDER_LABELS, playbackFileFor } from "@/lib/media/playback";
import type { LibraryState } from "@/lib/media/library-store";
import { soundingClips } from "@/lib/render/clip-sound";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { mayShow } from "@/lib/timeline/keyframes";
import type { ClipMedia } from "./media-schedule";

// Which file each clip of an export draws from and sounds from: the one the editor plays, or why it must wait, or the
// preview's placeholder. Runs on the page, before the worker starts.

// fallback: for a video drawn from its original at full quality, the preview copy to draw from instead when this
// browser cannot read the original.
export type ClipPlan =
  | { kind: "use"; fileId: string; from: "preview" | "original"; fallback?: string }
  | { kind: "wait"; why: "uploading" | "preparing" | "library" } // library: the asset is not known yet and the library has not loaded
  | { kind: "placeholder"; label: string }; // a PLACEHOLDER_LABELS text

type Library = Pick<LibraryState, "assets" | "loaded">;

export type ExportMediaPlan = {
  clips: Record<string, ClipPlan>; // every clip that draws media
  sounds: Record<string, ClipPlan>; // every clip that sounds, from the same files as pictures; {} unless sound was asked for
  soundClips: number; // the clips that would sound, asked or not: none whose file has no sound, none with no media
  fileIds: string[]; // each file once: the pictures' in drawing order, then the sounds' not yet listed, in document order
};

// The video and image clips that draw, in drawing order: tracks in order, each track's clips in order. A clip on a
// hidden track or invisible for its whole length draws nothing; audio is not drawn.
function drawnMediaClips(doc: TimelineDoc): MediaClip[] {
  const clips: MediaClip[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.type !== "video" && clip.type !== "image") continue;
      if (!mayShow(clip)) continue;
      clips.push(clip);
    }
  }
  return clips;
}

// The assets of the clips that draw, each once, in the order the timeline first uses them; then, with sound, those of
// the clips that sound and are not listed yet.
export function exportAssetIds(doc: TimelineDoc, sound = false): string[] {
  const drawn = drawnMediaClips(doc).map((clip) => clip.assetId);
  const heard = sound ? soundingClips(doc).map(({ clip }) => clip.assetId) : [];
  return [...new Set([...drawn, ...heard])];
}

// originals: a video's picture comes from its original file, where it has a preview copy to fall back on. Without a
// copy the original is what plays already.
function planClip(clip: MediaClip, library: Library, originals = false): ClipPlan {
  const asset = library.assets[clip.assetId];
  if (asset === undefined && !library.loaded) return { kind: "wait", why: "library" };
  const file = playbackFileFor(asset);
  if (originals && clip.type === "video" && file.fileId !== null && file.from === "preview" && asset?.originalFileId) {
    return { kind: "use", fileId: asset.originalFileId, from: "original", fallback: file.fileId };
  }
  if (file.fileId !== null) return { kind: "use", fileId: file.fileId, from: file.from };
  if (file.why === "uploading" || file.why === "preparing") return { kind: "wait", why: file.why };
  return { kind: "placeholder", label: PLACEHOLDER_LABELS[file.why] };
}

// The preview's rule for every clip that draws: it plays these files and shows these labels. A removed or missing
// asset is drawn as its placeholder, never refused. With sound (an export whose file can carry a sound track), the
// same rule for every clip that sounds; Save frame and thumbnails leave it out. A file the library says has no sound
// is not heard; one it says has sound may still be silent, and the worker finds that out. originals: full quality, where
// each video's picture is drawn from its original file; its sound still comes from the file the editor plays.
export function planExportMedia(doc: TimelineDoc, library: Library, sound = false, originals = false): ExportMediaPlan {
  const clips: Record<string, ClipPlan> = {};
  const sounds: Record<string, ClipPlan> = {};
  const fileIds = new Set<string>();
  for (const clip of drawnMediaClips(doc)) {
    const plan = planClip(clip, library, originals);
    clips[clip.id] = plan;
    if (plan.kind === "use") fileIds.add(plan.fileId);
  }
  // A clip with no media is silent in the preview too, so it is not one that would sound.
  let soundClips = 0;
  for (const { clip } of soundingClips(doc)) {
    if (library.assets[clip.assetId]?.hasAudio === false) continue;
    const plan = planClip(clip, library);
    if (plan.kind !== "placeholder") soundClips += 1;
    if (!sound) continue;
    sounds[clip.id] = plan;
    if (plan.kind === "use") fileIds.add(plan.fileId);
  }
  return { clips, sounds, soundClips, fileIds: [...fileIds] };
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

// What the worker is told about each clip's sound: the file it sounds from. Only clips with a file are told; one with
// no media is silent.
export function jobSounds(plan: ExportMediaPlan): Record<string, string> {
  const sounds: Record<string, string> = {};
  for (const [clipId, clip] of Object.entries(plan.sounds)) {
    if (clip.kind === "use") sounds[clipId] = clip.fileId;
  }
  return sounds;
}
