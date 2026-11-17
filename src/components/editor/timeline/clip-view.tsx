"use client";

import { ImageOff } from "lucide-react";
import { memo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { splitClipAt } from "@/lib/editor/actions";
import { MIN_STILL_PX, sampleBackdrop } from "@/lib/editor/clip-look";
import { clipMarks, type ClipMarks } from "@/lib/editor/clip-marks";
import { razorFrame } from "@/lib/editor/commands";
import { cssFontFamily } from "@/lib/editor/fonts";
import { ROW_HEIGHT, formatTimecode, frameToPx } from "@/lib/editor/geometry";
import { SNAP_PX, clipEdges } from "@/lib/editor/snap";
import { posterFileFor } from "@/lib/media/playback";
import type { Clip, TextStyle, Track } from "@/lib/timeline";
import { useEditor, useEditorStore } from "../context";
import { useLibrary } from "../media/media-context";
import { usePosterUrl } from "../media/use-poster";
import { useClipMenu } from "../use-clip-menu";
import { useIsMac } from "../use-shortcuts";
import { CLICK_SLOP_PX, useClipDrag } from "./use-clip-drag";

const FILL: Record<Clip["type"], string> = {
  video: "bg-ed-clip-video",
  image: "bg-ed-clip-image",
  text: "bg-ed-clip-text",
  audio: "bg-ed-clip-audio",
  placeholder: "bg-ed-raised",
};

// An empty slot's body: diagonal hatching in the line colour, so it reads as a hole to fill.
const HATCH = "repeating-linear-gradient(135deg, transparent 0 5px, var(--ed-line-strong) 5px 6px)";

const KIND: Record<Clip["type"], string> = { video: "Video", image: "Image", text: "Text", audio: "Audio", placeholder: "Slot" };

const MIN_LABEL_PX = 24;
export const CLIP_HEIGHT = 32; // the clip's box in its row; the timeline draws a refused drop's outline with the same
export const CLIP_TOP = (ROW_HEIGHT - CLIP_HEIGHT) / 2;
const MIN_TRIM_PX = 16; // narrower clips have no trim handles, so they can still be grabbed to move
const HANDLE = cx("absolute inset-y-0 w-1.5 cursor-ew-resize", FADE); // 6 px, as tall as the clip

// A text clip's first line; a media clip's asset name, or its kind before the library knows the asset.
function clipLabel(clip: Clip, assetName: string | undefined): string {
  if (clip.type === "text") return clip.text.split("\n")[0];
  if (clip.type === "placeholder") return `Slot: ${clip.slot.name}`;
  return assetName ?? KIND[clip.type];
}

function clipName(clip: Clip, assetName: string | undefined, fps: number): string {
  const range = `${formatTimecode(clip.start, fps)} to ${formatTimecode(clip.start + clip.duration, fps)}`;
  if (clip.type === "text") return `Text clip "${clipLabel(clip, undefined)}", ${range}`;
  if (clip.type === "placeholder") return `${clipLabel(clip, undefined)}, ${range}`;
  return assetName === undefined ? `${KIND[clip.type]} clip, ${range}` : `${KIND[clip.type]} clip "${assetName}", ${range}`;
}

// still: whether the clip may show its still or text sample at all (not on a caption row). track: the clip's track,
// which decides whether a crossfade after the clip hides its out-effect.
type ClipViewProps = { clip: Clip; track: Track; zoom: number; fps: number; selected: boolean; hidden: boolean; locked: boolean; still: boolean };

// One clip in its row. Selection happens on press, so a later drag can take the whole selection:
// pressing a clip that is not selected selects only it (Shift, Cmd or Ctrl toggles it); pressing a
// selected clip keeps the selection, and letting go without moving makes it the only one. Where
// the clip can be edited, the timeline's drag takes the press from there: it moves the clip, or
// trims it from a handle at either end, and handles the release. A right-click opens the clip's menu;
// on a Mac a Ctrl press is that right-click, so it neither selects nor drags. A clip wide enough shows a video's or
// image's still, or a text's sample, before its name; a narrower one drops it first, so the name keeps the room.
export const ClipView = memo(function ClipView({ clip, track, zoom, fps, selected, hidden, locked, still }: ClipViewProps) {
  const store = useEditorStore();
  const drag = useClipDrag();
  const canEdit = useEditor((s) => s.canEdit);
  const assetName = useLibrary((s) => (clip.type === "text" || clip.type === "placeholder" ? undefined : s.assets[clip.assetId]?.name));
  const pictured = clip.type === "video" || clip.type === "image";
  const stillFileId = useLibrary((s) => (pictured ? posterFileFor(s.assets[clip.assetId]) : null));
  const removed = useLibrary((s) => pictured && s.assets[clip.assetId]?.removed === true);
  const press = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const width = Math.max(2, frameToPx(clip.duration, zoom));
  const dragger = canEdit && !locked ? drag : null; // null for a viewer, a locked track, or outside a timeline
  const isMac = useIsMac();
  const openClipMenu = useClipMenu();
  const marks = clipMarks(track, clip);
  const showLook = still && width >= MIN_STILL_PX;
  // With the Razor, a press cuts the clip where it lands and the pointer shows where that is; nothing selects or drags.
  const razor = useEditor((s) => s.canEdit && s.tool === "razor") && !locked;
  const [razorAt, setRazorAt] = useState<number | null>(null); // the frame the Razor would cut at, while over the clip

  function razorFrameAt(e: PointerEvent<HTMLDivElement>): number {
    const lane = e.currentTarget.closest<HTMLElement>("[data-lane]");
    const lanePx = e.clientX - (lane?.getBoundingClientRect().left ?? 0);
    const state = store.getState();
    const targets = state.snapping ? [state.playhead, ...clipEdges(state.doc, [clip.id])] : [];
    return razorFrame(lanePx, zoom, targets, SNAP_PX);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (isMac && e.ctrlKey) return;
    press.current = null;
    if (e.button !== 0) return;
    if (razor) {
      splitClipAt(store, clip.id, razorFrameAt(e));
      return;
    }
    const { selection, select } = store.getState();
    const toggle = e.shiftKey || e.metaKey || e.ctrlKey;
    const keep = !toggle && selection.clipIds.includes(clip.id);
    if (toggle) select([clip.id], "toggle");
    else if (!keep) select([clip.id]);
    if (dragger) {
      const edge = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-trim-handle]")?.dataset.trimHandle : undefined;
      dragger.pressClip(e, clip.id, edge === "start" || edge === "end" ? edge : "move", keep);
    } else if (keep) press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const pressed = press.current;
    press.current = null;
    if (!pressed || pressed.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < CLICK_SLOP_PX) store.getState().select([clip.id]);
  }

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    openClipMenu(e, clip.id, e.currentTarget);
  }

  // Enter selects the clip. Space is left alone: in the editor it always plays or pauses.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    store.getState().select([clip.id]);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={clipName(clip, assetName, fps)}
      aria-pressed={selected}
      data-clip-id={clip.id}
      data-placeholder={clip.type === "placeholder" || undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={razor ? (e) => setRazorAt(razorFrameAt(e)) : undefined}
      onPointerLeave={razor ? () => setRazorAt(null) : undefined}
      onPointerCancel={() => (press.current = null)}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      className={cx(
        "group absolute flex touch-none items-center overflow-hidden rounded-[4px] border select-none",
        FILL[clip.type],
        selected ? "border-ed-accent bg-linear-to-r from-ed-accent-weak to-ed-accent-weak" : "border-ed-line-strong",
        hidden && "opacity-50",
        locked && "cursor-not-allowed",
        razor && "cursor-crosshair",
        FOCUS_RING_INSET,
        FADE,
      )}
      style={{ left: frameToPx(clip.start, zoom), top: CLIP_TOP, width, height: CLIP_HEIGHT, ...(clip.type === "placeholder" && { backgroundImage: HATCH }) }}
    >
      {razor && razorAt !== null && razorAt > clip.start && razorAt < clip.start + clip.duration && (
        <span
          aria-hidden
          data-razor-line
          className="pointer-events-none absolute inset-y-0 w-px bg-ed-text"
          style={{ left: frameToPx(razorAt - clip.start, zoom) }}
        />
      )}
      {showLook && pictured && <ClipStill fileId={stillFileId} removed={removed} />}
      {showLook && clip.type === "text" && <TextSample style={clip.style} />}
      {width >= MIN_LABEL_PX && <span className="min-w-0 truncate px-1.5 text-xs leading-4 text-ed-text">{clipLabel(clip, assetName)}</span>}
      <ClipMarkings marks={marks} zoom={zoom} />
      {dragger && width >= MIN_TRIM_PX && (
        <>
          <span aria-hidden data-trim-handle="start" className={cx(HANDLE, "left-0", handleLook(selected))} />
          <span aria-hidden data-trim-handle="end" className={cx(HANDLE, "right-0", handleLook(selected))} />
        </>
      )}
    </div>
  );
}, drawsTheSame);

