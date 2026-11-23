"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import {
  exportNotes, formatBytes, frameFileName, maxBytes, secondsLeft, timeLeftLabel, waitingReason,
} from "@/lib/export/facts";
import { planExportMedia } from "@/lib/export/media-sources";
import { failureMessage, failureOf, frameFailureMessage } from "@/lib/export/messages";
import { EXPORT_QUALITIES, exportOptions, videoSettings, type ExportPresetId, type ExportQuality } from "@/lib/export/presets";
import { RANGE_LABEL, rangeDoc, spanOf, type RangeKind } from "@/lib/editor/export-range";
import { frameCount } from "@/lib/export/schedule";
import { MEMORY_LIMIT_BYTES } from "@/lib/export/sinks";
import { isBusy, type ExportState } from "@/lib/export/state";
import { checkSupport, type Support } from "@/lib/export/support";
import { useEditor, useEditorStore, useExportDeps } from "../context";
import { useLibrary } from "../media/media-context";
import { Timecode } from "../timecode";
import { PostBody, PostButton, PostFooter, PostOffer, usePostPanel, type PostPanel } from "./post-panel";
import type { Exporter } from "./use-export";

// The Export dialog: the choices, then the export's progress and its end. Closing it never cancels an export, and
// opening it again shows where things stand. Its body and its footer read the export's store; the Dialog draws them
// only while it is open, so a closed dialog reads nothing. A finished export can be posted to the space's YouTube
// channel from here (post-panel.tsx): while that is on screen, the dialog shows the post instead of the export.

type ExportDialogProps = { open: boolean; onClose(): void; exporter: Exporter };

// What the choices need between the body and the footer: this browser's answer and the size the person picked.
// full: Full quality is switched on.
// quality: how many bits the picture gets.
// range: which part of the project is exported.
type ChoiceProps = { support: Support | null; selected: ExportPresetId | null; full: boolean; quality: ExportQuality; range: RangeKind };

const MUTED = "text-ed-muted";

export function ExportDialog({ open, onClose, exporter }: ExportDialogProps): ReactNode {
  const deps = useExportDeps();
  const editor = useEditorStore();
  const [support, setSupport] = useState<Support | null>(null);
  const [selected, setSelected] = useState<ExportPresetId | null>(null);
  const [full, setFull] = useState(false); // off each time the editor opens: it is slower, so it is asked for
  const [quality, setQuality] = useState<ExportQuality>("standard");
  const [range, setRange] = useState<RangeKind>("all");
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

  const post = usePostPanel(exporter, open);
  const posting = post.step.at !== "closed";
  // Done: the export and anything of a post are forgotten, and the dialog closes.
  const finish = () => {
    post.close();
    exporter.reset();
    onClose();
  };

  const choice: ChoiceProps = { support, selected, full, quality, range };
  return (
    <Dialog
      title="Export"
      size="md"
      open={open}
      onClose={onClose}
      footer={posting ? <PostFooter panel={post} onDone={finish} /> : <ExportFooter exporter={exporter} onDone={finish} post={post} {...choice} />}
    >
      {posting ? <PostBody panel={post} /> : <ExportBody exporter={exporter} onSelect={setSelected} onFull={setFull} onQuality={setQuality} onRange={setRange} post={post} {...choice} />}
    </Dialog>
  );
}

// The project's facts at the picked size, the media plan, and whether Export video may be clicked now.
function useChoices({ support, selected, quality, full, range }: ChoiceProps) {
  const deps = useExportDeps();
  const whole = useEditor((s) => s.doc);
  const selection = useEditor(useShallow((s) => s.selection.clipIds));
  const playhead = useEditor((s) => s.playhead);
  // The parts on offer now, and the project cut down to the one picked: every fact below is about that part.
  const ranges = useMemo(() => (["all", "selection", "playhead"] as const).filter((kind) => kind === "all" || spanOf(kind, whole, selection, playhead) !== null), [whole, selection, playhead]);
  const span = useMemo(() => (range === "all" || !ranges.includes(range) ? null : spanOf(range, whole, selection, playhead)), [range, ranges, whole, selection, playhead]);
  const doc = useMemo(() => (span ? rangeDoc(whole, span) : whole), [whole, span]);
  const assets = useLibrary((s) => s.assets);
  const loaded = useLibrary((s) => s.loaded);
  return useMemo(() => {
    // Planned as it will be exported, so the notes say which files the pictures come from.
    const plan = planExportMedia(doc, { assets, loaded }, support?.audio ?? false, full);
    // A size the check did not ask about is not offered; one it said no to is shown, turned off.
    const options = support ? exportOptions(doc).filter((option) => support.sizes[option.id] !== undefined) : [];
    const usable = options.filter((option) => support?.sizes[option.id] === true);
    const option = usable.find((o) => o.id === selected) ?? usable[0] ?? null;
    const frames = frameCount(doc);
    const video = option ? videoSettings(option.size, doc.fps, quality) : null;
    const bytes = video ? maxBytes(video, frames) : null;
    const empty = frames === 0;
    const waiting = waitingReason(plan);
    // Without a save dialog the whole file is held in memory, so a video too long for it is refused before the click.
    const tooLong = !deps.savesToFile && bytes !== null && bytes > MEMORY_LIMIT_BYTES;
    const blocked = empty ? failureMessage("empty") : (waiting ?? (tooLong ? failureMessage("too-long") : null));
    // Save frame is off only while the media is not ready: a too-long video is no reason not to save one frame of it.
    // A frame has no sound, so only its pictures' media counts.
    const canSaveFrame = option !== null && !empty && waitingReason(planExportMedia(doc, { assets, loaded })) === null;
    return { doc, plan, options, option, frames, bytes, empty, blocked, canStart: option !== null && blocked === null, canSaveFrame, ranges, span };
  }, [doc, assets, loaded, support, selected, quality, full, deps, ranges, span]);
}

