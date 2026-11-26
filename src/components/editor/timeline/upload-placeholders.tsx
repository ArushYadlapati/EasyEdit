"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { ROW_HEIGHT, clampZoom, displayRows, frameToPx } from "@/lib/editor/geometry";
import { dropTrack, liveUpload, shownSlots, type DropGroup } from "@/lib/editor/media-drop";
import { homeKind, placeClips } from "@/lib/editor/placement";
import { viewDoc } from "@/lib/editor/store";
import { kindFromName } from "@/lib/media/rules";
import type { AssetKind, UploadItem } from "@/lib/media/types";
import { DEFAULT_TRANSFORM, docDuration, type MediaClip, type TimelineDoc, type Track } from "@/lib/timeline";
import { useEditor, useEditorStore } from "../context";
import { useLibrary, useMediaDrop, useMediaDropState } from "../media/media-context";
import { progressOf, stageLabel } from "../media/upload-row";
import { CLIP_HEIGHT, CLIP_TOP } from "./clip-view";
import { LANE_GUTTER } from "./playhead";
import { useHeaderWidth } from "./header-width";
import { CLICK_SLOP_PX, useClipDrag } from "./use-clip-drag";
import { landingFrame } from "./use-timeline-drop";

type Shown = { id: string; key: string; item: UploadItem; row: number; start: number; length: number };

// A waiting file a person is dragging: where it would go if let go now, and the snap target when it snapped.
type Moving = { key: string; frame: number; trackId: string | null; guide: number | null };

// A press on a waiting file's box. grab: how far into the box, in frames, it was taken.
type Press = { key: string; pointerId: number; x0: number; y0: number; grab: number; length: number; started: boolean; to: Moving | null };

const NO_GROUPS: DropGroup[] = [];

// The row a file's clip would go on: where placement would put a clip of its kind and length at that frame, wished
// onto the dropped row as the landing does. When placement would make a new track, the wished row, else the first row
// of the file's own kind (the last for audio, as audio rows grow downwards), else the top row.
function rowFor(doc: TimelineDoc, rows: Track[], trackId: string | null, kind: AssetKind, start: number, length: number): number {
  const wish = dropTrack(doc, trackId, kind);
  const clip: MediaClip = { id: "upload", type: kind, assetId: "upload", start, duration: length, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM } };
  const placement = placeClips(doc, [{ clip, trackId: wish }], () => "upload");
  const added = placement.ok ? placement.ops.find((op) => op.op === "add_clip") : undefined;
  const placed = added?.op === "add_clip" ? rows.findIndex((t) => t.id === added.trackId) : -1;
  if (placed >= 0) return placed;
  const wished = rows.findIndex((t) => t.id === wish);
  if (wished >= 0) return wished;
  const home = homeKind(kind);
  const own = home === "audio" ? rows.findLastIndex((t) => t.kind === home) : rows.findIndex((t) => t.kind === home);
  return Math.max(0, own);
}

// One placeholder for each file of a drop still to land, where shownSlots puts it. The one being dragged shows where
// it would go instead; the others stay put until it is let go.
function placeholdersOf(groups: DropGroup[], uploads: UploadItem[], doc: TimelineDoc, moving: Moving | null): Shown[] {
  const rows = displayRows(doc);
  const shown: Shown[] = [];
  for (const group of groups) {
    const slots = shownSlots(group, uploads, doc.fps);
    group.members.forEach((member, i) => {
      const item = uploads.find((u) => u.key === member.key);
      if ((member.state !== "pending" && member.state !== "placing") || !liveUpload(item)) return;
      const kind = kindFromName(item.fileName);
      if (kind === null) return; // a file of no kind the library takes never lands
      const dragged = moving !== null && moving.key === member.key && member.state === "pending";
      const start = dragged ? moving.frame : slots[i].start;
      const trackId = dragged ? moving.trackId : group.trackId;
      shown.push({ id: `${group.id}:${i}`, key: member.key, item, row: rowFor(doc, rows, trackId, kind, start, slots[i].length), start, length: slots[i].length });
    });
  }
  return shown;
}

