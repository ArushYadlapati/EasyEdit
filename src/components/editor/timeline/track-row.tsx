"use client";

import { memo, useCallback, useMemo, useRef, type MouseEvent, type PointerEvent } from "react";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { cx } from "@/components/ui/cx";
import { addAdjustmentLayer, addTrack, duplicateTrack, paste, removeTrack } from "@/lib/editor/actions";
import { ROW_HEIGHT, visibleClips } from "@/lib/editor/geometry";
import { laneMenu, rightClickEntries } from "@/lib/editor/menus";
import type { Track, TrackKind } from "@/lib/timeline";
import { useClipboard, useEditorStore } from "../context";
import { useToMenuItems } from "../menu-items";
import { useIsMac } from "../use-shortcuts";
import { CaptionLane } from "./caption-lane";
import { ClipView } from "./clip-view";
import { LANE_GUTTER } from "./playhead";
import { TrackHeader } from "./track-header";
import { useClipDrag, type TimelineDrag } from "./use-clip-drag";

// Opens the menu of empty timeline space: a track's row (trackId), or below the last row (null). Paste lands
// at the right-clicked point, which drag works out from the event. A viewer has nothing there, so no menu opens.
export function useLaneMenu(drag: TimelineDrag | null): (e: MouseEvent<HTMLElement>, trackId: string | null) => void {
  const store = useEditorStore();
  const clipboard = useClipboard();
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  return useCallback(
    (e, trackId) => {
      e.preventDefault();
      if (!menu) return;
      const state = store.getState();
      const entries = rightClickEntries(laneMenu(state, clipboard.read() !== null, trackId), state.canEdit);
      if (entries.length === 0) return;
      const at = drag?.pointAt(e.clientX, e.clientY);
      menu({
        ...menuPoint(e),
        label: "Timeline",
        items: toItems(entries),
        onSelect: (id) => {
          if (id === "paste") paste(store, clipboard, at);
          else if (id === "track-duplicate" && trackId) duplicateTrack(store, trackId);
          else if (id === "track-remove" && trackId) removeTrack(store, trackId);
          else if (id === "adjustment-layer") addAdjustmentLayer(store);
          else if (id.startsWith("add-")) addTrack(store, id.slice("add-".length) as TrackKind);
        },
      });
    },
    [store, clipboard, menu, toItems, drag],
  );
}

type TrackRowProps = {
  track: Track;
  zoom: number;
  fps: number;
  fromFrame: number; // only clips in this range are rendered
  toFrame: number;
  selectedIds: string[];
  trackSelected: boolean;
  divider: boolean; // the last row before the audio rows draws the stronger rule under it
};

// A track's header and its lane of clips. Pressing empty row space right of the header (the lane, or
// the gutter before frame 0) clears the selection, unless Shift is held, and starts a box selection.
export const TrackRow = memo(function TrackRow(props: TrackRowProps) {
  const { track, zoom, fps, fromFrame, toFrame, selectedIds, trackSelected, divider } = props;
  const store = useEditorStore();
  const clips = useMemo(() => visibleClips(track.clips, fromFrame, toFrame), [track.clips, fromFrame, toFrame]);
  const laneRef = useRef<HTMLDivElement>(null);
  const drag = useClipDrag();
  const isMac = useIsMac();
  const openLaneMenu = useLaneMenu(drag);
  const isEmptySpace = (target: EventTarget) => target === laneRef.current;

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (isMac && e.ctrlKey) return;
    if (e.button !== 0 || (e.target !== e.currentTarget && !isEmptySpace(e.target))) return;
    const { selection, select, guideId } = store.getState();
    if (!e.shiftKey && (selection.clipIds.length > 0 || selection.trackId !== null || guideId !== null)) select([]);
    drag?.pressRows(e);
  }

  // A clip's or the header's own right-click has already been handled.
  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    if (e.defaultPrevented || (e.target !== e.currentTarget && !isEmptySpace(e.target))) return;
    openLaneMenu(e, track.id);
  }

  return (
    <div
      role="group"
      aria-label={track.name}
      className={cx("flex border-b", divider ? "border-ed-line-strong" : "border-ed-line")}
      style={{ height: ROW_HEIGHT }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      <TrackHeader track={track} selected={trackSelected} />
      <div data-lane className="relative flex min-w-0 flex-1 items-center" ref={laneRef} style={{ marginLeft: LANE_GUTTER }}>
        {clips.map((clip) => (
          <ClipView
            key={clip.id}
            clip={clip}
            track={track}
            zoom={zoom}
            fps={fps}
            selected={selectedIds.includes(clip.id)}
            hidden={track.hidden}
            locked={track.locked}
            still={track.kind !== "caption"}
          />
        ))}
        {track.kind === "caption" && <CaptionLane zoom={zoom} fromFrame={fromFrame} toFrame={toFrame} hidden={track.hidden} />}
      </div>
    </div>
  );
});
