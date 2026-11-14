import type { ExportFailure, ExportOutcome } from "./protocol";

// The export dialog's states, and which follows which. An event that does not apply returns the same state.

export type ExportState =
  | { phase: "idle" } // the dialog shows the choices
  | { phase: "preparing"; fileName: string } // a file is chosen; fonts and the worker are starting
  | { phase: "reading"; fileName: string; filesRead: number; totalFiles: number } // the media files are being read
  | { phase: "running"; fileName: string; attempt: number; framesDone: number; totalFrames: number; startedAt: number }
  | { phase: "done"; fileName: string; bytes: number; hasAudio: boolean; changed: boolean; held: boolean } // held: the file waits for a Download click
  | { phase: "failed"; code: ExportFailure }
  | { phase: "canceled" };

export type ExportEvent =
  | { type: "start"; fileName: string }
  | { type: "reading"; filesRead: number; totalFiles: number }
  | { type: "progress"; attempt: number; framesDone: number; totalFrames: number; at: number }
  | { type: "finish"; outcome: ExportOutcome; changed: boolean; held: boolean }
  | { type: "reset" };

type BusyState = Extract<ExportState, { phase: "preparing" | "reading" | "running" }>;

export function isBusy(state: ExportState): state is BusyState {
  return state.phase === "preparing" || state.phase === "reading" || state.phase === "running";
}

function progressed(state: BusyState, event: Extract<ExportEvent, { type: "progress" }>): ExportState {
  const { attempt, framesDone, totalFrames, at } = event;
  if (state.phase !== "running" || attempt > state.attempt) {
    // The first frames, or a second try that counts again from frame 0.
    return { phase: "running", fileName: state.fileName, attempt, framesDone, totalFrames, startedAt: at };
  }
  // A late message from an earlier try, or a count that would go backward.
  if (attempt < state.attempt || framesDone < state.framesDone) return state;
  return { ...state, framesDone, totalFrames };
}

function finished(state: BusyState, event: Extract<ExportEvent, { type: "finish" }>): ExportState {
  const { outcome } = event;
  if (outcome.status === "canceled") return { phase: "canceled" };
  if (outcome.status === "failed") return { phase: "failed", code: outcome.code };
  return {
    phase: "done",
    fileName: state.fileName,
    bytes: outcome.bytes,
    hasAudio: outcome.hasAudio,
    changed: event.changed,
    held: event.held,
  };
}

export function exportReducer(state: ExportState, event: ExportEvent): ExportState {
  switch (event.type) {
    case "start":
      return isBusy(state) ? state : { phase: "preparing", fileName: event.fileName };
    case "reading":
      // A second try reads nothing, so reading never follows running.
      if (state.phase !== "preparing" && state.phase !== "reading") return state;
      return { phase: "reading", fileName: state.fileName, filesRead: event.filesRead, totalFiles: event.totalFiles };
    case "progress":
      return isBusy(state) ? progressed(state, event) : state;
    case "finish":
      return isBusy(state) ? finished(state, event) : state;
    case "reset":
      return state.phase === "done" || state.phase === "failed" || state.phase === "canceled" ? { phase: "idle" } : state;
  }
}

// 0 … 1; 0 unless running.
export function progressFraction(state: ExportState): number {
  if (state.phase !== "running" || state.totalFrames <= 0) return 0;
  return Math.min(1, Math.max(0, state.framesDone / state.totalFrames));
}
