"use client";

import { useMemo } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { captionClipsOf, docCues, type Cue } from "@/lib/captions/cues";
import { frameToPx } from "@/lib/editor/geometry";
import { viewDoc } from "@/lib/editor/store";
import type { CaptionClip } from "@/lib/timeline";
import { useEditor, useEditorStore } from "../context";
import { CLIP_HEIGHT, CLIP_TOP } from "./clip-view";
import { useHeaderWidth } from "./header-width";

// The Captions track's lane, behind its clips. Caption clips are drawn as clips (ClipView), each with its lines inside
// (CaptionPieces). Captions switched on the old way, a flag on the clip with no caption clip, show as one block per
// clip, where its lines show, until someone who can edit opens the project and they become caption clips; a click on
// one moves the playhead to where it starts. With no captions at all the lane says where they come from.
export function CaptionLane({ zoom, fromFrame, toFrame, hidden }: { zoom: number; fromFrame: number; toFrame: number; hidden: boolean }) {
  const headerWidth = useHeaderWidth();
  const store = useEditorStore();
  const doc = useEditor(viewDoc);
  const cues = useMemo(() => docCues(doc), [doc]);
  const hasClips = useMemo(() => captionClipsOf(doc).length > 0, [doc]);
  const old = useMemo(() => oldBlocks(cues), [cues]);

  if (cues.length === 0 && !hasClips) {
    return (
      <p className="pointer-events-none sticky w-max text-xs leading-4 text-ed-muted" style={{ left: headerWidth + 12 }}>
        Captions show here. Add them in the Captions tab.
      </p>
    );
  }
  return old
    .filter((block) => block.end > fromFrame && block.start < toFrame)
    .map((block) => (
      <button
        key={block.clipId}
        type="button"
        title={block.text}
        data-cue
        onClick={() => store.getState().seek(block.start)}
        className={cx(
          "absolute flex items-center overflow-hidden rounded-[4px] border border-ed-line-strong bg-ed-clip-text text-left select-none",
          hidden && "opacity-50",
          FOCUS_RING_INSET,
          FADE,
        )}
        style={{ left: frameToPx(block.start, zoom), top: CLIP_TOP, width: Math.max(2, frameToPx(block.end - block.start, zoom)), height: CLIP_HEIGHT }}
      >
        <span className="min-w-0 truncate px-1.5 text-xs leading-4 text-ed-text">{block.text}</span>
      </button>
    ));
}

// The lines of clips with no caption clip, one block per clip: from its first line's start to its last line's end.
function oldBlocks(cues: readonly Cue[]): { clipId: string; start: number; end: number; text: string }[] {
  const blocks = new Map<string, { clipId: string; start: number; end: number; text: string }>();
  for (const cue of cues) {
    if (cue.captionId !== null) continue;
    const block = blocks.get(cue.clipId);
    if (!block) blocks.set(cue.clipId, { clipId: cue.clipId, start: cue.start, end: cue.end, text: cue.text });
    else {
      block.start = Math.min(block.start, cue.start);
      block.end = Math.max(block.end, cue.end);
      block.text += ` ${cue.text}`;
    }
  }
  return [...blocks.values()];
}

// Inside a caption clip: each of its lines where it shows, its words cut to the room it has, a thin line at its start.
// Decoration only: the clip itself takes the presses. With no line in it, the clip says it holds none.
export function CaptionPieces({ clip, zoom }: { clip: CaptionClip; zoom: number }) {
  const doc = useEditor(viewDoc);
  const lines = useMemo(() => docCues(doc).filter((cue) => cue.captionId === clip.id), [doc, clip.id]);
  if (lines.length === 0) return <span className="relative min-w-0 truncate px-1.5 text-xs leading-4 text-ed-muted">Captions: no words here</span>;
  return (
    <>
      {lines.map((cue, i) => (
        <span
          key={`${cue.clipId}:${cue.words[0].index}`}
          aria-hidden
          data-caption-line
          className={cx("pointer-events-none absolute inset-y-0 flex items-center overflow-hidden", i > 0 && "border-l border-ed-line-strong")}
          style={{ left: frameToPx(cue.start - clip.start, zoom), width: Math.max(1, frameToPx(cue.end - cue.start, zoom)) }}
        >
          <span className="min-w-0 truncate px-1 text-xs leading-4 text-ed-text">{cue.text}</span>
        </span>
      ))}
    </>
  );
}
