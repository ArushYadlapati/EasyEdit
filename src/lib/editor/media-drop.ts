import { createStore, type StoreApi } from "zustand/vanilla";
import type { LibraryStore } from "@/lib/media/library-store";
import type { AssetView } from "@/lib/media/types";
import type { UploadQueue } from "@/lib/media/upload-queue";
import type { EditorStore } from "./store";

// The type a library item of this page carries while it is dragged; its data is the asset's id. Lower case, as
// browsers lower-case drag types.
export const ASSET_DRAG_TYPE = "application/x-easyedit-asset";

// What a drag carries: files from the computer, a library item of this page, one of another tab (whose asset this
// page does not hold), or something else.
export type DragKind = "files" | "asset" | "foreign-asset" | null;

// One rule for the window, the timeline and the board. hasAsset: a library item's drag began in this page.
export function dragKind(types: readonly string[], hasAsset: boolean): DragKind {
  if (types.includes(ASSET_DRAG_TYPE)) return hasAsset ? "asset" : "foreign-asset";
  if (types.includes("Files")) return "files";
  return null;
}

// Whether a drag carries files, and not text or a part of the page.
export function carriesFiles(types: readonly string[]): boolean {
  return types.includes("Files");
}

// What is dragged over the editor, for an editor only.
export type Incoming = "files" | "asset" | null;
// asset: the library item whose drag began in this page, kept until that drag ends.
export type MediaDropState = { incoming: Incoming; asset: AssetView | null };

export type MediaDrop = {
  state: StoreApi<MediaDropState>;
  setIncoming(incoming: Incoming): void;
  startAssetDrag(asset: AssetView): void;
  endAssetDrag(): void;
  start(): () => void; // watches the editor; the function it returns stops that
};

// File and library drags for one open editor. The window's watcher says what is coming in; the panels read it to show
// where a drop would go. Each change is set only when it is one, so nothing re-renders for the many dragover events.
export function createMediaDrop(deps: { store: EditorStore; library: LibraryStore; queue: Pick<UploadQueue, "add"> }): MediaDrop {
  const state = createStore<MediaDropState>(() => ({ incoming: null, asset: null }));

  const drop: MediaDrop = {
    state,
    setIncoming(incoming) {
      if (state.getState().incoming !== incoming) state.setState({ incoming });
    },
    startAssetDrag(asset) {
      if (state.getState().asset !== asset) state.setState({ asset });
    },
    endAssetDrag() {
      if (state.getState().asset !== null) state.setState({ asset: null });
    },
    start() {
      // Someone who can no longer edit, or a project that is gone, takes no drop: what was coming in is forgotten.
      return deps.store.subscribe((editor) => {
        if (editor.canEdit && editor.status !== "deleted") return;
        drop.setIncoming(null);
        drop.endAssetDrag();
      });
    },
  };
  return drop;
}