const choosing = (state: ExportState) => state.phase === "idle" || state.phase === "canceled";

type ChoiceSetters = { onSelect(id: ExportPresetId): void; onFull(on: boolean): void; onQuality(quality: ExportQuality): void; onRange(range: RangeKind): void };

function ExportBody({ exporter, onSelect, onFull, onQuality, onRange, post, ...choice }: ChoiceProps & ChoiceSetters & { exporter: Exporter; post: PostPanel }) {
  const state = useStore(exporter.store);
  if (choosing(state)) return <Choices onSelect={onSelect} onFull={onFull} onQuality={onQuality} onRange={onRange} canceled={state.phase === "canceled"} {...choice} />;
  return <Progress state={state} post={post} />;
}

function Choices({ support, selected, full, quality, range, onSelect, onFull, onQuality, onRange, canceled }: ChoiceProps & ChoiceSetters & { canceled: boolean }) {
  const { doc, plan, options, option, frames, bytes, empty, blocked, ranges } = useChoices({ support, selected, full, quality, range });
  // Full quality has something to give only where a video plays from a smaller copy of itself.
  const hasCopies = Object.values(plan.clips).some((clip) => clip.kind === "use" && (clip.from === "preview" || clip.fallback !== undefined));
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
      {ranges.length > 1 && (
        <Field label="What to export">
          <Select value={ranges.includes(range) ? range : "all"} onChange={(event) => onRange(event.target.value as RangeKind)}>
            {ranges.map((kind) => (
              <option key={kind} value={kind}>
                {RANGE_LABEL[kind]}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Quality">
        <Select value={quality} onChange={(event) => onQuality(event.target.value as ExportQuality)}>
          {EXPORT_QUALITIES.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
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
      {hasCopies && (
        <div className="flex flex-col gap-1">
          <Toggle label="Full quality" checked={full} onChange={onFull} />
          <p className={MUTED}>
            Draws each video from its original file, not the smaller copy the editor plays. Slower: the originals are downloaded first. A file this browser can&apos;t read exports from its copy.
          </p>
        </div>
      )}
      {option && (
        <div className="flex flex-col gap-1">
          {exportNotes(plan, option.size, support.audio, doc).map((note) => (
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

function Progress({ state, post }: { state: Exclude<ExportState, { phase: "idle" | "canceled" }>; post: PostPanel }) {
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
          <PostOffer panel={post} />
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

function ExportFooter({ exporter, onDone, post, ...choice }: ChoiceProps & { exporter: Exporter; onDone(): void; post: PostPanel }) {
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
  if (!held) {
    return (
      <>
        <PostButton panel={post} />
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </>
    );
  }
  return (
    <>
      <PostButton panel={post} />
      <Button onClick={onDone}>Done</Button>
      {/* Inside the click, so the browser treats it as the person's own download. */}
      <Button
        variant="primary"
        onClick={(event) => {
          if (event.detail > 1) return;
          exporter.download();
        }}
      >
        Download
      </Button>
    </>
  );
}

const AGAIN = "Click Export video again to choose where to save.";

function StartButton({ exporter, ...choice }: ChoiceProps & { exporter: Exporter }) {
  const deps = useExportDeps();
  const editor = useEditorStore();
  const { option, frames, canStart, canSaveFrame, span } = useChoices(choice);
  // The footer's one alert line: a second click wanted, or why a frame wasn't saved. Each click clears it.
  const [alert, setAlert] = useState<string | null>(null);
  // One frame saved at a time. The ref refuses a second click in the same tick, before the button is drawn off.
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  if (!choice.support?.browser) return null;
  const audio = choice.support.audio;
  // The second click of a double-click lands on what replaced the first's button, or on the same one again: it starts
  // nothing. A key press has detail 0.
  const start = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1 || !option) return;
    setAlert(null);
    void exporter.start(option.id, audio, choice.full, choice.quality, span).then((answer) => setAlert(answer === "again" ? AGAIN : null));
  };
  const saveFrame = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1 || !option || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setAlert(null);
    const { doc, name, playhead } = editor.getState();
    const frame = Math.min(playhead, frames - 1);
    // No export was running, so the sentence is about the frame.
    deps
      .saveFrame(doc, frame, option.size, frameFileName(name, frame))
      .catch((error: unknown) => {
        setAlert(frameFailureMessage(failureOf(error, "unknown").code));
      })
      .finally(() => {
        savingNow.current = false;
        setSaving(false);
      });
  };
  return (
    <>
      {alert && (
        <p role="alert" className="mr-auto min-w-0 text-xs text-ed-danger">
          {alert}
        </p>
      )}
      <Button variant="ghost" disabled={!canSaveFrame || saving} onClick={saveFrame}>
        Save frame as image
      </Button>
      <Button variant="primary" disabled={!canStart} onClick={start}>
        Export video
      </Button>
    </>
  );
}
