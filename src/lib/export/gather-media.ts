import type { LibraryState } from "@/lib/media/library-store";
import type { TimelineDoc } from "@/lib/timeline";
import { exportAssetIds, jobClips, jobSounds, planExportMedia, type ExportMediaPlan } from "./media-sources";
import { ExportError } from "./messages";
import type { ExportMedia } from "./protocol";

// Reads the files an export draws and sounds from, each once, with progress. Runs on the page, before the worker
// starts. It never waits for the media library: the export dialog does that, and a caller without the dialog must too.

export type ExportMediaDeps = {
  library(): Pick<LibraryState, "assets" | "loaded">;
  ensure(ids: string[]): Promise<void>; // asks the server for asset ids the library has not seen; rejects when it got no answer
  readFile(fileId: string): Promise<Blob | null>; // null: it could not be read (offline, missing, refused)
  // Whether this browser can draw a video file's pictures as they should look: asked of originals only. Without it
  // every original counts as one it can.
  decodable?(file: Blob): Promise<boolean>;
};

export type MediaOptions = {
  signal: AbortSignal;
  onReading(filesRead: number, totalFiles: number): void;
  sound: boolean; // the file will carry a sound track: only then is sound asked for, waited for and read
  originals?: boolean; // full quality: each video's picture from its original file, where this browser can read it
};

const canceled = () => new DOMException("The export was canceled.", "AbortError");

// The first clip that cannot be exported yet, the pictures in drawing order and then the sounds: media still uploading
// or being prepared comes first, then an asset the library does not know because it never loaded. Save frame refuses
// the same way, from a plan without sound.
export function refuseWaiting(plan: ExportMediaPlan): void {
  const waiting = [...Object.entries(plan.clips), ...Object.entries(plan.sounds)].filter(([, clip]) => clip.kind === "wait");
  const preparing = waiting.find(([, clip]) => clip.kind === "wait" && clip.why !== "library");
  if (preparing) throw new ExportError("waiting", preparing[0]);
  if (waiting.length > 0) throw new ExportError("media", waiting[0][0]);
}

export async function gatherMedia(doc: TimelineDoc, deps: ExportMediaDeps, options: MediaOptions): Promise<ExportMedia> {
  const ids = exportAssetIds(doc, options.sound);
  if (ids.length > 0) {
    // An asset the server could not be asked about is a file that cannot be read, never a "Media not found".
    try {
      await deps.ensure(ids);
    } catch (error) {
      throw new ExportError("media", error instanceof Error ? error.message : String(error));
    }
  }

  const plan = planExportMedia(doc, deps.library(), options.sound, options.originals);
  refuseWaiting(plan);

  // Each original's preview copy, for an original that cannot be read or drawn here.
  const fallbacks = new Map<string, string>();
  for (const clip of Object.values(plan.clips)) if (clip.kind === "use" && clip.fallback) fallbacks.set(clip.fileId, clip.fallback);

  const files: Record<string, Blob> = {};
  const total = plan.fileIds.length;
  for (const [index, fileId] of plan.fileIds.entries()) {
    if (options.signal.aborted) throw canceled();
    options.onReading(index, total);
    if (files[fileId]) continue; // already read as another file's copy
    const file = await deps.readFile(fileId);
    const copy = fallbacks.get(fileId);
    if (copy !== undefined && (file === null || !(await (deps.decodable?.(file) ?? true)))) {
      // This one exports from its copy, as it would without full quality.
      if (!files[copy]) {
        const read = await deps.readFile(copy);
        if (read === null) throw new ExportError("media", copy);
        files[copy] = read;
      }
      for (const clip of Object.values(plan.clips)) {
        if (clip.kind === "use" && clip.fileId === fileId) Object.assign(clip, { fileId: copy, from: "preview", fallback: undefined });
      }
      continue;
    }
    if (file === null) throw new ExportError("media", fileId);
    files[fileId] = file;
  }
  if (total > 0) options.onReading(total, total);

  return { files, clips: jobClips(plan), sounds: jobSounds(plan) };
}
