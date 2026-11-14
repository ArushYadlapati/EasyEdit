"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import {
  exportNotes, formatBytes, maxBytes, secondsLeft, timeLeftLabel, waitingReason,
} from "@/lib/export/facts";
import { planExportMedia } from "@/lib/export/media-sources";
import { failureMessage } from "@/lib/export/messages";
import { exportOptions, videoSettings, type ExportPresetId } from "@/lib/export/presets";
import { frameCount } from "@/lib/export/schedule";
import { MEMORY_LIMIT_BYTES } from "@/lib/export/sinks";
import { isBusy, type ExportState } from "@/lib/export/state";
import { checkSupport, type Support } from "@/lib/export/support";
import { useEditor, useEditorStore, useExportDeps } from "../context";
import { useLibrary } from "../media/media-context";
import { Timecode } from "../timecode";
import type { Exporter } from "./use-export";

// The Export dialog: the choices, then the export's progress and its end. Closing it never cancels an export, and
// opening it again shows where things stand. Its body and its footer read the export's store; the Dialog draws them
// only while it is open, so a closed dialog reads nothing.

type ExportDialogProps = { open: boolean; onClose(): void; exporter: Exporter };

// What the choices need between the body and the footer: this browser's answer and the size the person picked.
type ChoiceProps = { support: Support | null; selected: ExportPresetId | null };

const MUTED = "text-ed-muted";

export function ExportDialog({ open, onClose, exporter }: ExportDialogProps): ReactNode {
  const deps = useExportDeps();
  const editor = useEditorStore();
  const [support, setSupport] = useState<Support | null>(null);
  const [selected, setSelected] = useState<ExportPresetId | null>(null);
  // Each opening asks this browser again, at the project's size then: an edit can change the size.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSupport(null);
  }
  useEffect(() => {
    if (!open) return;
    let current = true;
    void checkSupport(deps.supportProbe, editor.getState().doc).then((answer) => {
      if (current) setSupport(answer);
    });
    return () => {
      current = false;
    };
  }, [open, deps, editor]);

  const choice: ChoiceProps = { support, selected };
  return (
    <Dialog
      title="Export"
      size="md"
      open={open}
      onClose={onClose}
      footer={<ExportFooter exporter={exporter} onClose={onClose} {...choice} />}
    >
      <ExportBody exporter={exporter} onSelect={setSelected} {...choice} />
    </Dialog>
  );
}

// The project's facts at the picked size, the media plan, and whether Export video may be clicked now.
function useChoices({ support, selected }: ChoiceProps) {
  const deps = useExportDeps();
  const doc = useEditor((s) => s.doc);
  const assets = useLibrary((s) => s.assets);
  const loaded = useLibrary((s) => s.loaded);
  return useMemo(() => {
    const plan = planExportMedia(doc, { assets, loaded });
    // A size the check did not ask about is not offered; one it said no to is shown, turned off.
    const options = support ? exportOptions(doc).filter((option) => support.sizes[option.id] !== undefined) : [];
    const usable = options.filter((option) => support?.sizes[option.id] === true);
    const option = usable.find((o) => o.id === selected) ?? usable[0] ?? null;
    const frames = frameCount(doc);
    const video = option ? videoSettings(option.size, doc.fps) : null;
    const bytes = video ? maxBytes(video, frames) : null;
    const empty = frames === 0;
    const waiting = waitingReason(plan);
    // Without a save dialog the whole file is held in memory, so a video too long for it is refused before the click.
    const tooLong = !deps.savesToFile && bytes !== null && bytes > MEMORY_LIMIT_BYTES;
    const blocked = empty ? failureMessage("empty") : (waiting ?? (tooLong ? failureMessage("too-long") : null));
    return { doc, plan, options, option, frames, bytes, empty, blocked, canStart: option !== null && blocked === null };
  }, [doc, assets, loaded, support, selected, deps]);
}

const choosing = (state: ExportState) => state.phase === "idle" || state.phase === "canceled";

function ExportBody({ exporter, onSelect, ...choice }: ChoiceProps & { exporter: Exporter; onSelect(id: ExportPresetId): void }) {
  const state = useStore(exporter.store);
  if (choosing(state)) return <Choices onSelect={onSelect} canceled={state.phase === "canceled"} {...choice} />;
  return <Progress state={state} />;
}

