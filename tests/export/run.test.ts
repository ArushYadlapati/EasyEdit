import { describe, expect, it, vi } from "vitest";
import type { FontBundle } from "@/lib/export/fonts";
import { ExportError } from "@/lib/export/messages";
import type { ExportSize } from "@/lib/export/presets";
import type { ExportOutcome } from "@/lib/export/protocol";
import { exportVideo, type ExportRequest, type RunDeps } from "@/lib/export/run";
import { MEMORY_LIMIT_BYTES } from "@/lib/export/sinks";
import { createEmptyDoc, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, text } from "../editor/fixtures";
import { NO_FONTS, NO_MEDIA, fakeTarget, fakeWorker, file, tick, type FakeTarget, type FakeWorker } from "./fakes";

type Over = {
  doc?: TimelineDoc; size?: ExportSize; target?: FakeTarget; collectFonts?: () => Promise<FontBundle>; createWorker?: () => FakeWorker;
  collectMedia?: RunDeps["collectMedia"]; aborted?: boolean;
};

function start(over: Over = {}) {
  const workers: FakeWorker[] = [];
  const target = over.target ?? fakeTarget();
  const abort = new AbortController();
  const added = vi.spyOn(abort.signal, "addEventListener");
  const removed = vi.spyOn(abort.signal, "removeEventListener");
  if (over.aborted) abort.abort();
  const progress: [number, number, number][] = [];
  const reading: [number, number][] = [];
  const request: ExportRequest = {
    doc: over.doc ?? sampleDoc(), size: over.size ?? { width: 1080, height: 1920 }, target, signal: abort.signal,
    onProgress: (p) => progress.push([p.attempt, p.framesDone, p.totalFrames]),
    onReading: (filesRead, totalFiles) => reading.push([filesRead, totalFiles]),
  };
  const createWorker = over.createWorker ?? (() => { const worker = fakeWorker(); workers.push(worker); return worker; });
  const done = exportVideo(request, {
    createWorker,
    collectFonts: over.collectFonts ?? (async () => NO_FONTS),
    collectMedia: over.collectMedia ?? (async () => NO_MEDIA),
  });
  return { workers, target, abort, progress, reading, done, added, removed };
}
type Run = ReturnType<typeof start>;
const chunk = (seq: number) => ({ type: "chunk" as const, seq, position: seq * 2, data: new Uint8Array([seq, seq]) });
// 20 minutes: far over the limit for holding a video in memory
function longDoc(): TimelineDoc {
  const doc = createEmptyDoc("short_9x16");
  doc.tracks[1].clips = [text("a", 0, 36_000)];
  return doc;
}

describe("an ordinary export", () => {
  it("starts a worker with the snapshot, writes its chunks, reports progress and keeps the file", async () => {
    const run = start();
    await tick();
    const [worker] = run.workers;
    expect(worker.posted).toEqual([{ type: "start", job: {
      doc: sampleDoc(), video: { width: 1080, height: 1920, fps: 30, codec: "avc1.640028", bitrate: 8_000_000 },
      acceleration: "no-preference", fonts: NO_FONTS, media: NO_MEDIA,
    } }]);
    worker.emit(chunk(0));
    worker.emit(chunk(1));
    await tick();
    expect(run.target.sinks[0].writes).toEqual([[0, [0, 0]], [2, [1, 1]]]);
    expect(worker.posted.slice(1)).toEqual([{ type: "ack", seq: 0 }, { type: "ack", seq: 1 }]);
    worker.emit({ type: "progress", framesDone: 60, totalFrames: 120 });
    expect(run.progress).toEqual([[1, 60, 120]]); // nothing is pending, so it is handled at once
    worker.emit({ type: "done", bytes: 4, hasAudio: true });
    expect(await run.done).toEqual({ status: "done", bytes: 4, hasAudio: true, acceleration: "no-preference" });
    expect(run.target.sinks[0]).toMatchObject({ closed: 1, aborted: 0 });
    expect([worker.terminated, run.target.discarded]).toEqual([1, 0]);
  });

  it("handles one message at a time: a second chunk waits for the first write", async () => {
    let written = () => {};
    const run = start({ target: fakeTarget({ write: () => new Promise<void>((resolve) => { written = resolve; }) }) });
    await tick();
    run.workers[0].emit(chunk(0));
    run.workers[0].emit(chunk(1));
    await tick();
    expect(run.target.sinks[0].writes).toHaveLength(1);
    written();
    await tick();
    expect(run.target.sinks[0].writes).toHaveLength(2);
  });

  it("removes every listener it added to the signal", async () => {
    const run = start();
    await tick();
    run.workers[0].emit({ type: "done", bytes: 1, hasAudio: true });
    await run.done;
    const aborts = (spy: typeof run.added) => spy.mock.calls.filter(([type]) => type === "abort").length;
    expect(aborts(run.added)).toBeGreaterThan(0);
    expect(aborts(run.removed)).toBe(aborts(run.added));
  });

  it("answers a chunk only after it is written", async () => {
    let written = () => {};
    const run = start({ target: fakeTarget({ write: () => new Promise<void>((resolve) => { written = resolve; }) }) });
    await tick();
    run.workers[0].emit(chunk(0));
    await tick();
    expect(run.workers[0].posted.filter((m) => m.type === "ack")).toEqual([]);
    written();
    await tick();
    expect(run.workers[0].posted.filter((m) => m.type === "ack")).toEqual([{ type: "ack", seq: 0 }]);
  });

});

