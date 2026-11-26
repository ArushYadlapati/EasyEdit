import type { CutoutFailure, CutoutStage, FromCutout, ToCutout } from "./protocol";

// Page side of background removal: one worker per picture, started for the call and ended however the call ends, so
// a cancel stops the model at once and frees its memory.

export type CutoutProgress = { stage: CutoutStage; done: number; total: number };
export type Cutout = { png: Blob; width: number; height: number; kept: number };

export class CutoutError extends Error {
  readonly code: CutoutFailure | "cancelled";
  constructor(code: CutoutFailure | "cancelled", message: string) {
    super(message);
    this.name = "CutoutError";
    this.code = code;
  }
}

export type CutoutWorker = Pick<Worker, "postMessage" | "terminate" | "addEventListener">;
export type Cutter = { cut(file: Blob, opts?: { signal?: AbortSignal; onProgress?: (p: CutoutProgress) => void }): Promise<Cutout> };

export function createCutter(startWorker: () => CutoutWorker): Cutter {
  return {
    cut(file, { signal, onProgress } = {}) {
      return new Promise<Cutout>((resolve, reject) => {
        if (signal?.aborted) return reject(new CutoutError("cancelled", "Cancelled."));
        let worker: CutoutWorker;
        try {
          worker = startWorker();
        } catch (error) {
          return reject(new CutoutError("unknown", error instanceof Error ? error.message : String(error)));
        }
        // The first way out wins: it ends the worker and stops listening to the signal.
        let settled = false;
        const settle = (): boolean => {
          if (settled) return false;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          worker.terminate();
          return true;
        };
        const fail = (code: CutoutFailure | "cancelled", detail: string) => {
          if (settle()) reject(new CutoutError(code, detail));
        };
        const onAbort = () => fail("cancelled", "Cancelled.");
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.addEventListener("message", (event: MessageEvent<FromCutout>) => {
          if (settled) return;
          const message = event.data;
          if (message.type === "progress") onProgress?.({ stage: message.stage, done: message.done, total: message.total });
          else if (message.type === "done") {
            if (settle()) resolve({ png: message.png, width: message.width, height: message.height, kept: message.kept });
          } else fail(message.code, message.detail);
        });
        worker.addEventListener("error", () => fail("unknown", "The cut-out worker stopped."));
        worker.addEventListener("messageerror", () => fail("unknown", "A message from the cut-out worker could not be read."));
        worker.postMessage({ type: "start", file } satisfies ToCutout);
      });
    },
  };
}

// The real one: the worker with the model.
export function browserCutter(): Cutter {
  return createCutter(() => new Worker(new URL("../../../workers/cutout.worker.ts", import.meta.url), { type: "module" }));
}
