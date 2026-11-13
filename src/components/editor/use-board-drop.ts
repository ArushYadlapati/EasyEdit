"use client";

import { useMemo, useState, type DOMAttributes } from "react";
import { addMedia } from "@/lib/editor/actions";
import { ASSET_DRAG_TYPE, dragKind } from "@/lib/editor/media-drop";
import { useEditorStore, useSettingsStore } from "./context";
import { useMedia, useMediaDrop, useMediaDropState } from "./media/media-context";

type Handlers = Pick<DOMAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">;

// Files and library items dropped on the board: the frame and the empty board around it. Whatever the pointer is
// over, they land at the playhead as it is at the drop, on the selected track when it takes them, and stay centred in
// the frame, so there is no position to show: over is only whether the board would take what is over it. Files are
// taken by an editor of a project that is still there, with uploads set up, and land unselected once each is in, end
// to end; a library item does what a click on it does and is selected. A text drag is left alone, so it still drops
// into the text typed in place. Without a MediaDrop nothing is taken.
export function useBoardDrop(): { over: boolean; handlers: Handlers } {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const { library } = useMedia();
  const drop = useMediaDrop();
  const [hovering, setHovering] = useState(false);
  // Nothing coming in any more (dropped elsewhere, ended, gone idle) ends the look too.
  const incoming = useMediaDropState((s) => s.incoming, null);

  const handlers = useMemo((): Handlers => {
    const takesFiles = () => {
      const { canEdit, status } = store.getState();
      return canEdit && status !== "deleted" && library.getState().setUp;
    };
    return {
      onDragOver(e) {
        if (!drop) return;
        const kind = dragKind([...e.dataTransfer.types], drop.state.getState().asset !== null);
        if (kind === null) return;
        e.preventDefault();
        const takes = kind === "files" ? takesFiles() : kind === "asset" && store.getState().canEdit;
        e.dataTransfer.dropEffect = takes ? "copy" : "none";
        setHovering(takes);
      },
      onDragLeave(e) {
        const to = e.relatedTarget;
        if (to instanceof Node && e.currentTarget.contains(to)) return;
        setHovering(false);
      },
      onDrop(e) {
        if (!drop) return;
        const types = [...e.dataTransfer.types];
        const kind = dragKind(types, drop.state.getState().asset !== null);
        if (kind === null) return;
        // Taken here whatever it is, so the window does not send files to the library as well.
        e.preventDefault();
        setHovering(false);
        const state = store.getState();
        const { stillSeconds } = settings.getState();
        if (kind === "files") {
          const files = [...e.dataTransfer.files];
          if (!takesFiles() || files.length === 0) return;
          drop.dropFiles(files, { frame: state.playhead, trackId: state.selection.trackId }, { stillSeconds });
          return;
        }
        if (kind !== "asset") return;
        // Exactly a click: at the playhead, on the selected track when it takes it, selected; nothing for a viewer.
        const { assets } = library.getState();
        const id = e.dataTransfer.getData(ASSET_DRAG_TYPE);
        const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
        if (asset) addMedia(store, asset, { stillSeconds });
      },
    };
  }, [drop, library, settings, store]);

  return { over: hovering && incoming !== null, handlers };
}
