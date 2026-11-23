import { maxBytes } from "@/lib/export/facts";
import type { FontBundle } from "@/lib/export/fonts";
import type { MediaOptions } from "@/lib/export/gather-media";
import { ExportError, failureOf } from "@/lib/export/messages";
import { ACCELERATION_ORDER, videoSettings, type Acceleration, type ExportSize, type VideoSettings } from "@/lib/export/presets";
import type { ExportFailure, ExportMedia, ExportOutcome, FromWorker, ToWorker } from "@/lib/export/protocol";
import { frameCount } from "@/lib/export/schedule";
import type { ByteSink, ExportTarget } from "@/lib/export/sinks";
import type { TimelineDoc } from "@/lib/timeline";

// Page side: one export, from a snapshot of the project to its outcome. It owns the worker's life and the file's fate:
// every way out terminates the worker, and every end but a finished file drops the bytes and removes the file.

// The part of a Worker this uses, in the ingest worker's shape (src/lib/media/ingest-protocol.ts), so a real Worker
// fits and a test can stand in.
export type ExportWorker = {
  postMessage(message: ToWorker): void;
  addEventListener(type: "message", listener: (event: { data: FromWorker }) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  terminate(): void;
};

export type ExportRequest = {
  doc: TimelineDoc; // the snapshot to export
  size: ExportSize; // the output size
  target: ExportTarget; // where the bytes go
  signal: AbortSignal; // abort it to cancel
  onProgress(progress: { attempt: number; framesDone: number; totalFrames: number }): void;
  onReading(filesRead: number, totalFiles: number): void;
  sound: boolean; // the file will carry a sound track (Support.audio): only then is sound planned and read
  originals?: boolean; // full quality: pictures from each video's original file, where this browser can read it
};

export type RunDeps = {
  createWorker(): ExportWorker;
  collectFonts(doc: TimelineDoc): Promise<FontBundle>;
  collectMedia(doc: TimelineDoc, options: MediaOptions): Promise<ExportMedia>; // the page's gatherMedia
};

const CANCELED: ExportOutcome = { status: "canceled" };
const ignore = () => {};
const failed = (code: ExportFailure, detail: string): ExportOutcome => ({ status: "failed", code, detail });
const canceledError = () => new DOMException("The export was canceled.", "AbortError");

// Calls fn and gives its promise; a synchronous throw becomes a rejection.
const promised = <T>(fn: () => Promise<T>): Promise<T> => new Promise<T>((resolve) => resolve(fn()));

// Waits for the promise, but rejects with an AbortError as soon as the signal aborts. The promise that loses is
// caught, so it never becomes an unhandled rejection, and the listener goes when either side settles.
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(ignore);
  if (signal.aborted) return Promise.reject(canceledError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = () => {
      if (settle()) reject(canceledError());
    };
    signal.addEventListener("abort", onAbort);
    promise.then(
      (value) => {
        if (settle()) resolve(value);
      },
      (error: unknown) => {
        if (settle()) reject(error);
      },
    );
  });
}

type Try = {
  attempt: number; // numbered from 1
  acceleration: Acceleration;
  sink: ByteSink;
  job: { doc: TimelineDoc; video: VideoSettings; fonts: FontBundle; media: ExportMedia; sound: boolean };
};

// One worker, from its start message to an end. Messages are handled in the order they arrive; a chunk's write and
// the close at done hold back the messages after them. The worker is terminated exactly once, at the end.
function runTry(request: ExportRequest, deps: RunDeps, run: Try): Promise<ExportOutcome> {
  const { signal } = request;
  return new Promise<ExportOutcome>((resolve) => {
    if (signal.aborted) {
      resolve(CANCELED);
      return;
    }

    let worker: ExportWorker | null = null;
    let ended = false;
    let busy = false; // a write or the close is under way
    let finishing = false; // the done message was handled: only the close decides the outcome
    const backlog: FromWorker[] = [];

    let listening = false;
    const stopListening = () => {
      if (!listening) return;
      listening = false;
      signal.removeEventListener("abort", onAbort);
    };
    const end = (outcome: ExportOutcome) => {
      if (ended) return;
      ended = true;
      backlog.length = 0;
      stopListening();
      worker?.terminate();
      resolve(outcome);
    };
    const onAbort = () => end(CANCELED);

    // Handles what is waiting, one message at a time, until one has to wait for the disk.
    const drain = () => {
      while (!ended && !busy && backlog.length > 0) handle(backlog.shift()!);
    };
    const receive = (message: FromWorker) => {
      if (ended) return;
      backlog.push(message);
      drain();
    };
    const afterward = (then: () => void) => {
      busy = false;
      if (ended) return;
      then();
      drain();
    };

    const handle = (message: FromWorker) => {
      switch (message.type) {
        case "chunk": {
          busy = true;
          promised(() => run.sink.write(message.position, message.data)).then(
            () =>
              afterward(() => {
                try {
                  worker!.postMessage({ type: "ack", seq: message.seq });
                } catch (error) {
                  end(failed("worker", failureOf(error, "worker").detail));
                }
              }),
            (error: unknown) => afterward(() => end({ status: "failed", ...failureOf(error, "write") })),
          );
          return;
        }
        case "progress":
          request.onProgress({ attempt: run.attempt, framesDone: message.framesDone, totalFrames: message.totalFrames });
          return;
        case "done": {
          // The file is finished: from here on a cancel, a worker error or an unreadable message changes nothing.
          busy = true;
          finishing = true;
          stopListening();
          promised(() => run.sink.close()).then(
            () => afterward(() => end({ status: "done", bytes: message.bytes, hasAudio: message.hasAudio, acceleration: run.acceleration })),
            (error: unknown) => afterward(() => end(failed("write", failureOf(error, "write").detail))),
          );
          return;
        }
        case "failed":
          end(failed(message.code, message.detail));
          return;
      }
    };

    const broke = (detail: string) => () => {
      if (finishing) return;
      end(failed("worker", detail));
    };

    try {
      worker = deps.createWorker();
    } catch (error) {
      end(failed("worker", failureOf(error, "worker").detail));
      return;
    }
    worker.addEventListener("message", (event) => receive(event.data));
    worker.addEventListener("messageerror", broke("A message from the export worker could not be read."));
    worker.addEventListener("error", broke("The export worker failed or did not load."));
    signal.addEventListener("abort", onAbort);
    listening = true;
    try {
      worker.postMessage({ type: "start", job: { ...run.job, acceleration: run.acceleration } });
    } catch (error) {
      end(failed("worker", failureOf(error, "worker").detail));
    }
  });
}

