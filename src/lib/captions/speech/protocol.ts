import type { CaptionWord } from "@/lib/timeline";

// What the page and the speech worker (src/workers/transcribe.worker.ts) say to each other. One worker hears one file.

// The Whisper model the worker runs: base with word times, which Plan 2 measured. It lives here, not in client.ts,
// so the worker can read it without importing the file that starts the worker; client.ts exports it too.
export const SPEECH_MODEL = "onnx-community/whisper-base_timestamped";

export type TranscribeFailure = "no-sound" | "undecodable" | "too-long" | "model" | "unknown";
export type TranscribeStage = "model" | "sound" | "speech";

export type ToTranscriber = { type: "start"; file: Blob };

export type FromTranscriber =
  | { type: "progress"; stage: TranscribeStage; done: number; total: number } // model: bytes; sound and speech: seconds of the file
  | { type: "done"; words: CaptionWord[]; seconds: number }
  | { type: "failed"; code: TranscribeFailure; detail: string };
