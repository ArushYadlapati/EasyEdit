"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { kenBurns, toggleKeyframe } from "@/lib/editor/actions";
import { clipFrame, keyState, neighbourKeyframe, type KeyState } from "@/lib/editor/keyframe-edit";
import { findClip, viewDoc, type EditorState } from "@/lib/editor/store";
import type { KeyframeProp } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";

export const PROP_LABEL: Record<KeyframeProp, string> = { x: "X", y: "Y", scale: "Scale", rotation: "Rotation", opacity: "Opacity", volume: "Volume" };

function stateOf(s: EditorState, clipId: string, prop: KeyframeProp): KeyState {
  const clip = findClip(viewDoc(s), clipId)?.clip;
  return clip ? keyState(clip, prop, clipFrame(clip, s.playhead)) : "none";
}

// A diamond: filled when a keyframe sits at the playhead, hollow when the property is keyframed elsewhere, dim when it
// is not keyframed.
function Diamond({ state }: { state: KeyState }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill={state === "here" ? "currentColor" : "none"} stroke="currentColor" strokeLinejoin="round" className={state === "none" ? "opacity-50" : undefined}>
      <path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" />
    </svg>
  );
}

// Adds a keyframe of the property at the playhead, or removes the one there; its name says which a click does.
export function KeyframeButton({ clipId, prop }: { clipId: string; prop: KeyframeProp }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const state = useEditor((s) => stateOf(s, clipId, prop));
  return (
    <IconButton
      label={`${state === "here" ? "Remove" : "Add"} ${PROP_LABEL[prop]} keyframe`}
      pressed={state === "here"}
      data-key={state}
      data-edit-control
      disabled={!canEdit}
      className={state === "elsewhere" ? "text-ed-text" : undefined}
      onClick={() => toggleKeyframe(store, clipId, prop)}
    >
      <Diamond state={state} />
    </IconButton>
  );
}

// ◀ ▶: the playhead to the clip's previous or next keyframe of any property. Seeking changes nothing, so viewers have
// them too.
export function KeyframeSteps({ clipId }: { clipId: string }) {
  const store = useEditorStore();
  const prev = useEditor((s) => {
    const clip = findClip(viewDoc(s), clipId)?.clip;
    return clip ? neighbourKeyframe(clip, s.playhead, "prev") : null;
  });
  const next = useEditor((s) => {
    const clip = findClip(viewDoc(s), clipId)?.clip;
    return clip ? neighbourKeyframe(clip, s.playhead, "next") : null;
  });
  function go(frame: number | null) {
    if (frame === null) return;
    const state = store.getState();
    state.pause();
    state.seek(frame);
  }
  return (
    <div className="flex items-center">
      <IconButton label="Previous keyframe" disabled={prev === null} onClick={() => go(prev)}>
        <ChevronLeft />
      </IconButton>
      <IconButton label="Next keyframe" disabled={next === null} onClick={() => go(next)}>
        <ChevronRight />
      </IconButton>
    </div>
  );
}

// A slow push in on an image, as scale keyframes across the clip.
export function KenBurnsButton({ clipId }: { clipId: string }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  return (
    <Button
      data-edit-control
      disabled={!canEdit}
      title="Slow zoom in across the clip (replaces its scale keyframes)"
      onClick={() => kenBurns(store, clipId)}
    >
      Ken Burns
    </Button>
  );
}
