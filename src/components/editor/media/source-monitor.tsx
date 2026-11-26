"use client";

import { Music } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DEFAULT_IMAGE_SECONDS, mediaClipFor } from "@/lib/editor/media-clips";
import { explainOpError } from "@/lib/editor/messages";
import { markedSpan, sourceEditOps, sourceTracks, type SourceEditMode } from "@/lib/editor/source-edit";
import { playbackFileFor } from "@/lib/media/playback";
import type { AssetView } from "@/lib/media/types";
import { useEditor, useEditorStore } from "../context";
import { useMedia } from "./media-context";

const MUTED = "text-[13px] leading-5 text-ed-muted";
const NEW_TRACK = ""; // the Track menu's value for "a new track"

// Seconds as 0:07.5, for a file's own time.
export function sourceClock(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds) * 10 + 1e-6) / 10;
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

// The source monitor: one file from the library, played and scrubbed on its own, with an In and an Out marked on it.
// Insert and Overwrite put that part on a track at the timeline's playhead, which then moves to the new clip's end,
// so the next part lands after it. It stays open between edits. Keys, while it is open: I and O mark, Space plays,
// the arrows step a frame, comma inserts and full stop overwrites.
export function SourceMonitor({ asset, onClose }: { asset: AssetView; onClose(): void }) {
  const store = useEditorStore();
  const { files } = useMedia();
  const canEdit = useEditor((s) => s.canEdit);
  const fps = useEditor((s) => s.doc.fps);
  const playhead = useEditor((s) => s.playhead);
  const doc = useEditor((s) => s.doc);
  const still = asset.kind === "image";
  const length = still ? null : (asset.durationMs ?? 0) / 1000;

  // The file the preview plays; a video with no copy to play yet is read from its original.
  const fileId = playbackFileFor(asset).fileId ?? asset.originalFileId;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const unreadable = fileId === null || failed;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [marks, setMarks] = useState({ in: 0, out: length ?? DEFAULT_IMAGE_SECONDS });
  const [trackId, setTrackId] = useState<string | null>(null);
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  // Read from this browser's copy, and let go of when the monitor closes.
  useEffect(() => {
    if (fileId === null) return;
    let current = true;
    let made: string | null = null;
    void files
      .get(fileId)
      .then((got) => {
        if (!current) return;
        if (!got.ok) return setFailed(true);
        made = URL.createObjectURL(got.blob);
        setUrl(made);
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fileId, files]);

  const tracks = sourceTracks(doc, asset.kind);
  const target = tracks.find((t) => t.id === trackId) ?? tracks[0] ?? null;
  const span = markedSpan(marks.in, marks.out, length, fps);

  const seek = (seconds: number) => {
    const to = Math.min(length ?? 0, Math.max(0, seconds));
    if (player.current) player.current.currentTime = to;
    setTime(to);
  };
  const toggle = () => {
    const el = player.current;
    if (!el) return;
    if (el.paused) {
      // Past the Out, or at the end: from the In again.
      if (el.currentTime >= marks.out - 1 / fps) el.currentTime = marks.in;
      void el.play().catch(() => {});
    } else el.pause();
  };
  // Playing stops at the Out, so what is heard is what will go on the timeline.
  const onTime = () => {
    const el = player.current;
    if (!el) return;
    if (!el.paused && marks.out < (length ?? 0) && el.currentTime >= marks.out) {
      el.pause();
      el.currentTime = marks.out;
    }
    setTime(el.currentTime);
  };
  const mark = (edge: "in" | "out") =>
    setMarks((now) => (edge === "in" ? { in: time, out: Math.max(now.out, time + 1 / fps) } : { in: Math.min(now.in, Math.max(0, time - 1 / fps)), out: time }));

  function place(mode: SourceEditMode) {
    const state = store.getState();
    if (!state.canEdit) return;
    const clip = mediaClipFor(asset, state.playhead, fps, span);
    if (!clip) return state.notify("error", "That part of the file is past its end.");
    const edit = sourceEditOps(state.doc, clip, target?.id ?? null, mode, () => nanoid(10));
    if (!edit.ok) return state.notify("error", edit.why === "locked" ? explainOpError("TRACK_LOCKED") : "That track doesn't take this kind of clip.");
    if (!state.edit(edit.ops, mode === "insert" ? "insert from source" : "overwrite from source").ok) return;
    state.select([edit.clipId]);
    state.seek(clip.start + clip.duration);
  }

  // The monitor's keys work wherever the focus is while it is open (after a click on Insert it is on that button, in
  // the dialog's footer), and none of them reaches the editor behind it. Typing in a field is left alone.
  function onKey(event: KeyboardEvent) {
    const from = event.target instanceof HTMLElement ? event.target : null;
    const tag = from?.tagName ?? "";
    const typing = tag === "SELECT" || tag === "TEXTAREA" || (tag === "INPUT" && (from as HTMLInputElement).type !== "range");
    if (event.metaKey || event.ctrlKey || event.altKey || typing) return;
    const key = event.key.toLowerCase();
    const take = (act: () => void) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      act();
    };
    if (key === ",") return take(() => place("insert"));
    if (key === ".") return take(() => place("overwrite"));
    if (still) return;
    if (key === "i") return take(() => mark("in"));
    if (key === "o") return take(() => mark("out"));
    if (key === " " && tag !== "BUTTON") return take(toggle); // on a button, Space presses it
    if (key === "arrowleft" && tag !== "INPUT") return take(() => seek(time - 1 / fps));
    if (key === "arrowright" && tag !== "INPUT") return take(() => seek(time + 1 / fps));
  }
  const keys = useRef(onKey);
  useEffect(() => {
    keys.current = onKey;
  });
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    // Before the editor's own shortcuts, which listen on the window too.
    window.addEventListener("keydown", listen, true);
    return () => window.removeEventListener("keydown", listen, true);
  }, []);

  const at = sourceClock(playhead / fps);
  return (
    <Dialog
      title={`Source: ${asset.name}`}
      open
      onClose={onClose}
      size="lg"
      footer={
        <>
          <p className={`mr-auto min-w-0 ${MUTED}`}>{`Goes at the playhead, ${at}. Insert moves what follows on that track later; Overwrite replaces what is there.`}</p>
          <Button data-edit-control disabled={!canEdit || unreadable} onClick={() => place("insert")}>
            Insert
          </Button>
          <Button data-edit-control variant="primary" disabled={!canEdit || unreadable} onClick={() => place("overwrite")}>
            Overwrite
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-black">
          {unreadable ? (
            <p role="alert" className="p-6 text-[13px] text-ed-muted">
              This file couldn&apos;t be read here.
            </p>
          ) : url === null ? (
            <p className="p-6 text-[13px] text-ed-muted">Reading the file…</p>
          ) : asset.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob address made in this page; next/image cannot load one.
            <img src={url} alt={asset.name} className="max-h-full max-w-full object-contain" />
          ) : asset.kind === "audio" ? (
            <>
              <Music aria-hidden className="size-10 text-ed-muted" />
              <audio ref={player} src={url} preload="auto" onTimeUpdate={onTime} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
            </>
          ) : (
            <video
              ref={player}
              src={url}
              playsInline
              preload="auto"
              aria-label={`${asset.name}, as recorded`}
              className="max-h-full max-w-full"
              onTimeUpdate={onTime}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          )}
        </div>

        {still ? (
          <Field label="Shows for (seconds)">
            <input
              type="number"
              min={0.1}
              max={600}
              step={0.5}
              value={marks.out}
              onChange={(event) => setMarks({ in: 0, out: Math.min(600, Math.max(0.1, Number(event.target.value) || DEFAULT_IMAGE_SECONDS)) })}
              className="h-8 w-24 rounded-md border border-ed-field-line bg-ed-field px-2 text-[13px] text-ed-text"
            />
          </Field>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="range"
              aria-label="Position in the file"
              min={0}
              max={length ?? 0}
              step={1 / fps}
              value={time}
              disabled={url === null}
              onChange={(event) => seek(Number(event.target.value))}
              className="w-full accent-[var(--ed-accent)]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={url === null} onClick={toggle}>
                {playing ? "Pause" : "Play"}
              </Button>
              <Button disabled={url === null} onClick={() => mark("in")}>
                Mark In
              </Button>
              <Button disabled={url === null} onClick={() => mark("out")}>
                Mark Out
              </Button>
              <Button variant="ghost" disabled={url === null} onClick={() => setMarks({ in: 0, out: length ?? 0 })}>
                Clear marks
              </Button>
              <p role="status" className="ml-auto text-[13px] leading-5 tabular-nums text-ed-text">
                {`${sourceClock(time)} of ${sourceClock(length ?? 0)} · In ${sourceClock(span.inSeconds)} · Out ${sourceClock(span.inSeconds + span.durationSeconds)} · ${span.durationSeconds.toFixed(1)} s marked`}
              </p>
            </div>
          </div>
        )}

        <Field label="Track">
          <Select value={target?.id ?? NEW_TRACK} disabled={tracks.length === 0} onChange={(event) => setTrackId(event.target.value || null)}>
            {tracks.length === 0 && <option value={NEW_TRACK}>A new track</option>}
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