// Decoration only: wedges shade the in and out effect windows, ticks sit on the bottom edge at each keyframe.
function ClipMarkings({ marks, zoom }: { marks: ClipMarks; zoom: number }) {
  const wedge = "pointer-events-none absolute inset-y-0 from-ed-text/25 to-transparent";
  return (
    <>
      {marks.inFrames > 0 && (
        <span aria-hidden data-effect-wedge="in" className={cx(wedge, "left-0 bg-linear-to-r")} style={{ width: frameToPx(marks.inFrames, zoom) }} />
      )}
      {marks.outFrames > 0 && (
        <span aria-hidden data-effect-wedge="out" className={cx(wedge, "right-0 bg-linear-to-l")} style={{ width: frameToPx(marks.outFrames, zoom) }} />
      )}
      {marks.keyframes.map((at) => (
        <span
          key={at}
          aria-hidden
          data-testid="keyframe-tick"
          className="pointer-events-none absolute bottom-0.5 size-1.5 -translate-x-1/2 rotate-45 bg-ed-accent"
          style={{ left: frameToPx(at, zoom) }}
        />
      ))}
    </>
  );
}

// A video's or image's still, in a box that shows before the picture is read, so the name never moves. While it is
// shown it holds the still, which every clip and tile of that still shares. A removed asset is not read: its box
// shows the missing-media mark. An unknown asset, or one whose still is not made yet, keeps the empty box.
function ClipStill({ fileId, removed }: { fileId: string | null; removed: boolean }) {
  const url = usePosterUrl(fileId);
  return (
    <span data-clip-still aria-hidden className="ml-2 flex h-6 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[2px] bg-ed-raised">
      {removed ? (
        <ImageOff size={14} className="text-ed-muted" />
      ) : (
        url !== null && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob address made in this page; next/image cannot load one.
          <img src={url} alt="" draggable={false} decoding="async" className="pointer-events-none size-full object-cover" />
        )
      )}
    </span>
  );
}

