"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createStore, type StoreApi } from "zustand";
import { exportFileName, sameDoc } from "@/lib/export/facts";
import { exportSize, type ExportPresetId } from "@/lib/export/presets";
import type { ExportOutcome } from "@/lib/export/protocol";
import { exportVideo } from "@/lib/export/run";
import { exportReducer, type ExportEvent, type ExportState } from "@/lib/export/state";
import { useEditorStore, useExportDeps } from "../context";

// One export at a time, owned by the editor screen. Its state lives in a small store of its own, changed only through
// exportReducer, so a progress message redraws only what reads it: the dialog's body and, when the whole percentage
// changes, the top bar's button. The editor's store only learns whether an export is running.

export type Exporter = {
  store: StoreApi<ExportState>; // the export's own small store: progress redraws only what reads it
  start(preset: ExportPresetId): Promise<"again" | void>; // "again": the save dialog could not open; ask for another click
  cancel(): void;
  reset(): void; // also drops a held file
  download(): void; // hands a held file to the browser; call it inside a click
};

type ExportOptions = { onFinish?(outcome: ExportOutcome, fileName: string, held: boolean): void };

// What the hook keeps between calls, outside React's state: nothing here is drawn.
type Running = {
  mounted: boolean;
  busy: boolean; // set inside the click, before anything is awaited, so a second click asks for no second save dialog
  controller: AbortController | null; // the running export's
  held: { blob: Blob; fileName: string } | null; // a finished file waiting for a Download click
};

export function useExport(options: ExportOptions = {}): Exporter {
  const deps = useExportDeps();
  const editor = useEditorStore();
  const [store] = useState(() => createStore<ExportState>(() => ({ phase: "idle" })));
  const running = useRef<Running>({ mounted: false, busy: false, controller: null, held: null });
  const onFinish = useRef(options.onFinish);
  useEffect(() => {
    onFinish.current = options.onFinish;
  });

  // Leaving the editor cancels a running export and drops a held file. The export's last steps still run, but they
  // change no state of a screen that is gone.
  useEffect(() => {
    const now = running.current;
    now.mounted = true;
    return () => {
      now.mounted = false;
      now.controller?.abort();
      now.held = null;
    };
  }, []);

  return useMemo(() => {
    const dispatch = (event: ExportEvent) => {
      if (running.current.mounted) store.setState(exportReducer(store.getState(), event), true);
    };

    async function start(preset: ExportPresetId): Promise<"again" | void> {
      const now = running.current;
      if (now.busy) return;
      now.busy = true;
      try {
        // The snapshot: edits not yet sent are in it, a drag in progress is not.
        const { doc, name } = editor.getState();
        const size = exportSize(doc, preset);
        if (!size) return;
        // Asked before anything else is awaited: the browser opens its save dialog only inside the click.
        const picked = await deps.pickTarget(exportFileName(name, preset));
        if (picked === "again") return "again";
        // Closed without a choice, or the editor closed while it was open: nothing starts. The empty file the save
        // dialog made stays where the person saved it.
        if (picked === null || !now.mounted) return;
        const { target, fileName, held } = picked;
        const controller = new AbortController();
        now.controller = controller;
        dispatch({ type: "start", fileName });
        editor.getState().setExporting(true);
        const release = deps.keepRunning();
        const outcome = await exportVideo(
          {
            doc,
            size,
            target,
            signal: controller.signal,
            // Called from the worker's message listener, where nothing would catch a throw.
            onProgress: (progress) => {
              try {
                dispatch({ type: "progress", ...progress, at: deps.now() });
              } catch {
                // A redraw that failed; the next message draws again.
              }
            },
            onReading: (filesRead, totalFiles) => dispatch({ type: "reading", filesRead, totalFiles }),
          },
          deps,
        );
        now.controller = null;
        const blob = outcome.status === "done" ? (held?.() ?? null) : null;
        if (blob !== null && now.mounted) now.held = { blob, fileName };
        dispatch({ type: "finish", outcome, changed: !sameDoc(editor.getState().doc, doc), held: blob !== null });
        editor.getState().setExporting(false);
        release();
        if (outcome.status === "failed") console.error("Export failed:", outcome.code, outcome.detail);
        onFinish.current?.(outcome, fileName, blob !== null);
      } finally {
        now.busy = false;
      }
    }

    return {
      store,
      start,
      cancel: () => running.current.controller?.abort(),
      reset: () => {
        running.current.held = null;
        dispatch({ type: "reset" });
      },
      download: () => {
        const { held } = running.current;
        if (held) deps.download(held.blob, held.fileName);
      },
    };
  }, [store, deps, editor]);
}
