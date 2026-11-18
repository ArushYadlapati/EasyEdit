import type { CaptionWord } from "@/lib/timeline";
import type { FromTranscriber, ToTranscriber, TranscribeFailure, TranscribeStage } from "./protocol";

// Page side of speech to text: one worker per file, started for the call and ended however the call ends, so a
// cancel stops the model at once and frees its memory.

export { SPEECH_MODEL } from "./protocol";

export type TranscribeProgress = { stage: TranscribeStage; done: number; total: number };

export class TranscribeError extends Error {
  readonly code: TranscribeFailure | "cancelled";
  constructor(code: TranscribeFailure | "cancelled", message: string) {
    super(message);
    this.name = "TranscribeError";
    this.code = code;
  }
}

export type TranscribeWorker = Pick<Worker, "postMessage" | "terminate" | "addEventListener">;

export type Transcriber = {
  transcribe(file: Blob, opts?: { signal?: AbortSignal; onProgress?: (p: TranscribeProgress) => void }): Promise<CaptionWord[]>;
};

const cancelled = () => new TranscribeError("cancelled", "Transcription was cancelled.");

export function createTranscriber(startWorker: () => TranscribeWorker): Transcriber {
  return {
    transcribe(file, { signal, onProgress } = {}) {
      return new Promise<CaptionWord[]>((resolve, reject) => {
        if (signal?.aborted) return reject(cancelled());
        let worker: TranscribeWorker;
        try {
          worker = startWorker();
        } catch (error) {
          return reject(new TranscribeError("unknown", error instanceof Error ? error.message : String(error)));
        }

        // The first way out wins: it ends the worker and stops listening to the signal; nothing after it is reported.
        let settled = false;
        const settle = (): boolean => {
          if (settled) return false;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          worker.terminate();
          return true;
        };
        const fail = (code: TranscribeFailure | "cancelled", detail: string) => {
          if (settle()) reject(new TranscribeError(code, detail));
        };
        const onAbort = () => fail("cancelled", "Transcription was cancelled.");
        signal?.addEventListener("abort", onAbort, { once: true });

        worker.addEventListener("message", (event: MessageEvent<FromTranscriber>) => {
          if (settled) return;
          const message = event.data;
          if (message.type === "progress") onProgress?.({ stage: message.stage, done: message.done, total: message.total });
          else if (message.type === "done") {
            if (settle()) resolve(message.words);
          } else fail(message.code, message.detail);
        });
        // Its script did not load, it broke, or a message could not be read: no answer will come.
        worker.addEventListener("error", () => fail("unknown", "The speech worker stopped."));
        worker.addEventListener("messageerror", () => fail("unknown", "A message from the speech worker could not be read."));

        const start: ToTranscriber = { type: "start", file };
        worker.postMessage(start);
      });
    },
  };
}

export function browserTranscriber(): Transcriber {
  // Written exactly so: Turbopack bundles a worker only from this expression.
  return createTranscriber(() => new Worker(new URL("../../../workers/transcribe.worker.ts", import.meta.url), { type: "module" }));
}