describe("every way out stops the worker and settles the file", () => {
  const exits: [string, (run: Run) => void, ExportOutcome["status"]][] = [
    ["done", (run) => run.workers[0].emit({ type: "done", bytes: 1, hasAudio: true }), "done"],
    ["cancel", (run) => run.abort.abort(), "canceled"],
    ["a font failure in the worker", (run) => run.workers[0].emit({ type: "failed", code: "font", detail: "Geist" }), "failed"],
    ["a decode failure in the worker", (run) => run.workers[0].emit({ type: "failed", code: "decode", detail: "prev-a" }), "failed"],
    ["a worker that crashes or never loads", (run) => run.workers[0].crash(), "failed"],
    ["a message that cannot be read", (run) => run.workers[0].garble(), "failed"],
  ];
  it.each(exits)("%s", async (_name, leave, status) => {
    const run = start();
    await tick();
    leave(run);
    expect((await run.done).status).toBe(status);
    await tick(); // the discard follows the abort
    const [sink] = run.target.sinks;
    const settled = status === "done" ? [1, 0, 0, 0] : [0, 1, 0, 1]; // closed, aborted, writes, discarded
    expect(run.workers).toHaveLength(1); // none of these is tried again
    expect(run.workers[0].terminated).toBe(1);
    expect([sink.closed, sink.aborted, sink.writes.length, run.target.discarded]).toEqual(settled);
    // whatever the worker says afterwards changes nothing
    run.workers[0].emit(chunk(9));
    run.workers[0].emit({ type: "done", bytes: 1, hasAudio: true });
    await tick();
    expect([sink.closed, sink.aborted, sink.writes.length, run.target.discarded]).toEqual(settled);
    expect(run.workers[0].terminated).toBe(1);
  });

  it("names each failure", async () => {
    const crashed = start();
    await tick();
    crashed.workers[0].crash();
    expect(await crashed.done).toMatchObject({ status: "failed", code: "worker" });

    const garbled = start();
    await tick();
    garbled.workers[0].garble();
    expect(await garbled.done).toMatchObject({ status: "failed", code: "worker" });

    const refused = fakeWorker({ postMessage: () => { throw new DOMException("cannot copy", "DataCloneError"); } });
    const unsent = start({ createWorker: () => refused });
    expect(await unsent.done).toMatchObject({ status: "failed", code: "worker" });
    expect(refused.terminated).toBe(1);

    const full = start({ target: fakeTarget({ write: async () => { throw new Error("disk full"); } }) });
    await tick();
    full.workers[0].emit(chunk(0));
    expect(await full.done).toMatchObject({ status: "failed", code: "write" });
    expect([full.workers[0].terminated, full.target.sinks[0].aborted]).toEqual([1, 1]);

    const tooLong = start({ target: fakeTarget({ write: async () => { throw new ExportError("too-long", ""); } }) });
    await tick();
    tooLong.workers[0].emit(chunk(0));
    expect(await tooLong.done).toMatchObject({ status: "failed", code: "too-long" });

    const closing = start({ target: fakeTarget({ close: async () => { throw new Error("gone"); } }) });
    await tick();
    closing.workers[0].emit({ type: "done", bytes: 1, hasAudio: true });
    expect(await closing.done).toMatchObject({ status: "failed", code: "write" });
    expect(closing.target.sinks[0].aborted).toBe(1);

    const blocked = start({ createWorker: () => { throw new Error("blocked"); } });
    expect(await blocked.done).toMatchObject({ status: "failed", code: "worker" });
    expect(blocked.target.sinks[0].aborted).toBe(1);
  });
});

