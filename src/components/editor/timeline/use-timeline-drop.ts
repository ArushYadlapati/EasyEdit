"use client";

import { useEffect, useMemo, useState, type DOMAttributes } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { addMedia, fillPlaceholder, placeholderTakes } from "@/lib/editor/actions";
import type { TimelinePoint } from "@/lib/editor/geometry";
import { mediaClipFor } from "@/lib/editor/media-clips";
import { ASSET_DRAG_TYPE, carriesFiles, dragKind, dropTrack } from "@/lib/editor/media-drop";
import { placeClips } from "@/lib/editor/placement";
import { clipEdges, snap } from "@/lib/editor/snap";
import type { EditorState } from "@/lib/editor/store";
import type { AssetView } from "@/lib/media/types";
import { useEditorStore, useSettingsStore } from "../context";
import { useMedia, useMediaDrop } from "../media/media-context";
import type { TimelineDrag } from "./use-clip-drag";

// Where a drag would land: the row it is shown on (null: below the last row or over the ruler), its first frame and its
// length (null: a line, for files and for an item with no length), and the snap target when it snapped.
export type DropHover = { trackId: string | null; start: number; duration: number | null; guide: number | null };

type Handlers = Pick<DOMAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">;

// A clip of the item, as addMedia makes it: a still image lasts stillSeconds. Null when it has no length.
function clipOf(asset: AssetView, start: number, fps: number, stillSeconds: number) {
  return mediaClipFor(asset, start, fps, { durationSeconds: asset.kind === "image" ? stillSeconds : undefined });
}

// The drop frame: the point's frame, with the item's start or end snapped to a clip edge (or the playhead, or a whole
// second, as a dragged clip does) when snapping is on. A snap that would start it before frame 0 is not taken.
function landingFrame(state: EditorState, at: TimelinePoint, length: number | null): { frame: number; guide: number | null } {
  if (!state.snapping) return { frame: at.frame, guide: null };
  const candidates = length === null ? [at.frame] : [at.frame, at.frame + length];
  const hit = snap(candidates, { edges: clipEdges(state.doc, []), playhead: state.playhead, fps: state.doc.fps, zoom: state.zoom });
  if (!hit || at.frame + hit.delta < 0) return { frame: at.frame, guide: null };
  return { frame: at.frame + hit.delta, guide: hit.guide };
}

// The box for an item dropped at this point: on the row placement would really put it, or on the hovered row when it
// would make a new track.
function hoverFor(state: EditorState, at: TimelinePoint, asset: AssetView, stillSeconds: number): DropHover {
  const { doc } = state;
  // Over an empty slot that takes it, the item would fill the slot: the box is the slot's own span on its row.
  const slot = at.trackId === null ? undefined : doc.tracks.find((t) => t.id === at.trackId)?.clips.find((c) => at.frame >= c.start && at.frame < c.start + c.duration);
  if (slot && placeholderTakes(slot, asset)) return { trackId: at.trackId, start: slot.start, duration: slot.duration, guide: null };
  const clip = clipOf(asset, at.frame, doc.fps, stillSeconds);
  const { frame, guide } = landingFrame(state, at, clip?.duration ?? null);
  if (!clip) return { trackId: at.trackId, start: frame, duration: null, guide };
  const placement = placeClips(doc, [{ clip: { ...clip, start: frame, id: "new" }, trackId: dropTrack(doc, at.trackId, clip.type) }], () => "hover");
  const added = placement.ok ? placement.ops.find((op) => op.op === "add_clip") : undefined;
  const placed = added?.op === "add_clip" && doc.tracks.some((t) => t.id === added.trackId) ? added.trackId : at.trackId;
  return { trackId: placed, start: frame, duration: clip.duration, guide };
}

const sameHover = (a: DropHover | null, b: DropHover | null) =>
  a === b || (a !== null && b !== null && a.trackId === b.trackId && a.start === b.start && a.duration === b.duration && a.guide === b.guide);