// Where each dropped file will land while its upload runs: a dashed box with its name, its stage and a bar of how far
// it is. A failed upload that can be tried again keeps its place, outlined as failed. Drawn over the rows; it lives
// only in this tab. A box can be dragged along the timeline and onto another row while its file is still coming in:
// the file then lands where the box was let go. Escape puts it back.
export function UploadPlaceholders(): ReactNode {
  const headerWidth = useHeaderWidth();
  const store = useEditorStore();
  const doc = useEditor(viewDoc);
  const storedZoom = useEditor((s) => s.zoom);
  const groups = useMediaDropState((s) => s.groups, NO_GROUPS);
  const uploads = useLibrary((s) => s.uploads);
  const drop = useMediaDrop();
  const drag = useClipDrag();
  const [moving, setMoving] = useState<Moving | null>(null);
  const press = useRef<Press | null>(null);
  const duration = useMemo(() => docDuration(doc), [doc]);
  const zoom = clampZoom(storedZoom, duration, doc.fps); // as the timeline draws it
  const shown = useMemo(() => placeholdersOf(groups, uploads, doc, moving), [groups, uploads, doc, moving]);
  const movable = drop !== null && drag !== null;

  // However a press ends, the file is let go of and Escape is no longer listened for.
  const ending = useRef<() => void>(() => {});
  function end() {
    ending.current();
    ending.current = () => {};
    press.current = null;
    setMoving(null);
  }
  useEffect(() => () => ending.current(), []);

  function onPointerDown(e: PointerEvent<HTMLDivElement>, box: Shown) {
    if (!drop || !drag || e.button !== 0 || press.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; its release still arrives here or not at all.
    }
    const grab = drag.pointAt(e.clientX, e.clientY).frame - box.start;
    press.current = { key: box.key, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, grab, length: box.length, started: false, to: null };
    // Escape ends the drag before anything else hears it, so it does not also clear the selection.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !press.current?.started) return;
      event.preventDefault();
      event.stopPropagation();
      end();
    };
    window.addEventListener("keydown", onKey, true);
    ending.current = () => {
      window.removeEventListener("keydown", onKey, true);
      drop.hold(null);
    };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p || !drop || !drag || e.pointerId !== p.pointerId) return;
    if (!p.started) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < CLICK_SLOP_PX) return;
      p.started = true;
      drop.hold(p.key); // it does not land under the pointer
    }
    drag.scrollNear(e.clientX);
    const at = drag.pointAt(e.clientX, e.clientY);
    const wanted = { frame: Math.max(0, at.frame - p.grab), trackId: at.trackId };
    const { frame, guide } = landingFrame(store.getState(), wanted, p.length);
    const to: Moving = { key: p.key, frame, trackId: at.trackId, guide };
    const was = p.to;
    p.to = to;
    if (!was || was.frame !== to.frame || was.trackId !== to.trackId || was.guide !== to.guide) setMoving(to);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    const to = p.started ? p.to : null;
    // Moved before it is let go of, so it lands at its new place and not at the old one first.
    if (to && drop) drop.moveFile(to.key, { frame: to.frame, trackId: to.trackId });
    end();
  }

  const guideAt = moving?.guide ?? null;
  return (
    <>
      {shown.map((box) => {
        const { id, item, row, start, length } = box;
        const failed = item.stage === "failed";
        const stage = stageLabel(item);
        const label = failed ? `${item.fileName} · Upload failed` : stage ? `${item.fileName} · ${stage}` : item.fileName;
        const held = moving?.key === box.key;
        return (
          <div
            key={id}
            aria-hidden
            data-upload-placeholder
            data-moving={held || undefined}
            onPointerDown={movable ? (e) => onPointerDown(e, box) : undefined}
            onPointerMove={movable ? onPointerMove : undefined}
            onPointerUp={movable ? onPointerUp : undefined}
            onPointerCancel={movable ? end : undefined}
            onLostPointerCapture={movable ? () => press.current && end() : undefined}
            onContextMenu={movable ? (e) => e.preventDefault() : undefined}
            className={cx(
              "absolute z-10 rounded-[4px] border border-dashed",
              failed ? "border-ed-danger" : "border-ed-accent",
              "bg-ed-accent-weak flex items-center overflow-hidden",
              movable ? cx("touch-none", held ? "cursor-grabbing" : "cursor-grab") : "pointer-events-none",
            )}
            style={{
              left: headerWidth + LANE_GUTTER + frameToPx(start, zoom),
              top: row * ROW_HEIGHT + CLIP_TOP,
              width: Math.max(2, frameToPx(length, zoom)),
              height: CLIP_HEIGHT,
            }}
          >
            <span className="pointer-events-none min-w-0 truncate px-1.5 text-xs leading-4 text-ed-text">{label}</span>
            <div data-upload-progress className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-ed-accent" style={{ width: `${progressOf(item)}%` }} />
          </div>
        );
      })}
      {guideAt !== null && (
        <div
          aria-hidden
          data-snap-guide
          className="pointer-events-none absolute inset-y-0 z-10 border-l border-ed-accent"
          style={{ left: headerWidth + LANE_GUTTER + frameToPx(guideAt, zoom) }}
        />
      )}
    </>
  );
}