describe("before a worker starts", () => {
  it("refuses what cannot be exported, and still discards the chosen file", async () => {
    const cases = [
      [start({ doc: createEmptyDoc("short_9x16") }), "empty"],
      [start({ size: { width: 7680, height: 4320 } }), "size"],
      [start({ doc: longDoc(), target: fakeTarget({ limit: MEMORY_LIMIT_BYTES }) }), "too-long"],
      [start({ collectFonts: async () => { throw new Error("offline"); } }), "font"],
    ] as const;
    for (const [run, code] of cases) {
      expect(await run.done, code).toMatchObject({ status: "failed", code });
      await tick();
      expect(run.workers).toEqual([]);
      expect(run.target.sinks.map((s) => [s.closed, s.aborted])).toEqual([[0, 1]]);
      expect(run.target.discarded, code).toBe(1);
    }
    const denied = start({ target: fakeTarget({ open: async () => { throw new Error("denied"); } }) });
    expect(await denied.done).toMatchObject({ status: "failed", code: "write" });
    await tick();
    expect([denied.workers.length, denied.target.discarded]).toEqual([0, 1]);
    const early = start({ aborted: true });
    expect(await early.done).toEqual({ status: "canceled" });
    expect([early.workers.length, early.target.sinks[0].aborted]).toEqual([0, 1]);
  });

  it("a cancel before it starts asks for no fonts and no media", async () => {
    const collectFonts = vi.fn(async () => NO_FONTS);
    const collectMedia = vi.fn(async () => NO_MEDIA);
    const run = start({ aborted: true, collectFonts, collectMedia });
    expect(await run.done).toEqual({ status: "canceled" });
    expect([collectFonts.mock.calls.length, collectMedia.mock.calls.length]).toEqual([0, 0]);
  });

  it("a long video is fine when the bytes go to a file", async () => {
    const run = start({ doc: longDoc() });
    await tick();
    expect(run.workers).toHaveLength(1);
    run.abort.abort();
    await run.done;
  });

  it("a cancel while the fonts load ends at once and makes no worker", async () => {
    let fontsReady = () => {};
    const run = start({ collectFonts: () => new Promise((resolve) => { fontsReady = () => resolve(NO_FONTS); }) });
    await tick();
    run.abort.abort();
    let settled: unknown = null;
    void run.done.then((outcome) => { settled = outcome; });
    await tick();
    expect(settled).toEqual({ status: "canceled" }); // before the fonts are in
    fontsReady();
    await tick();
    expect(run.workers).toEqual([]);
    expect(run.target.sinks[0].aborted).toBe(1);
  });
});

describe("a cancel never waits", () => {
  it("a cancel while a write is pending ends at once, and answers nothing after it", async () => {
    let written = () => {};
    const run = start({ target: fakeTarget({ write: () => new Promise<void>((resolve) => { written = resolve; }) }) });
    await tick();
    run.workers[0].emit(chunk(0));
    await tick();
    run.abort.abort();
    expect(await run.done).toEqual({ status: "canceled" });
    written();
    await tick();
    expect([run.workers[0].terminated, run.target.sinks[0].aborted, run.target.discarded]).toEqual([1, 1, 1]);
    expect(run.workers[0].posted.filter((m) => m.type === "ack")).toEqual([]);
  });

  it("a cancel does not wait for the bytes to be dropped, and the file goes only once they are", async () => {
    const run = start();
    await tick();
    const [sink] = run.target.sinks;
    let dropped = () => {};
    sink.abort = () => new Promise<void>((resolve) => { dropped = resolve; }); // a disk that is slow to let go
    run.abort.abort();
    expect(await run.done).toEqual({ status: "canceled" });
    await tick();
    expect(run.target.discarded).toBe(0);
    dropped();
    await tick();
    expect(run.target.discarded).toBe(1);
  });

  it("a cancel that comes while the finished file is being closed keeps the file", async () => {
    let closed = () => {};
    const run = start({ target: fakeTarget({ close: () => new Promise<void>((resolve) => { closed = resolve; }) }) });
    await tick();
    run.workers[0].emit({ type: "done", bytes: 4, hasAudio: true });
    await tick();
    run.abort.abort(); // too late: every frame is in the file
    closed();
    expect(await run.done).toMatchObject({ status: "done" });
    await tick();
    expect([run.target.sinks[0].closed, run.target.sinks[0].aborted, run.target.discarded]).toEqual([1, 0, 0]);
  });
});

