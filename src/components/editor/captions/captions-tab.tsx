"use client";

import { useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { captionTargets, captionsOffOps, type AutoCaptionProgress } from "@/lib/captions/actions";
import { docCues } from "@/lib/captions/cues";
import { importSubtitleOps, parseSubtitles, subtitlesText, type SubtitleFormat } from "@/lib/captions/subtitles";
import { formatClock } from "@/lib/editor/geometry";
import { editBlocked } from "@/lib/editor/menus";
import { findClip } from "@/lib/editor/store";
import { useBrand } from "../brand/brand-context";
import { useEditor, useEditorStore } from "../context";
import { downloadBlob } from "../export/download";
import type { PanelProps } from "../media/media-tab";
import { CaptionLines } from "./caption-lines";
import { CaptionStyleControls } from "./caption-style-controls";
import { useAutoCaptions } from "./captions-context";

const MUTED = "text-[13px] leading-5 text-ed-muted";

// Seconds as "1:10".
const clock = (seconds: number) => formatClock(Math.floor(seconds), 1);

// What the run is doing now, and a second line under it when there is one to say. slowModel: getting the model has
// taken long enough that it is being downloaded, which happens once.
function stageText(p: AutoCaptionProgress, slowModel: boolean): { text: string; note?: string } {
  switch (p.stage) {
    case "checking":
      return { text: "Checking for saved captions…" };
    case "saved":
      return { text: "Using saved captions…" };
    case "model":
      return { text: `Getting the speech model… ${p.total > 0 ? Math.floor((p.done / p.total) * 100) : 0}%`, ...(slowModel && { note: "A one-time download." }) };
    case "sound":
      return { text: "Reading the sound…" };
    case "speech":
      return { text: `Listening… ${clock(p.done)} of ${clock(p.total)}` };
  }
}

// Captions as files. Download writes the project's lines as .srt or .vtt on the project's clock, to post with the
// exported video. Import reads an .srt or .vtt as the captions of the one selected video or audio clip, each line placed
// where the clip plays at that moment.
function SubtitleFiles({ blocked }: { blocked: boolean }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const name = useEditor((s) => s.name);
  const cues = useMemo(() => docCues(doc), [doc]);
  const { fonts } = useBrand().kit;
  const picker = useRef<HTMLInputElement>(null);
  const target = useEditor((s) => {
    const clip = s.selection.clipIds.length === 1 ? findClip(s.doc, s.selection.clipIds[0])?.clip : undefined;
    return clip && (clip.type === "video" || clip.type === "audio") ? clip.id : null;
  });

  const download = (format: SubtitleFormat) =>
    downloadBlob(new Blob([subtitlesText(cues, doc.fps, format)], { type: format === "vtt" ? "text/vtt" : "application/x-subrip" }), `${name.trim() || "captions"}.${format}`);

  async function read(file: File | undefined) {
    if (!file) return;
    const text = await file.text().catch(() => "");
    const state = store.getState();
    const clip = target === null ? undefined : findClip(state.doc, target)?.clip;
    if (editBlocked(state) || !clip || (clip.type !== "video" && clip.type !== "audio")) return;
    const lines = parseSubtitles(text);
    if (lines.length === 0) return state.notify("error", "That file has no subtitles to read.");
    const ops = importSubtitleOps(state.doc, clip, lines, fonts);
    if (ops.length === 0) return state.notify("info", "None of that file's lines fall on the selected clip.");
    if (state.edit(ops, "import captions").ok) state.notify("info", `Imported ${lines.length === 1 ? "1 line" : `${lines.length} lines`} of captions.`);
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm leading-5 font-semibold text-ed-text">Subtitle files</h2>
      <div className="flex flex-wrap gap-2">
        <Button disabled={cues.length === 0} onClick={() => download("srt")}>
          Download .srt
        </Button>
        <Button disabled={cues.length === 0} onClick={() => download("vtt")}>
          Download .vtt
        </Button>
        <Button data-edit-control disabled={blocked || target === null} onClick={() => picker.current?.click()}>
          Import subtitles
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          aria-label="Subtitle file"
          className="hidden"
          onChange={(event) => {
            void read(event.target.files?.[0]);
            event.target.value = ""; // the same file can be picked again
          }}
        />
      </div>
      <p className={MUTED}>{target === null ? "Select one video or audio clip to import a .srt or .vtt file as its captions." : "Imports a .srt or .vtt file as the selected clip's captions."}</p>
    </div>
  );
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
  const stage = run.progress ? stageText(run.progress, run.slowModel) : null;

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

        <SubtitleFiles blocked={blocked} />

        {hasCaptions && <CaptionStyleControls canEdit={canEdit} />}
        <CaptionLines canEdit={canEdit} />
      </div>
    </div>
  );
}
