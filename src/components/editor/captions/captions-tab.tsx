"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { captionTargets, captionsOffOps, type AutoCaptionProgress } from "@/lib/captions/actions";
import { formatClock } from "@/lib/editor/geometry";
import { editBlocked } from "@/lib/editor/menus";
import { findClip } from "@/lib/editor/store";
import { useEditor, useEditorStore } from "../context";
import type { PanelProps } from "../media/media-tab";
import { CaptionLines } from "./caption-lines";
import { CaptionStyleControls } from "./caption-style-controls";
import { useAutoCaptions } from "./captions-context";

const MUTED = "text-[13px] leading-5 text-ed-muted";

// Seconds as "1:10".
const clock = (seconds: number) => formatClock(Math.floor(seconds), 1);

// What the run is doing now, and a second line under it when there is one to say.
function stageText(p: AutoCaptionProgress): { text: string; note?: string } {
  switch (p.stage) {
    case "saved":
      return { text: "Using saved captions…" };
    case "model":
      return { text: `Getting the speech model… ${p.total > 0 ? Math.floor((p.done / p.total) * 100) : 0}%`, note: "A one-time download." };
    case "sound":
      return { text: "Reading the sound…" };
    case "speech":
      return { text: `Listening… ${clock(p.done)} of ${clock(p.total)}` };
  }
}

// The left panel's Captions tab: Auto captions for the selected clips (or every clip with sound), where it is while it
// runs, what went wrong after, then the look of the captions and their lines, to fix.
export function CaptionsTab({ panel }: { panel: PanelProps }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const blocked = useEditor(editBlocked);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor(useShallow((s) => s.selection.clipIds));
  const run = useAutoCaptions();

  const { selectedCaptioned, targets, hint } = useMemo(() => {
    const clips = selection.flatMap((id) => findClip(doc, id)?.clip ?? []);
    const sound = clips.filter((c) => c.type === "video" || c.type === "audio");
    const anyInProject = doc.tracks.some((t) => t.clips.some((c) => c.type === "video" || c.type === "audio"));
    return {
      selectedCaptioned: sound.some((c) => "captions" in c && c.captions),
      targets: captionTargets(doc, selection).length,
      hint: !anyInProject
        ? "Add a video or audio clip to caption it."
        : selection.length === 0
          ? "Captions every clip with sound."
          : sound.length > 0
            ? "Captions the selected clips."
            : "Select a video or audio clip, or select nothing to caption every clip with sound.",
    };
  }, [doc, selection]);
  const hasCaptions = doc.captions !== undefined || doc.tracks.some((t) => t.clips.some((c) => "captions" in c && c.captions));
  const stage = run.progress ? stageText(run.progress) : null;

  return (
    <div {...panel} className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-4 p-3">
        <div className="flex flex-col gap-2">
          <Button data-edit-control variant="primary" disabled={blocked || targets === 0 || run.running} onClick={() => run.start()}>
            Auto captions
          </Button>
          <p className={MUTED}>{hint}</p>

          {run.running && (
            <div className="flex items-start justify-between gap-2">
              <div role="status" className="flex min-w-0 flex-col text-[13px] leading-5 text-ed-text">
                {run.progress && run.progress.files > 1 && (
                  <span className="truncate text-ed-muted">{`${run.progress.file} of ${run.progress.files} · ${run.progress.name}`}</span>
                )}
                {stage && <span>{stage.text}</span>}
                {stage?.note && <span className="text-ed-muted">{stage.note}</span>}
              </div>
              <Button onClick={run.cancel}>Cancel</Button>
            </div>
          )}

          {!run.running &&
            run.outcome?.failed.map((f, i) => (
              <p key={i} role="alert" className="text-[13px] leading-5 text-ed-danger">
                {`Couldn't caption ${f.name}: ${f.why}`}
              </p>
            ))}

          {selectedCaptioned && (
            <div className="flex flex-wrap gap-2">
              <Button data-edit-control disabled={blocked || run.running} onClick={() => run.start({ redo: true })}>
                Transcribe again
              </Button>
              <Button
                data-edit-control
                disabled={blocked || run.running}
                onClick={() => {
                  const state = store.getState();
                  if (editBlocked(state)) return;
                  const ops = captionsOffOps(state.doc, state.selection.clipIds);
                  if (ops.length > 0) state.edit(ops, "remove captions");
                }}
              >
                Remove captions
              </Button>
            </div>
          )}
        </div>

        {hasCaptions && <CaptionStyleControls canEdit={canEdit} />}
        <CaptionLines canEdit={canEdit} />
      </div>
    </div>
  );
}
