import type { CaptionWord } from "@/lib/timeline";

// What the page and the speech worker (src/workers/transcribe.worker.ts) say to each other. One worker hears one file.

// The Whisper model the worker runs: base with word times, the one measured on test speech. It lives here, not in
// client.ts, so the worker can read it without importing the file that starts the worker; client.ts exports it too.
export const SPEECH_MODEL = "onnx-community/whisper-base_timestamped";
// The model repository's commit the worker loads, so its words do not change when the repository does.
export const SPEECH_MODEL_REVISION = "608c49e61301901684bc36cac8f74b95ff6b5a8e";

// The speech library asks for each model file's size, and reads a few small settings files, at the repository's moving
// "main" address, whatever revision the pipeline was given. The worker sends those requests to the pinned revision too,
// so every request is for one version of the model. Seen once on a production build: the "main" address of one model
// file answered 502 after 22 s on every run, while the pinned address answered at once.
export function pinnedModelUrl(url: string | URL): string {
  return String(url).replace(`/${SPEECH_MODEL}/resolve/main/`, `/${SPEECH_MODEL}/resolve/${SPEECH_MODEL_REVISION}/`);
}

export type TranscribeFailure = "no-sound" | "undecodable" | "too-long" | "model" | "unknown";
export type TranscribeStage = "model" | "sound" | "speech";

// language: what is spoken, by the model's name for it; English when left out. translate: write it in English.
export type ToTranscriber = { type: "start"; file: Blob; language?: string; translate?: boolean };

export type FromTranscriber =
  | { type: "progress"; stage: TranscribeStage; done: number; total: number } // model: bytes; sound and speech: seconds of the file
  | { type: "done"; words: CaptionWord[]; seconds: number }
  | { type: "failed"; code: TranscribeFailure; detail: string };
