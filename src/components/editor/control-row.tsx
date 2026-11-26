"use client";

import { ArrowLeftRight, ArrowRightToLine, ChevronsLeftRight, Magnet, MoveHorizontal, Plus, UnfoldHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { addTrack } from "@/lib/editor/actions";
import { TRIM_MODES, TRIM_MODE_LABEL } from "@/lib/editor/drag";
import { ZOOM_STEP, zoomLimits } from "@/lib/editor/geometry";
import { viewDoc } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import { formatLabel, type TrackKind } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";
import { RateBadge, TimeReadout, TransportButtons, ViewAsMenu } from "./transport";
import { useShortcutLabel } from "./use-shortcuts";
import { ZoomMenu } from "./zoom-menu";

const TRACK_ITEMS: { id: TrackKind; label: string }[] = [
  { id: "video", label: "Video track" },
  { id: "overlay", label: "Overlay track" },
  { id: "text", label: "Text track" },
  { id: "audio", label: "Audio track" },
];
const CAPTIONS_ITEM: MenuItem = { id: "caption", label: "Captions track" };
const TRACK_ITEMS_WITH_CAPTIONS: MenuItem[] = [...TRACK_ITEMS, CAPTIONS_ITEM];

const DIVIDER = <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-ed-line" />;

// The one row above the tracks, across the whole editor: adding a track, the play controls and the time on the left;
// the preview's zoom, View as and the format in the middle; snapping and the timeline's zoom on the right. It replaces
// the bar that was under the preview, so the preview is that much taller. The clip commands are on the tool rail. It
// stays one line: the format label gives way first. The time is its own component, so only it re-renders while the
// playhead moves. The buttons are 28 px in a 40 px row; their focus outline is drawn inside the edge, as the timeline
// region would cut off the top of one drawn outside.
export function ControlRow({ duration, fps }: { duration: number; fps: number }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const hasCaptions = useEditor((s) => s.doc.tracks.some((t) => t.kind === "caption"));
  const tracksFull = useEditor((s) => s.doc.tracks.length >= LIMITS.tracksPerProject);
  const format = useEditor((s) => formatLabel(viewDoc(s)));
  const zoom = useEditor((s) => s.zoom);
  const zoomBy = useEditor((s) => s.zoomBy);
  const zoomToFit = useEditor((s) => s.zoomToFit);
  const snapping = useEditor((s) => s.snapping);
  const setSnapping = useEditor((s) => s.setSnapping);
  const trimMode = useEditor((s) => s.trimMode);
  const setTrimMode = useEditor((s) => s.setTrimMode);
  const key = useShortcutLabel();
  const { min: minZoom, max: maxZoom } = zoomLimits(duration, fps);

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-ed-line px-3 [&_button:focus-visible]:-outline-offset-2">
      <Menu
        data-edit-control
        disabled={!canEdit || tracksFull}
        label="Add track"
        icon={<Plus />}
        items={hasCaptions ? TRACK_ITEMS : TRACK_ITEMS_WITH_CAPTIONS}
        onSelect={(kind) => addTrack(store, kind as TrackKind)}
      />
      {DIVIDER}
      <TransportButtons />
      <TimeReadout duration={duration} fps={fps} />
      <RateBadge />
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <ZoomMenu />
        <ViewAsMenu />
        <span className="min-w-0 truncate text-xs text-ed-muted">{format}</span>
      </div>
      {DIVIDER}
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Snap" shortcut={key("toggle-snapping")} pressed={snapping} onClick={() => setSnapping(!snapping)}>
          <Magnet />
        </IconButton>
        {/* What dragging a clip's edge does to its neighbours. Trim is the plain one, so only the other two light up. */}
        <IconButton
          label={TRIM_MODE_LABEL[trimMode]}
          hint="Dragging a clip's edge: trim, ripple trim (what follows moves with it) or roll (the cut between two clips moves). Slide: dragging a clip moves it between its neighbours, which grow and shrink around it"
          shortcut={key("next-trim-mode")}
          data-edit-control
          data-trim-mode={trimMode}
          disabled={!canEdit}
          pressed={trimMode !== "trim"}
          onClick={() => setTrimMode(TRIM_MODES[(TRIM_MODES.indexOf(trimMode) + 1) % TRIM_MODES.length])}
        >
          {trimMode === "slide" ? <ArrowLeftRight /> : trimMode === "roll" ? <ChevronsLeftRight /> : trimMode === "ripple" ? <ArrowRightToLine /> : <MoveHorizontal />}
        </IconButton>
        <IconButton label="Zoom timeline out" shortcut={key("zoom-out")} disabled={zoom <= minZoom} onClick={() => zoomBy(1 / ZOOM_STEP)}>
          <ZoomOut />
        </IconButton>
        <IconButton label="Zoom timeline in" shortcut={key("zoom-in")} disabled={zoom >= maxZoom} onClick={() => zoomBy(ZOOM_STEP)}>
          <ZoomIn />
        </IconButton>
        <IconButton label="Fit timeline" shortcut={key("zoom-fit")} onClick={() => zoomToFit()}>
          <UnfoldHorizontal />
        </IconButton>
      </div>
    </div>
  );
}