// Library items and files dragged onto the timeline. The handlers go on the scrolling area: the ruler, the rows and the
// space below them. While an item of this page is over it, hover is the box of its length where it would land; while
// files are, a line at the frame where they would start on the row under the pointer (their lengths are not known
// before the drop). Files are taken only by an editor of a project that is still there, with uploads set up; anyone
// else is told no drop is taken here. A drop works from its own event: the item is the one its data names, the files
// the ones it carries, the place where it is let go.
export function useTimelineDrop(drag: TimelineDrag | null): { hover: StoreApi<DropHover | null>; handlers: Handlers } {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const { library } = useMedia();
  const drop = useMediaDrop();
  const [hover] = useState(() => createStore<DropHover | null>(() => null));

  // Nothing coming in any more (dropped elsewhere, ended, gone idle): no box.
  useEffect(() => {
    if (!drop) return;
    return drop.state.subscribe((next) => {
      if (next.incoming === null && hover.getState() !== null) hover.setState(null, true);
    });
  }, [drop, hover]);

  const handlers = useMemo((): Handlers => {
    const show = (next: DropHover | null) => {
      if (!sameHover(hover.getState(), next)) hover.setState(next, true);
    };
    const takesFiles = () => {
      const { canEdit, status } = store.getState();
      return canEdit && status !== "deleted" && library.getState().setUp;
    };
    return {
      onDragOver(e) {
        if (!drop || !drag) return;
        const { asset } = drop.state.getState();
        const kind = dragKind([...e.dataTransfer.types], asset !== null);
        // Another tab's item: this page does not hold it, so it is refused here rather than left to the browser.
        if (kind === "foreign-asset") {
          e.preventDefault();
          e.dataTransfer.dropEffect = "none";
          show(null);
          return;
        }
        if (kind === "files") {
          e.preventDefault();
          if (!takesFiles()) {
            e.dataTransfer.dropEffect = "none";
            show(null);
            return;
          }
          e.dataTransfer.dropEffect = "copy";
          const at = drag.pointAt(e.clientX, e.clientY);
          const { frame, guide } = landingFrame(store.getState(), at, null);
          show({ trackId: at.trackId, start: frame, duration: null, guide });
          return;
        }
        if (kind !== "asset" || asset === null) return;
        e.preventDefault();
        const state = store.getState();
        if (!state.canEdit) {
          e.dataTransfer.dropEffect = "none";
          show(null);
          return;
        }
        e.dataTransfer.dropEffect = "copy";
        drag.scrollNear(e.clientX);
        // getData is empty during a dragover, so the length comes from the item whose drag began in this page.
        show(hoverFor(store.getState(), drag.pointAt(e.clientX, e.clientY), asset, settings.getState().stillSeconds));
      },
      onDragLeave(e) {
        const to = e.relatedTarget;
        if (to instanceof Node && e.currentTarget.contains(to)) return;
        show(null);
      },
      onDrop(e) {
        if (!drop || !drag) return;
        const types = [...e.dataTransfer.types];
        if (!types.includes(ASSET_DRAG_TYPE) && carriesFiles(types)) {
          // Taken here either way, so the window does not send the files to the library as well.
          e.preventDefault();
          show(null);
          const files = [...e.dataTransfer.files];
          if (!takesFiles() || files.length === 0) return;
          const at = drag.pointAt(e.clientX, e.clientY);
          const { frame } = landingFrame(store.getState(), at, null);
          drop.dropFiles(files, { frame, trackId: at.trackId }, { stillSeconds: settings.getState().stillSeconds });
          return;
        }
        if (!types.includes(ASSET_DRAG_TYPE)) return;
        e.preventDefault();
        show(null);
        const { assets } = library.getState();
        const id = e.dataTransfer.getData(ASSET_DRAG_TYPE);
        const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
        if (!asset) return;
        const state = store.getState();
        const stillSeconds = settings.getState().stillSeconds;
        const at = drag.pointAt(e.clientX, e.clientY);
        // On an empty slot the item fills it; anywhere else it is added as before.
        const slotClip = state.doc.tracks.find((t) => t.id === at.trackId)?.clips.find((c) => c.type === "placeholder" && at.frame >= c.start && at.frame < c.start + c.duration);
        if (slotClip) {
          fillPlaceholder(store, slotClip.id, asset);
          return;
        }
        const { frame } = landingFrame(state, at, clipOf(asset, at.frame, state.doc.fps, stillSeconds)?.duration ?? null);
        addMedia(store, asset, { frame, trackId: dropTrack(state.doc, at.trackId, asset.kind), stillSeconds });
      },
    };
  }, [drag, drop, hover, library, settings, store]);

  return { hover, handlers };
}
