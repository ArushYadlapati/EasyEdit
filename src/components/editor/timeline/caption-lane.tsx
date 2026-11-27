"use client";

import { useMemo } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { captionClipsOf, docCues, type Cue } from "@/lib/captions/cues";
import { frameToPx } from "@/lib/editor/geometry";
import { viewDoc } from "@/lib/editor/store";
import { useEditor, useEditorStore } from "../context";
import { CLIP_HEIGHT, CLIP_TOP } from "./clip-view";
import { useHeaderWidth } from "./header-width";

// The Captions track's lane, behind its clips. Caption clips are drawn as clips (ClipView): one plain block each, named
// "Captions 1", "Captions 2"…, with nothing drawn inside. Captions switched on the old way, a flag on the clip with no
// caption clip, show as one plain block per clip, where its lines show, until someone who can edit opens the project and they become caption clips; a click on
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
        <span className="min-w-0 truncate px-1.5 text-xs leading-4 text-ed-text">Captions</span>
      </button>
    ));
}

// The lines of clips with no caption clip, one block per clip: from its first line's start to its last line's end.
function oldBlocks(cues: readonly Cue[]): { clipId: string; start: number; end: number }[] {
  const blocks = new Map<string, { clipId: string; start: number; end: number }>();
  for (const cue of cues) {
    if (cue.captionId !== null) continue;
    const block = blocks.get(cue.clipId);
    if (!block) blocks.set(cue.clipId, { clipId: cue.clipId, start: cue.start, end: cue.end });
    else {
      block.start = Math.min(block.start, cue.start);
      block.end = Math.max(block.end, cue.end);
    }
  }
  return [...blocks.values()];
}
