import type { LibraryState } from "@/lib/media/library-store";
import type { TimelineDoc } from "@/lib/timeline";
import { exportAssetIds, jobClips, planExportMedia, type ExportMediaPlan } from "./media-sources";
import { ExportError } from "./messages";
import type { ExportMedia } from "./protocol";

// Reads the files an export draws from, each once, with progress. Runs on the page, before the worker starts. It
// never waits for the media library: the export dialog does that, and a caller without the dialog must too.

export type ExportMediaDeps = {
  library(): Pick<LibraryState, "assets" | "loaded">;
  ensure(ids: string[]): Promise<void>; // asks the server for asset ids the library has not seen; rejects when it got no answer
  readFile(fileId: string): Promise<Blob | null>; // null: it could not be read (offline, missing, refused)
};

export type MediaOptions = { signal: AbortSignal; onReading(filesRead: number, totalFiles: number): void };

const canceled = () => new DOMException("The export was canceled.", "AbortError");

// The first clip, in drawing order, that cannot be exported yet: media still uploading or being prepared comes
// first, then an asset the library does not know because it never loaded. Save frame refuses the same way.
export function refuseWaiting(plan: ExportMediaPlan): void {
  const waiting = Object.entries(plan.clips).filter(([, clip]) => clip.kind === "wait");
  const preparing = waiting.find(([, clip]) => clip.kind === "wait" && clip.why !== "library");
  if (preparing) throw new ExportError("waiting", preparing[0]);
  if (waiting.length > 0) throw new ExportError("media", waiting[0][0]);
}

export async function gatherMedia(doc: TimelineDoc, deps: ExportMediaDeps, options: MediaOptions): Promise<ExportMedia> {
  const ids = exportAssetIds(doc);
  if (ids.length > 0) {
    // An asset the server could not be asked about is a file that cannot be read, never a "Media not found".
    try {
      await deps.ensure(ids);
    } catch (error) {
      throw new ExportError("media", error instanceof Error ? error.message : String(error));
    }
  }

  const plan = planExportMedia(doc, deps.library());
  refuseWaiting(plan);

  const files: Record<string, Blob> = {};
  const total = plan.fileIds.length;
  for (const [index, fileId] of plan.fileIds.entries()) {
    if (options.signal.aborted) throw canceled();
    options.onReading(index, total);
    const file = await deps.readFile(fileId);
    if (file === null) throw new ExportError("media", fileId);
    files[fileId] = file;
  }
  if (total > 0) options.onReading(total, total);

  return { files, clips: jobClips(plan) };
}
