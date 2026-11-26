"use client";

import { nanoid } from "nanoid";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { FORMATS, type InterchangeFormat } from "@/lib/interchange/model";
import { exportTimeline, importPlan, readTimeline, type ImportPlan, type LibraryFile } from "@/lib/interchange/plan";
import type { LibraryStore } from "@/lib/media/library-store";
import { useEditor, useEditorStore } from "./context";
import { downloadBlob } from "./export/download";
import { useMedia } from "./media/media-context";

export type TimelineFileMode = "import" | "export";

// The largest timeline file read: a long cut with every effect spelled out is a few megabytes of text.
const FILE_BYTES_MAX = 30 * 1024 * 1024;
const MISSING_SHOWN = 8;
const MUTED = "text-[13px] leading-5 text-ed-muted";
const TEXT = "text-[13px] leading-5 text-ed-text";

// The library's files as the timeline code needs them: whatever is there and not removed.
function libraryFiles(library: LibraryStore): LibraryFile[] {
  return Object.values(library.getState().assets)
    .filter((a) => !a.removed)
    .map((a) => ({ id: a.id, kind: a.kind, name: a.name, fileName: a.fileName, durationMs: a.durationMs, hasAudio: a.hasAudio }));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className={`${MUTED} flex list-disc flex-col gap-1 pl-4`}>
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

// Reads a timeline another editor wrote and shows what would come in before anything changes: how many clips, on
// how many tracks, which files were found in the library and which were not. Import adds it as one change.
function ImportForm({ onClose }: { onClose(): void }) {
  const store = useEditorStore();
  const { library } = useMedia();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setFileName(chosen.name);
    if (chosen.size > FILE_BYTES_MAX) return setPlan({ ok: false, message: "That file is too large to be a timeline. Export one sequence at a time." });
    const { doc } = store.getState();
    const read = readTimeline(chosen.name, await chosen.text(), doc.fps);
    setPlan(read.ok ? importPlan(store.getState().doc, read.sequence, libraryFiles(library), () => nanoid(10)) : read);
  }
  function run() {
    if (!plan?.ok) return;
    const state = store.getState();
    if (!state.canEdit) return;
    if (state.edit(plan.ops, "import timeline").ok) {
      state.notify("info", `Imported ${count(plan.summary.clips, "clip", "clips")}.`);
      onClose();
    }
  }

  const summary = plan?.ok ? plan.summary : null;
  return (
    <Dialog
      title="Import timeline"
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!plan?.ok} onClick={run}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className={MUTED}>
          Brings in a cut from Premiere Pro, DaVinci Resolve or another editor. There, export the sequence as a Final Cut Pro 7 XML, an EDL or an OpenTimelineIO file. Upload its media
          to the library first, so each clip finds its file by name.
        </p>
        <div className="flex items-center gap-2">
          <Button data-autofocus onClick={() => input.current?.click()}>
            Choose file
          </Button>
          <span className={`${fileName ? TEXT : MUTED} min-w-0 truncate`}>{fileName ?? "No file chosen"}</span>
          <input ref={input} type="file" hidden aria-label="Timeline file" accept=".xml,.edl,.otio,application/xml,text/xml,text/plain,application/json" onChange={(event) => void onFile(event)} />
        </div>
        {plan && !plan.ok && (
          <p role="alert" className="text-[13px] leading-5 text-ed-danger">
            {plan.message}
          </p>
        )}
        {summary && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className={TEXT}>
              {count(summary.clips, "clip", "clips")} on {count(summary.videoTracks, "video track", "video tracks")} and {count(summary.audioTracks, "audio track", "audio tracks")}
              {summary.markers > 0 ? `, with ${count(summary.markers, "marker", "markers")}` : ""}. {summary.matched} of {summary.clips} found their file in the library.
            </p>
            {summary.missing.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className={TEXT}>Not in the library ({summary.missing.length}). Each comes in as an empty slot of the right length: upload the file, then drop it on its slot.</p>
                <ul className={`${MUTED} flex list-disc flex-col pl-4`}>
                  {summary.missing.slice(0, MISSING_SHOWN).map((name) => (
                    <li key={name} className="truncate">
                      {name}
                    </li>
                  ))}
                  {summary.missing.length > MISSING_SHOWN && <li>and {summary.missing.length - MISSING_SHOWN} more</li>}
                </ul>
              </div>
            )}
            <Notes notes={summary.notes} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

// Writes the project's cut as a file another editor opens. What the chosen format leaves behind is listed before the
// download.
function ExportForm({ onClose }: { onClose(): void }) {
  const store = useEditorStore();
  const { library } = useMedia();
  const [format, setFormat] = useState<InterchangeFormat>("fcp7");
  const name = useEditor((s) => s.name);
  const chosen = FORMATS.find((f) => f.id === format)!;
  // Worked out as it is shown, so the notes are the ones the download would have.
  const written = exportTimeline(store.getState().doc, name.trim() || "Timeline", libraryFiles(library), format);

  function download() {
    const fresh = exportTimeline(store.getState().doc, name.trim() || "Timeline", libraryFiles(library), format);
    downloadBlob(new Blob([fresh.text], { type: chosen.mime }), `${name.trim() || "timeline"}.${chosen.extension}`);
    onClose();
  }

  return (
    <Dialog
      title="Export timeline"
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" data-autofocus disabled={written.clips === 0} onClick={download}>
            Download .{chosen.extension}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className={MUTED}>Saves the cut of this project as a file to finish in Premiere Pro, DaVinci Resolve or another editor. The media is not in the file: relink it there by file name.</p>
        <Segmented<InterchangeFormat> label="Format" value={format} options={FORMATS.map((f) => ({ value: f.id, label: f.id === "fcp7" ? "FCP 7 XML" : f.id === "otio" ? "OpenTimelineIO" : "EDL" }))} onChange={setFormat} />
        <p className={TEXT}>
          {chosen.label}. {chosen.hint}
        </p>
        <p className={TEXT}>{written.clips === 0 ? "This project has no video, image or audio clips to write." : `${count(written.clips, "clip", "clips")} will be written.`}</p>
        <Notes notes={written.notes} />
      </div>
    </Dialog>
  );
}

// Edit → Import timeline… and Export timeline…. Each opening starts afresh: the form is mounted only while open.
export function TimelineFileDialog({ mode, onClose }: { mode: TimelineFileMode | null; onClose(): void }): ReactNode {
  if (mode === "import") return <ImportForm onClose={onClose} />;
  if (mode === "export") return <ExportForm onClose={onClose} />;
  return null;
}