function Choices({ support, selected, onSelect, canceled }: ChoiceProps & { onSelect(id: ExportPresetId): void; canceled: boolean }) {
  const { doc, plan, options, option, frames, bytes, empty, blocked } = useChoices({ support, selected });
  if (support === null) return <p className={MUTED}>Checking this browser…</p>;
  if (!support.browser) return <p>{failureMessage("unsupported")}</p>;
  if (empty) return <p>{blocked}</p>;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Size">
        <Select value={option?.id ?? ""} onChange={(event) => onSelect(event.target.value as ExportPresetId)}>
          {options.map((o) => (
            <option key={o.id} value={o.id} disabled={support.sizes[o.id] !== true}>
              {support.sizes[o.id] === true ? o.label : `${o.label} (not supported on this computer)`}
            </option>
          ))}
        </Select>
      </Field>
      {option && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <Fact term="Size">{`${option.size.width} × ${option.size.height}`}</Fact>
          <Fact term="Frame rate">{`${doc.fps} fps`}</Fact>
          <Fact term="Length">
            <Timecode frame={frames} fps={doc.fps} />
          </Fact>
          {bytes !== null && <Fact term="File size">{`Up to about ${formatBytes(bytes)}`}</Fact>}
          <Fact term="Format">MP4, H.264 video</Fact>
        </dl>
      )}
      {option && (
        <div className="flex flex-col gap-1">
          {exportNotes(plan, option.size, support.audio).map((note) => (
            <p key={note} className={MUTED}>
              {note}
            </p>
          ))}
        </div>
      )}
      {blocked && <p>{blocked}</p>}
      {canceled && <p>Export canceled.</p>}
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className={MUTED}>{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

const count = (n: number) => n.toLocaleString("en-US");

function Progress({ state }: { state: Exclude<ExportState, { phase: "idle" | "canceled" }> }) {
  const deps = useExportDeps();
  switch (state.phase) {
    case "preparing":
      return <p>Preparing…</p>;
    case "reading":
      return <p>{`Reading media: ${state.filesRead} of ${state.totalFiles}`}</p>;
    case "running": {
      const { framesDone, totalFrames } = state;
      const finishing = framesDone >= totalFrames;
      const left = finishing ? "" : timeLeftLabel(secondsLeft(framesDone, totalFrames, deps.now() - state.startedAt));
      return (
        <div className="flex flex-col gap-2">
          <progress
            aria-label="Export progress"
            value={framesDone}
            max={totalFrames}
            className="block h-1.5 w-full appearance-none overflow-hidden rounded-full border-0 bg-ed-raised [&::-moz-progress-bar]:bg-ed-accent [&::-webkit-progress-bar]:bg-ed-raised [&::-webkit-progress-value]:bg-ed-accent [&::-webkit-progress-value]:transition-none"
          />
          <div className="flex items-center justify-between gap-4">
            <p className="tabular-nums">{finishing ? "Finishing…" : `Frame ${count(framesDone)} of ${count(totalFrames)}`}</p>
            {left && <p className={MUTED}>{left}</p>}
          </div>
          {state.attempt > 1 && <p className={MUTED}>Trying again with a slower encoder.</p>}
        </div>
      );
    }
    case "done":
      return (
        <div className="flex flex-col gap-2">
          <div role="status" className="flex flex-col gap-1">
            <p className="font-medium">{state.held ? "Your video is ready." : `Saved ${state.fileName}`}</p>
            <p className={MUTED}>{formatBytes(state.bytes)}</p>
          </div>
          {state.changed && (
            <p>The project changed while this was exporting. The file shows it as it was when the export started.</p>
          )}
          {!state.hasAudio && <p className={MUTED}>This file has no sound track.</p>}
        </div>
      );
    case "failed":
      return (
        <p role="alert" className="text-ed-danger">
          {failureMessage(state.code)}
        </p>
      );
  }
}

function ExportFooter({ exporter, onClose, ...choice }: ChoiceProps & { exporter: Exporter; onClose(): void }) {
  const phase = useStore(exporter.store, (s) => s.phase);
  const held = useStore(exporter.store, (s) => s.phase === "done" && s.held);
  const finishing = useStore(exporter.store, (s) => s.phase === "running" && s.framesDone >= s.totalFrames);
  const busy = useStore(exporter.store, isBusy);

  if (phase === "idle" || phase === "canceled") return <StartButton exporter={exporter} {...choice} />;
  if (busy) return finishing ? null : <Button onClick={() => exporter.cancel()}>Cancel</Button>;
  if (phase === "failed") {
    return (
      <Button variant="primary" onClick={() => exporter.reset()}>
        Try again
      </Button>
    );
  }
  const finish = () => {
    exporter.reset();
    onClose();
  };
  if (!held) {
    return (
      <Button variant="primary" onClick={finish}>
        Done
      </Button>
    );
  }
  return (
    <>
      <Button onClick={finish}>Done</Button>
      {/* Inside the click, so the browser treats it as the person's own download. */}
      <Button variant="primary" onClick={() => exporter.download()}>
        Download
      </Button>
    </>
  );
}

function StartButton({ exporter, ...choice }: ChoiceProps & { exporter: Exporter }) {
  const { option, canStart } = useChoices(choice);
  const [again, setAgain] = useState(false);
  if (!choice.support?.browser) return null;
  const start = () => {
    if (!option) return;
    setAgain(false);
    void exporter.start(option.id).then((answer) => setAgain(answer === "again"));
  };
  return (
    <>
      {again && (
        <p role="alert" className="mr-auto min-w-0 text-xs text-ed-danger">
          Click Export video again to choose where to save.
        </p>
      )}
      <Button variant="primary" disabled={!canStart} onClick={start}>
        Export video
      </Button>
    </>
  );
}
