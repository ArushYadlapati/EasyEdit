"use client";

import { useMemo } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { docCues } from "@/lib/captions/cues";
import { HEADER_WIDTH, frameToPx } from "@/lib/editor/geometry";
import { viewDoc } from "@/lib/editor/store";
import { useEditor, useEditorStore } from "../context";
import { CLIP_HEIGHT, CLIP_TOP } from "./clip-view";

// The Captions track's lane: each caption line as a block where it shows, in the clip's geometry. The lines come from
// the clips and follow them, so a block is not dragged; a click moves the playhead to where the line starts. During a
// drag the lines follow the clips being dragged.
export function CaptionLane({ zoom, fromFrame, toFrame, hidden }: { zoom: number; fromFrame: number; toFrame: number; hidden: boolean }) {
  const store = useEditorStore();
  const doc = useEditor(viewDoc);
  const cues = useMemo(() => docCues(doc), [doc]);

  if (cues.length === 0) {
    return (
      <p className="pointer-events-none sticky w-max text-xs leading-4 text-ed-muted" style={{ left: HEADER_WIDTH + 12 }}>
        Captions show here. Add them in the Captions tab.
      </p>
    );
  }
  return cues
    .filter((cue) => cue.end > fromFrame && cue.start < toFrame)
    .map((cue) => (
      <button
        key={`${cue.clipId}:${cue.words[0].index}`}
        type="button"
        title={cue.text}
        data-cue
        onClick={() => store.getState().seek(cue.start)}
        className={cx(
          "absolute flex items-center overflow-hidden rounded-[4px] border border-ed-line-strong bg-ed-clip-text text-left select-none",
          hidden && "opacity-50",
          FOCUS_RING_INSET,
          FADE,
        )}
        style={{ left: frameToPx(cue.start, zoom), top: CLIP_TOP, width: Math.max(2, frameToPx(cue.end - cue.start, zoom)), height: CLIP_HEIGHT }}
      >
        <span className="min-w-0 truncate px-1.5 text-xs leading-4 text-ed-text">{cue.text}</span>
      </button>
    ));
}