// A try that may be followed by the next, in a fresh copy of the same file.
const RETRIED: readonly ExportFailure[] = ["encoder", "size"];

// The sink the export holds now; null once it has been dropped, or before one was opened.
type Held = { sink: ByteSink | null };

async function steps(request: ExportRequest, deps: RunDeps, held: Held): Promise<ExportOutcome> {
  const { doc, size, target, signal } = request;

  try {
    held.sink = await target.open();
  } catch (error) {
    return failed("write", failureOf(error, "write").detail);
  }

  const frames = frameCount(doc);
  if (frames === 0) return failed("empty", "");
  const video = videoSettings(size, doc.fps);
  if (!video) return failed("size", `${size.width}×${size.height} at ${doc.fps} fps`);
  if (target.limit !== null && maxBytes(video, frames) > target.limit) return failed("too-long", `${frames} frames`);
  if (signal.aborted) return CANCELED;

  let fonts: FontBundle;
  try {
    fonts = await untilAborted(promised(() => deps.collectFonts(doc)), signal);
  } catch (error) {
    if (signal.aborted) return CANCELED;
    return failed("font", failureOf(error, "font").detail);
  }

  // A canceled export's read may finish later: it says nothing once the signal has aborted.
  const onReading = (filesRead: number, totalFiles: number) => {
    if (!signal.aborted) request.onReading(filesRead, totalFiles);
  };
  let media: ExportMedia;
  try {
    media = await untilAborted(promised(() => deps.collectMedia(doc, { signal, onReading, sound: request.sound, originals: request.originals })), signal);
  } catch (error) {
    if (signal.aborted) return CANCELED;
    return { status: "failed", ...failureOf(error, "media") };
  }

  const job = { doc, video, fonts, media, sound: request.sound };
  let first: ExportOutcome | null = null;
  for (const [index, acceleration] of ACCELERATION_ORDER.entries()) {
    if (index > 0) {
      try {
        held.sink = await target.open();
      } catch (error) {
        return failed("write", failureOf(error, "write").detail);
      }
    }
    const sink = held.sink!;
    const outcome = await runTry(request, deps, { attempt: index + 1, acceleration, sink, job });
    // A later try refused at this size says nothing about why the first one stopped: the first try's failure stands.
    if (first && outcome.status === "failed" && outcome.code === "size") return first;
    first ??= outcome;
    const again =
      outcome.status === "failed" && RETRIED.includes(outcome.code) && index + 1 < ACCELERATION_ORDER.length && !signal.aborted;
    if (!again) return outcome;
    // The next try starts again from frame 0: say so now, so Cancel and the slower-encoder line show while the file is
    // reopened and the worker starts.
    request.onProgress({ attempt: index + 2, framesDone: 0, totalFrames: frames });
    // Only this try's bytes go; the file stays for the next.
    held.sink = null;
    await promised(() => sink.abort()).catch(ignore);
  }
  throw new ExportError("unknown", "No encoder setting was left to try.");
}

// Drops the bytes and then removes the file, without waiting for either: a write stuck on a slow or removed disk
// never keeps the outcome waiting.
function letGo(sink: ByteSink | null, target: ExportTarget): void {
  const dropped = sink ? promised(() => sink.abort()) : Promise.resolve();
  void dropped
    .catch(ignore)
    .then(() => target.discard())
    .catch(ignore);
}

// Never rejects. The outcome settles first; on every end but a finished file, the bytes are dropped and the file is
// removed in the same turn.
export function exportVideo(request: ExportRequest, deps: RunDeps): Promise<ExportOutcome> {
  const held: Held = { sink: null };
  return new Promise<ExportOutcome>((resolve) => {
    void steps(request, deps, held)
      .catch((error: unknown): ExportOutcome => ({ status: "failed", ...failureOf(error, "unknown") }))
      .then((outcome) => {
        resolve(outcome);
        if (outcome.status !== "done") letGo(held.sink, request.target);
      });
  });
}
