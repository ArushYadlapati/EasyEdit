import { describe, expect, it, vi } from "vitest";
import {
  SPEECH_MODEL,
  TranscribeError,
  createTranscriber,
  type TranscribeProgress,
  type TranscribeWorker,
} from "@/lib/captions/speech/client";
import type { FromTranscriber, ToTranscriber } from "@/lib/captions/speech/protocol";

// A worker that only writes down what it is sent; the test delivers its messages, and says when it breaks.
function pretendWorker() {
  const posted: ToTranscriber[] = [];
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  let terminated = false;
  const fake = {
    postMessage: (message: ToTranscriber) => void posted.push(message),
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    terminate: () => void (terminated = true),
  };
  const emit = (type: string, event: unknown) => (listeners.get(type) ?? []).forEach((listener) => listener(event));
  return {
    worker: fake as unknown as TranscribeWorker,
    posted,
    deliver: (message: FromTranscriber) => emit("message", { data: message }),
    fail: (type: "error" | "messageerror") => emit(type, {}),
    terminated: () => terminated,
  };
}

function setup() {
  const workers: ReturnType<typeof pretendWorker>[] = [];
  const start = vi.fn(() => {
    const pretend = pretendWorker();
    workers.push(pretend);
    return pretend.worker;
  });
  return { transcriber: createTranscriber(start), start, workers };
}

// The promise's outcome so far: "pending" until it settles. It looks after a full turn of the event loop.
async function outcome(promise: Promise<unknown>): Promise<unknown> {
  let seen: unknown = "pending";
  promise.then((value) => (seen = { value }), (error: unknown) => (seen = { error }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return seen;
}

const file = new Blob(["sound"]);
const WORDS = [
  { t: "Hello", s: 0, e: 400 },
  { t: "there", s: 400, e: 900 },
];

describe("the transcriber", () => {
  it("names the base Whisper model with word times", () => {
    expect(SPEECH_MODEL).toBe("onnx-community/whisper-base_timestamped");
  });

  it("starts a worker, sends it the file and resolves with its words, then ends the worker", async () => {
    const { transcriber, start, workers } = setup();
    const result = transcriber.transcribe(file);
    expect(start).toHaveBeenCalledTimes(1);
    expect(workers[0].posted).toEqual([{ type: "start", file }]);
    workers[0].deliver({ type: "done", words: WORDS, seconds: 12 });
    await expect(result).resolves.toEqual(WORDS);
    expect(workers[0].terminated()).toBe(true);
  });

  it("forwards progress", async () => {
    const { transcriber, workers } = setup();
    const seen: TranscribeProgress[] = [];
    const result = transcriber.transcribe(file, { onProgress: (p) => seen.push(p) });
    workers[0].deliver({ type: "progress", stage: "sound", done: 3, total: 12 });
    workers[0].deliver({ type: "progress", stage: "model", done: 100, total: 1000 });
    workers[0].deliver({ type: "progress", stage: "speech", done: 12, total: 12 });
    workers[0].deliver({ type: "done", words: [], seconds: 12 });
    await expect(result).resolves.toEqual([]);
    expect(seen).toEqual([
      { stage: "sound", done: 3, total: 12 },
      { stage: "model", done: 100, total: 1000 },
      { stage: "speech", done: 12, total: 12 },
    ]);
  });

  it("rejects with the worker's failure code and ends the worker", async () => {
    const { transcriber, workers } = setup();
    const result = transcriber.transcribe(file);
    workers[0].deliver({ type: "failed", code: "no-sound", detail: "The file has no sound track." });
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranscribeError);
    expect(error).toMatchObject({ code: "no-sound", message: "The file has no sound track." });
    expect(workers[0].terminated()).toBe(true);
  });

  it.each(["error", "messageerror"] as const)("rejects as unknown when the worker reports %s", async (type) => {
    const { transcriber, workers } = setup();
    const result = transcriber.transcribe(file);
    workers[0].fail(type);
    await expect(result).rejects.toMatchObject({ code: "unknown" });
    expect(workers[0].terminated()).toBe(true);
  });

  it("on abort ends the worker at once and rejects as cancelled; what the worker sends later is ignored", async () => {
    const { transcriber, workers } = setup();
    const controller = new AbortController();
    const seen: TranscribeProgress[] = [];
    const result = transcriber.transcribe(file, { signal: controller.signal, onProgress: (p) => seen.push(p) });
    workers[0].deliver({ type: "progress", stage: "speech", done: 5, total: 60 });
    controller.abort();
    expect(workers[0].terminated()).toBe(true);
    workers[0].deliver({ type: "progress", stage: "speech", done: 10, total: 60 });
    workers[0].deliver({ type: "done", words: WORDS, seconds: 60 });
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranscribeError);
    expect(error).toMatchObject({ code: "cancelled" });
    expect(seen).toEqual([{ stage: "speech", done: 5, total: 60 }]);
  });

  it("rejects as cancelled without starting a worker when the signal is already aborted", async () => {
    const { transcriber, start } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(transcriber.transcribe(file, { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(start).not.toHaveBeenCalled();
  });

  it("ignores everything after it settles: no second answer, no progress, no abort", async () => {
    const { transcriber, workers } = setup();
    const controller = new AbortController();
    const seen: TranscribeProgress[] = [];
    const result = transcriber.transcribe(file, { signal: controller.signal, onProgress: (p) => seen.push(p) });
    workers[0].deliver({ type: "done", words: WORDS, seconds: 12 });
    workers[0].deliver({ type: "failed", code: "model", detail: "late" });
    workers[0].deliver({ type: "progress", stage: "speech", done: 12, total: 12 });
    workers[0].fail("error");
    controller.abort();
    expect(await outcome(result)).toEqual({ value: WORDS });
    expect(seen).toEqual([]);
  });

  it("gives every call a fresh worker", async () => {
    const { transcriber, start, workers } = setup();
    const first = transcriber.transcribe(file);
    workers[0].deliver({ type: "failed", code: "model", detail: "offline" });
    await expect(first).rejects.toMatchObject({ code: "model" });
    const second = transcriber.transcribe(file);
    expect(start).toHaveBeenCalledTimes(2);
    expect(workers[1].posted).toEqual([{ type: "start", file }]);
    workers[1].deliver({ type: "done", words: WORDS, seconds: 12 });
    await expect(second).resolves.toEqual(WORDS);
    expect(workers[0].terminated()).toBe(true);
    expect(workers[1].terminated()).toBe(true);
  });

  it("rejects as unknown when the worker cannot be started", async () => {
    const transcriber = createTranscriber(() => {
      throw new Error("no workers here");
    });
    await expect(transcriber.transcribe(file)).rejects.toMatchObject({ code: "unknown", message: "no workers here" });
  });
});
