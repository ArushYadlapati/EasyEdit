import type { Cutter, CutoutProgress } from "@/lib/media/cutout/client";
import { CutoutError } from "@/lib/media/cutout/client";
import { cutoutName } from "@/lib/media/cutout/protocol";
import type { AssetView, UploadItem } from "@/lib/media/types";
import { MESSAGES, explainOpError } from "./messages";
import { findClip, type EditorStore } from "./store";

// Remove background: an image clip's picture is cut out (the person kept, the background see-through), the cut-out
// is uploaded as a picture of its own, and the clip is switched to it, as one change. The first picture stays in the
// library, so an undo, or the library, brings it back.

export type CutoutStep = { stage: "reading" } | { stage: "model" | "cutting"; done: number; total: number } | { stage: "uploading" };

export type CutoutDeps = {
  store: EditorStore;
  asset(assetId: string): AssetView | undefined;
  readFile(fileId: string): Promise<Blob | null>;
  cutter: Cutter;
  upload(file: File): string | null; // the upload's row key; null when nothing takes uploads here
  // The new picture's id once it is in the library and ready; null when its upload failed or was cancelled.
  uploaded(key: string, signal: AbortSignal): Promise<string | null>;
};

// The library's part of `uploaded`: what an upload's row and the library say about it now. undefined: not yet.
export function uploadOutcome(state: { uploads: readonly UploadItem[]; assets: Readonly<Record<string, AssetView>> }, key: string): string | null | undefined {
  const row = state.uploads.find((item) => item.key === key);
  if (!row) return null; // the row was cancelled or dismissed before it finished
  if (row.stage === "failed") return null;
  if (row.assetId === null) return undefined;
  const asset = state.assets[row.assetId];
  return asset && asset.status === "ready" && asset.originalFileId !== null ? row.assetId : undefined;
}

const FAILURE: Record<string, string> = {
  undecodable: MESSAGES.cutoutUnreadable,
  model: MESSAGES.cutoutModel,
  nothing: MESSAGES.cutoutNothing,
  unknown: MESSAGES.cutoutFailed,
};

// Cuts the background out of an image clip's picture and switches the clip to the cut-out. Says how it ended in a
// notice; resolves whatever happened.
export async function cutOutClip(deps: CutoutDeps, clipId: string, opts: { signal: AbortSignal; onStep?(step: CutoutStep): void }): Promise<void> {
  const { store } = deps;
  const start = store.getState();
  const found = findClip(start.doc, clipId);
  if (!start.canEdit || !found || found.clip.type !== "image") return;
  if (found.track.locked) return start.notify("error", explainOpError("TRACK_LOCKED"));
  const before = found.clip;
  const asset = deps.asset(before.assetId);
  if (!asset || asset.removed || asset.status !== "ready" || asset.originalFileId === null) return start.notify("error", MESSAGES.cutoutUnreadable);

  opts.onStep?.({ stage: "reading" });
  const picture = await deps.readFile(asset.originalFileId).catch(() => null);
  if (opts.signal.aborted) return;
  if (!picture) return store.getState().notify("error", MESSAGES.cutoutUnreadable);

  let png: Blob;
  try {
    const cut = await deps.cutter.cut(picture, { signal: opts.signal, onProgress: (p: CutoutProgress) => opts.onStep?.(p) });
    png = cut.png;
  } catch (error) {
    if (error instanceof CutoutError && error.code === "cancelled") return;
    return store.getState().notify("error", (error instanceof CutoutError && FAILURE[error.code]) || MESSAGES.cutoutFailed);
  }

  opts.onStep?.({ stage: "uploading" });
  const key = deps.upload(new File([png], cutoutName(asset.name || asset.fileName), { type: "image/png" }));
  if (key === null) return store.getState().notify("error", MESSAGES.cutoutNoStorage);
  const assetId = await deps.uploaded(key, opts.signal);
  if (opts.signal.aborted) return;
  if (assetId === null) return store.getState().notify("error", MESSAGES.cutoutUploadFailed);

  // The project may have changed while this ran: only a clip that still shows the same picture is switched.
  const state = store.getState();
  const now = findClip(state.doc, clipId);
  if (!state.canEdit || !now || now.track.locked || now.clip.type !== "image" || now.clip.assetId !== before.assetId) return state.notify("info", MESSAGES.cutoutInLibrary);
  const result = state.edit([{ op: "update_clip", clipId, patch: { assetId } }], "remove background");
  state.notify(result.ok ? "info" : "error", result.ok ? MESSAGES.cutoutDone : result.message);
}