// "Aa" in the text's own font, weight and color, on the backdrop that color reads best on.
function TextSample({ style }: { style: TextStyle }) {
  return (
    <span
      data-clip-sample
      aria-hidden
      className={cx(
        "ml-2 flex size-6 shrink-0 items-center justify-center rounded-[2px] text-xs leading-4 text-ed-text",
        sampleBackdrop(style.color) === "light" ? "bg-ed-text" : "bg-ed-bg",
      )}
      style={{ fontFamily: cssFontFamily(style.fontFamily), fontWeight: style.fontWeight, color: style.color }}
    >
      Aa
    </span>
  );
}

// A drag gives every clip a new object, so an unmoved clip is kept by comparing what it draws from.
function drawsTheSame(a: ClipViewProps, b: ClipViewProps): boolean {
  return (
    a.zoom === b.zoom &&
    a.still === b.still &&
    a.fps === b.fps &&
    a.selected === b.selected &&
    a.hidden === b.hidden &&
    a.locked === b.locked &&
    a.clip.id === b.clip.id &&
    a.clip.type === b.clip.type &&
    a.clip.start === b.clip.start &&
    a.clip.duration === b.clip.duration &&
    clipLabel(a.clip, undefined) === clipLabel(b.clip, undefined) &&
    (!("assetId" in a.clip) || !("assetId" in b.clip) || a.clip.assetId === b.clip.assetId) &&
    sameSample(a.clip, b.clip) &&
    sameMarks(a, b)
  );
}

function sameMarks(a: ClipViewProps, b: ClipViewProps): boolean {
  const x = clipMarks(a.track, a.clip);
  const y = clipMarks(b.track, b.clip);
  return x.inFrames === y.inFrames && x.outFrames === y.outFrames && x.keyframes.join() === y.keyframes.join();
}

function sameSample(a: Clip, b: Clip): boolean {
  if (a.type !== "text" || b.type !== "text") return true;
  return a.style.fontFamily === b.style.fontFamily && a.style.fontWeight === b.style.fontWeight && a.style.color === b.style.color;
}

// Trim handles show on selected clips, and on any clip under the pointer.
function handleLook(selected: boolean): string {
  return selected ? "bg-ed-accent" : "bg-ed-muted opacity-0 group-hover:opacity-100";
}