describe("the second try", () => {
  it.each(["encoder", "size"] as const)("after a failure of kind %s, starts again from frame 0 with the software encoder, in a fresh copy of the same file", async (code) => {
    const run = start();
    await tick();
    run.workers[0].emit({ type: "progress", framesDone: 30, totalFrames: 120 });
    run.workers[0].emit({ type: "failed", code, detail: "x" });
    await tick();
    expect(run.workers).toHaveLength(2);
    expect(run.workers[0].terminated).toBe(1);
    expect(run.target.sinks.map((s) => [s.closed, s.aborted])).toEqual([[0, 1], [0, 0]]);
    expect(run.target.discarded).toBe(0); // the file stays for the second try
    expect(run.workers[1].posted[0]).toMatchObject({ type: "start", job: { acceleration: "prefer-software" } });
    run.workers[1].emit({ type: "progress", framesDone: 10, totalFrames: 120 });
    expect(run.progress).toEqual([[1, 30, 120], [2, 10, 120]]);
    run.workers[1].emit({ type: "done", bytes: 5, hasAudio: true });
    expect(await run.done).toEqual({ status: "done", bytes: 5, hasAudio: true, acceleration: "prefer-software" });
    await tick();
    expect(run.target.sinks[1]).toMatchObject({ closed: 1, aborted: 0 });
    expect([run.workers[1].terminated, run.target.discarded]).toEqual([1, 0]);
  });

  it("gives up after the second try, and does not try again after a cancel", async () => {
    const run = start();
    await tick();
    run.workers[0].emit({ type: "failed", code: "encoder", detail: "x" });
    await tick();
    run.workers[1].emit({ type: "failed", code: "encoder", detail: "y" });
    expect(await run.done).toEqual({ status: "failed", code: "encoder", detail: "y" });
    await tick();
    expect(run.workers).toHaveLength(2);
    expect(run.target.sinks.map((s) => s.aborted)).toEqual([1, 1]);
    expect(run.target.discarded).toBe(1); // once, at the final end

    const canceled = start();
    await tick();
    canceled.abort.abort();
    canceled.workers[0].emit({ type: "failed", code: "encoder", detail: "x" });
    expect(await canceled.done).toEqual({ status: "canceled" });
    expect(canceled.workers).toHaveLength(1);
  });
});

describe("media", () => {
  const MEDIA = { files: { "prev-a": file("a.mp4") }, clips: { c1: { fileId: "prev-a" }, c2: { fileId: "prev-a" } } };

  it("collects the media after the fonts, passes reading progress on, and posts it with the job", async () => {
    const order: string[] = [];
    const run = start({
      collectFonts: async () => { order.push("fonts"); return NO_FONTS; },
      collectMedia: async (_doc, options) => {
        order.push("media");
        options.onReading(0, 1);
        options.onReading(1, 1);
        return MEDIA;
      },
    });
    await tick();
    expect(order).toEqual(["fonts", "media"]);
    expect(run.reading).toEqual([[0, 1], [1, 1]]);
    expect(run.workers[0].posted[0]).toMatchObject({ type: "start", job: { media: MEDIA } });
  });

  it("names what stopped it: media not ready, or a file that could not be read", async () => {
    const cases = [[new ExportError("waiting", "c1"), "waiting"], [new ExportError("media", "prev-a"), "media"], [new Error("odd"), "media"]] as const;
    for (const [error, code] of cases) {
      const run = start({ collectMedia: async () => { throw error; } });
      expect(await run.done, code).toMatchObject({ status: "failed", code });
      expect(run.workers).toEqual([]);
      expect(run.target.sinks.map((s) => [s.closed, s.aborted])).toEqual([[0, 1]]);
    }
  });

  it("a cancel while the media is read ends at once and makes no worker", async () => {
    let signal: AbortSignal | null = null;
    let ready = () => {};
    const run = start({
      collectMedia: (_doc, options) => new Promise((resolve) => { signal = options.signal; ready = () => resolve(NO_MEDIA); }),
    });
    await tick();
    expect(signal).toBe(run.abort.signal);
    run.abort.abort();
    let settled: unknown = null;
    void run.done.then((outcome) => { settled = outcome; });
    await tick();
    expect(settled).toEqual({ status: "canceled" }); // before the read finishes
    ready();
    await tick();
    expect(run.workers).toEqual([]);
    expect([run.target.sinks[0].aborted, run.target.discarded]).toEqual([1, 1]);
  });

  it("the second try posts the same files again, read once", async () => {
    const collectMedia = vi.fn(async () => MEDIA);
    const run = start({ collectMedia });
    await tick();
    run.workers[0].emit({ type: "failed", code: "encoder", detail: "x" });
    await tick();
    expect(collectMedia).toHaveBeenCalledTimes(1);
    expect(run.workers[1].posted[0]).toMatchObject({ type: "start", job: { media: MEDIA, acceleration: "prefer-software" } });
  });
});
