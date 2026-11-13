"use client";

import { useMemo, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { HEADER_WIDTH, ROW_HEIGHT, clampZoom, displayRows, frameToPx } from "@/lib/editor/geometry";
import { dropTrack, endToEnd, uploadFrames, type DropGroup } from "@/lib/editor/media-drop";
import { homeKind, placeClips } from "@/lib/editor/placement";
import { viewDoc } from "@/lib/editor/store";
import { kindFromName } from "@/lib/media/rules";
import type { AssetKind, UploadItem } from "@/lib/media/types";
import { DEFAULT_TRANSFORM, docDuration, type MediaClip, type TimelineDoc, type Track } from "@/lib/timeline";
import { useEditor } from "../context";
import { useLibrary, useMediaDropState } from "../media/media-context";
import { progressOf, stageLabel } from "../media/upload-row";
import { CLIP_HEIGHT, CLIP_TOP } from "./clip-view";
import { LANE_GUTTER } from "./playhead";

type Shown = { id: string; item: UploadItem; row: number; start: number; length: number };

const NO_GROUPS: DropGroup[] = [];

// An upload that may still land: not cancelled (its row is there) and not failed in a way a retry cannot mend.
const live = (item: UploadItem | undefined): item is UploadItem => item !== undefined && !(item.stage === "failed" && !item.canRetry);

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

// One placeholder for each file of a drop still to land, laid end to end from the drop frame as the landing lays them.
// A length not read yet counts as the drop's still length, so each file shows near where it will go; one that will
// never land takes no room, so the files after it close up.
function placeholdersOf(groups: DropGroup[], uploads: UploadItem[], doc: TimelineDoc): Shown[] {
  const rows = displayRows(doc);
  const shown: Shown[] = [];
  for (const group of groups) {
    const nominal = Math.max(1, Math.round(group.stillSeconds * doc.fps));
    const items = group.members.map((m) => uploads.find((u) => u.key === m.key));
    const lengths = group.members.map((m, i) => {
      const item = items[i];
      if (m.state === "placed") return m.placedFrames ?? 0;
      if (m.state === "out" || !live(item)) return 0;
      return uploadFrames(item, doc.fps, group.stillSeconds) ?? nominal;
    });
    const starts = endToEnd(group.frame, lengths);
    group.members.forEach((member, i) => {
      const item = items[i];
      if ((member.state !== "pending" && member.state !== "placing") || !live(item)) return;
      const kind = kindFromName(item.fileName);
      if (kind === null) return; // a file of no kind the library takes never lands
      const start = starts[i]!; // every length is known here
      shown.push({ id: `${group.id}:${i}`, item, row: rowFor(doc, rows, group.trackId, kind, start, lengths[i]), start, length: lengths[i] });
    });
  }
  return shown;
}

// Where each dropped file will land while its upload runs: a dashed box with its name, its stage and a bar of how far
// it is. A failed upload that can be tried again keeps its place, outlined as failed. Drawn over the rows, never taking
// the pointer; it lives only in this tab.
export function UploadPlaceholders(): ReactNode {
  const doc = useEditor(viewDoc);
  const storedZoom = useEditor((s) => s.zoom);
  const groups = useMediaDropState((s) => s.groups, NO_GROUPS);
  const uploads = useLibrary((s) => s.uploads);
  const duration = useMemo(() => docDuration(doc), [doc]);
  const zoom = clampZoom(storedZoom, duration, doc.fps); // as the timeline draws it
  const shown = useMemo(() => placeholdersOf(groups, uploads, doc), [groups, uploads, doc]);

  return shown.map(({ id, item, row, start, length }) => {
    const failed = item.stage === "failed";
    const stage = stageLabel(item);
    const label = failed ? `${item.fileName} · Upload failed` : stage ? `${item.fileName} · ${stage}` : item.fileName;
    return (
      <div
        key={id}
        aria-hidden
        data-upload-placeholder
        className={cx(
          "pointer-events-none absolute z-10 rounded-[4px] border border-dashed",
          failed ? "border-ed-danger" : "border-ed-accent",
          "bg-ed-accent-weak flex items-center overflow-hidden",
        )}
        style={{
          left: HEADER_WIDTH + LANE_GUTTER + frameToPx(start, zoom),
          top: row * ROW_HEIGHT + CLIP_TOP,
          width: Math.max(2, frameToPx(length, zoom)),
          height: CLIP_HEIGHT,
        }}
      >
        <span className="min-w-0 truncate px-1.5 text-xs leading-4 text-ed-text">{label}</span>
        <div data-upload-progress className="absolute bottom-0 left-0 h-0.5 bg-ed-accent" style={{ width: `${progressOf(item)}%` }} />
      </div>
    );
  });
}
