import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorStore } from "@/lib/editor/store";
import type { ThumbnailResult } from "@/lib/editor/thumbnail";
import { startThumbnailTrigger, type ThumbnailTriggerDeps } from "@/lib/editor/thumbnail-trigger";
import type { EditorInit } from "@/lib/editor/types";
import { entry, makeStore } from "./fixtures";

const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

// A capture's answer, or a function called only when the capture runs.
type Answer = ThumbnailResult | (() => Promise<ThumbnailResult>);

let store: EditorStore;
const stops: (() => void)[] = []; // every trigger a test started, stopped after it

function setup({ storedVersion = 5, init = {}, results = [], before }: {
  storedVersion?: number | null;
  init?: Partial<EditorInit>;
  results?: Answer[];
  before?: (store: EditorStore) => void;
} = {}) {
  vi.useFakeTimers();
  store = makeStore({ version: 5, ...init });
  before?.(store);
  const capture = vi.fn<ThumbnailTriggerDeps["capture"]>(() => {
    const next = results.shift() ?? { kind: "picture", jpeg: JPEG };
    return typeof next === "function" ? next() : Promise.resolve(next);
  });
  const upload = vi.fn<ThumbnailTriggerDeps["upload"]>(async () => ({ ok: true, saved: true }));
  const listeners = new Set<() => void>();
  const stop = startThumbnailTrigger({
    store,
    storedVersion,
    capture,
    upload,
    onLibraryChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  });
  stops.push(stop);
  const changed = () => [...listeners].forEach((listener) => listener());
  const listening = () => listeners.size;
  return { store, capture, upload, changed, listening, stop };
}

const saved = (v: number) => store.getState().replaceServer(store.getState().server.doc, v);
const flush = () => vi.advanceTimersByTimeAsync(0);
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

describe("startThumbnailTrigger", () => {
  it("draws once, 4 seconds after a confirmed save, from the saved doc", async () => {
    const { capture, upload } = setup();
    saved(6);
    await wait(3_999);
    expect(capture).not.toHaveBeenCalled();
    await wait(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBe(store.getState().server.doc);
    await flush();
    expect(upload.mock.calls).toEqual([[6, JPEG]]);
  });

  it("a burst of saves makes one picture, of the newest version", async () => {
    const { capture, upload } = setup();
    saved(6);
    await wait(2_000);
    saved(7);
    await wait(2_000);
    saved(8);
    await wait(3_999);
    expect(capture).not.toHaveBeenCalled();
    await wait(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls).toEqual([[8, JPEG]]);
  });

  it("on open, a missing or older picture is drawn once", async () => {
    const missing = setup({ storedVersion: null });
    await wait(4_000);
    expect(missing.upload.mock.calls).toEqual([[5, JPEG]]);
    await wait(60_000);
    expect(missing.upload).toHaveBeenCalledTimes(1);
    missing.stop();

    const older = setup({ storedVersion: 4 });
    await wait(4_000);
    expect(older.upload.mock.calls).toEqual([[5, JPEG]]);
    older.stop();

    const current = setup({ storedVersion: 5 });
    await wait(60_000);
    expect(current.capture).not.toHaveBeenCalled();
  });

  it("waits for an empty queue and Saved", async () => {
    const { capture, upload } = setup();
    const s = () => store.getState();
    s().edit([{ op: "remove_clip", clipId: "x2" }], "Delete");
    s().edit([{ op: "remove_clip", clipId: "x1" }], "Delete");
    s().ack("g1", 6, []);
    expect(s().server.version).toBe(6);
    expect(s().queue).toHaveLength(1);
    expect(s().status).toBe("saved");
    await wait(10_000);
    expect(capture).not.toHaveBeenCalled();

    s().ack("g2", 7, []);
    await wait(4_000);
    expect(upload.mock.calls).toEqual([[7, JPEG]]);

    s().setStatus("offline");
    saved(8);
    await wait(10_000);
    expect(capture).toHaveBeenCalledTimes(1);

    s().setStatus("saved");
    await wait(4_000);
    expect(upload.mock.calls).toEqual([[7, JPEG], [8, JPEG]]);
  });

  it("waits while playing, dragging or typing in place", async () => {
    const { capture, upload } = setup();
    const s = () => store.getState();
    saved(6);
    s().play();
    await wait(10_000);
    expect(capture).not.toHaveBeenCalled();
    s().pause();
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(1);

    saved(7);
    s().setGesture([{ op: "move_clip", clipId: "x2", start: 95 }]);
    await wait(10_000);
    expect(capture).toHaveBeenCalledTimes(1);
    s().setGesture(null);
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(2);

    saved(8);
    s().setTextEdit("x1");
    await wait(10_000);
    expect(capture).toHaveBeenCalledTimes(2);
    s().setTextEdit(null);
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(3);

    expect(upload.mock.calls.map(([version]) => version)).toEqual([6, 7, 8]);
  });

  it("waits while an export runs, and a capture under way stops when one starts", async () => {
    const { capture } = setup();
    const s = () => store.getState();
    s().setExporting(true);
    saved(6);
    await wait(10_000);
    expect(capture).not.toHaveBeenCalled();
    s().setExporting(false);
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(1);

    const held = deferred<ThumbnailResult>();
    let current = () => true;
    capture.mockImplementationOnce((_doc, isCurrent) => {
      current = isCurrent;
      return held.promise;
    });
    saved(7);
    await wait(4_000);
    expect([capture.mock.calls.length, current()]).toEqual([2, true]);
    s().setExporting(true);
    expect(current()).toBe(false);
  });

  it("never for a viewer or a deleted project", async () => {
    const viewer = setup({ init: { canEdit: false }, storedVersion: null });
    await wait(60_000);
    expect(viewer.capture).not.toHaveBeenCalled();
    viewer.stop();

    const deleted = setup();
    store.getState().setStatus("deleted");
    saved(6);
    await wait(60_000);
    expect(deleted.capture).not.toHaveBeenCalled();
  });

  it("a capture made stale by a newer save, by losing edit access, by deletion or by leaving is dropped", async () => {
    let first = deferred<ThumbnailResult>();
    const newer = setup({ results: [() => first.promise] });
    saved(6);
    await wait(4_000);
    saved(7);
    first.resolve({ kind: "picture", jpeg: JPEG });
    await flush();
    expect(newer.upload).not.toHaveBeenCalled();
    await wait(4_000);
    expect(newer.upload.mock.calls).toEqual([[7, JPEG]]);
    newer.stop();

    first = deferred<ThumbnailResult>();
    const revoked = setup({ results: [() => first.promise] });
    saved(6);
    await wait(4_000);
    store.getState().revokeEditing();
    first.resolve({ kind: "picture", jpeg: JPEG });
    await flush();
    expect(revoked.upload).not.toHaveBeenCalled();
    revoked.stop();

    first = deferred<ThumbnailResult>();
    const deleted = setup({ results: [() => first.promise] });
    saved(6);
    await wait(4_000);
    store.getState().setStatus("deleted");
    first.resolve({ kind: "picture", jpeg: JPEG });
    await flush();
    expect(deleted.upload).not.toHaveBeenCalled();
    deleted.stop();

    first = deferred<ThumbnailResult>();
    const left = setup({ results: [() => first.promise] });
    saved(6);
    await wait(4_000);
    left.stop();
    expect(left.capture.mock.calls[0][1]()).toBe(false); // so the drawing stops at its next step
    first.resolve({ kind: "picture", jpeg: JPEG });
    await flush();
    expect(left.upload).not.toHaveBeenCalled();
    await wait(60_000);
    expect(left.capture).toHaveBeenCalledTimes(1);
  });

  it("playing during a capture drops it and draws the same version after the pause", async () => {
    const first = deferred<ThumbnailResult>();
    const { capture, upload } = setup({ results: [() => first.promise] });
    saved(6);
    await wait(4_000);
    const isCurrent = capture.mock.calls[0][1];
    expect(isCurrent()).toBe(true);
    store.getState().play();
    expect(isCurrent()).toBe(false);
    first.resolve({ kind: "picture", jpeg: JPEG });
    await flush();
    expect(upload).not.toHaveBeenCalled();
    store.getState().pause();
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls).toEqual([[6, JPEG]]);
  });

  it("a capture under way is not started a second time", async () => {
    const first = deferred<ThumbnailResult>();
    const { capture, upload } = setup({ results: [() => first.promise] });
    saved(6);
    await wait(4_000);
    store.getState().setStatus("saving");
    store.getState().setStatus("saved");
    await wait(10_000);
    expect(capture).toHaveBeenCalledTimes(1);
    first.resolve({ kind: "picture", jpeg: JPEG });
    await flush();
    await wait(60_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls).toEqual([[6, JPEG]]);
  });

  it("a capture that stopped is drawn again, even when the editor is quiet by the time it ends", async () => {
    const first = deferred<ThumbnailResult>();
    const { capture, upload } = setup({ results: [() => first.promise] });
    saved(6);
    await wait(4_000);
    store.getState().play();
    store.getState().pause();
    first.resolve({ kind: "stopped" });
    await flush();
    expect(upload).not.toHaveBeenCalled();
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls).toEqual([[6, JPEG]]);
  });

  it("a queue that empties with no new version still arms the picture", async () => {
    const { upload } = setup();
    const s = () => store.getState();
    s().edit([{ op: "remove_clip", clipId: "x2" }], "Delete");
    s().edit([{ op: "remove_clip", clipId: "x1" }], "Delete");
    s().ack("g1", 6, []);
    await wait(10_000);
    expect(upload).not.toHaveBeenCalled();
    s().refuse("g2", "STALE"); // the queue empties; the version and the status stay as they were
    await wait(4_000);
    expect(upload.mock.calls).toEqual([[6, JPEG]]);
  });

  it("after stop, nothing more is drawn", async () => {
    let listening = 0;
    const stopped = setup({
      before: (s) => {
        const subscribe = s.subscribe;
        s.subscribe = (listener) => {
          listening += 1;
          const unsubscribe = subscribe(listener);
          return () => {
            listening -= 1;
            unsubscribe();
          };
        };
      },
    });
    expect(listening).toBe(1);
    stopped.stop();
    expect(listening).toBe(0);
    saved(6);
    await wait(60_000);
    expect(stopped.capture).not.toHaveBeenCalled();

    const waiting = setup({ results: [{ kind: "wait" }] });
    saved(6);
    await wait(4_000);
    expect(waiting.listening()).toBe(1);
    waiting.stop();
    expect(waiting.listening()).toBe(0);
    waiting.changed();
    await wait(60_000);
    expect(waiting.capture).toHaveBeenCalledTimes(1);
    expect(waiting.upload).not.toHaveBeenCalled();
  });

  it("while media is not ready it waits for the library to change, and never polls", async () => {
    const { capture, upload, changed, listening } = setup({ results: [{ kind: "wait" }] });
    saved(6);
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(listening()).toBe(1);
    await wait(120_000);
    expect(capture).toHaveBeenCalledTimes(1);
    changed();
    await flush();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls).toEqual([[6, JPEG]]);
    expect(listening()).toBe(0);
  });

  it("a library change while playing waits for the pause", async () => {
    const playing = setup({ results: [{ kind: "wait" }] });
    saved(6);
    await wait(4_000);
    expect(playing.capture).toHaveBeenCalledTimes(1);
    store.getState().play();
    playing.changed();
    await flush();
    expect(playing.capture).toHaveBeenCalledTimes(1);
    expect(playing.listening()).toBe(0);
    store.getState().pause();
    await wait(4_000);
    expect(playing.capture).toHaveBeenCalledTimes(2);
    expect(playing.upload.mock.calls).toEqual([[6, JPEG]]);
    playing.stop();

    const revoked = setup({ results: [{ kind: "wait" }] });
    saved(6);
    await wait(4_000);
    store.getState().revokeEditing();
    revoked.changed();
    await flush();
    await wait(60_000);
    expect(revoked.capture).toHaveBeenCalledTimes(1);
    revoked.stop();

    const offline = setup({ results: [{ kind: "wait" }] });
    saved(6);
    await wait(4_000);
    store.getState().setStatus("offline");
    offline.changed();
    await flush();
    await wait(60_000);
    expect(offline.capture).toHaveBeenCalledTimes(1);
    store.getState().setStatus("saved");
    await wait(4_000);
    expect(offline.capture).toHaveBeenCalledTimes(2);
    expect(offline.upload.mock.calls).toEqual([[6, JPEG]]);
  });

  it("store changes during a library wait start no second capture", async () => {
    const { capture, listening } = setup({ results: [{ kind: "wait" }] });
    saved(6);
    await wait(4_000);
    store.getState().setTextEdit("x1");
    store.getState().setTextEdit(null);
    await wait(10_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(listening()).toBe(1);
  });

  it("a newer save ends a wait for the library", async () => {
    const { capture, upload, changed, listening } = setup({ results: [{ kind: "wait" }] });
    saved(6);
    await wait(4_000);
    expect(listening()).toBe(1);
    saved(7);
    expect(listening()).toBe(0);
    changed();
    await flush();
    expect(capture).toHaveBeenCalledTimes(1);
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls).toEqual([[7, JPEG]]);
  });

  it("a skipped capture is not tried again for the same version", async () => {
    const { capture, upload, changed } = setup({ results: [{ kind: "skip" }] });
    saved(6);
    await wait(4_000);
    changed();
    await wait(120_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    saved(7);
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls).toEqual([[7, JPEG]]);
  });

  it("a failed upload changes nothing in the editor", async () => {
    const { upload } = setup();
    upload.mockRejectedValue(new Error("offline"));
    saved(6);
    await wait(4_000);
    await flush();
    expect(upload).toHaveBeenCalledTimes(1);
    const { status, notice, canEdit } = store.getState();
    expect({ status, notice, canEdit }).toEqual({ status: "saved", notice: null, canEdit: true });
  });

  it("a failed upload or capture is not tried again for the same version", async () => {
    const refused = setup();
    refused.upload.mockRejectedValue(new Error("offline"));
    saved(6);
    await wait(4_000);
    await flush();
    await wait(60_000);
    expect(refused.upload).toHaveBeenCalledTimes(1);
    expect(refused.capture).toHaveBeenCalledTimes(1);
    saved(7);
    await wait(4_000);
    expect(refused.upload).toHaveBeenCalledTimes(2);
    refused.stop();

    const broken = setup({ results: [() => Promise.reject(new Error("decode"))] });
    saved(6);
    await wait(4_000);
    await flush();
    await wait(60_000);
    expect(broken.capture).toHaveBeenCalledTimes(1);
    expect(broken.upload).not.toHaveBeenCalled();
    saved(7);
    await wait(4_000);
    expect(broken.upload.mock.calls).toEqual([[7, JPEG]]);
  });

  it("a capture that throws at once never reaches saving", async () => {
    const { upload } = setup({
      results: [
        () => {
          throw new Error("x");
        },
      ],
    });
    let seen = 0;
    store.subscribe(() => void seen++);
    saved(6);
    await wait(4_000); // a throw from the timer would reject here
    await flush();
    expect(upload).not.toHaveBeenCalled();

    const before = seen;
    expect(store.getState().edit([{ op: "remove_clip", clipId: "x2" }], "Delete")).toEqual({ ok: true });
    expect(seen).toBeGreaterThan(before);
    expect(store.getState().queue).toHaveLength(1);

    store.getState().ack("g1", 7, []);
    await wait(4_000);
    expect(upload.mock.calls).toEqual([[7, JPEG]]);
  });

  it("a change brought in by polling is drawn too, and a rename is not", async () => {
    const { upload } = setup();
    store.getState().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x2" }])]);
    await wait(4_000);
    expect(upload.mock.calls).toEqual([[6, JPEG]]);
    store.getState().setName("Finals");
    await wait(60_000);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("a nested store update seen twice still makes one picture", async () => {
    const { capture, upload } = setup({
      before: (s) =>
        void s.subscribe((state, prev) => {
          if (state.queue !== prev.queue) state.setStatus(state.queue.length > 0 ? "saving" : "saved");
        }),
    });
    store.getState().edit([{ op: "remove_clip", clipId: "x2" }], "Delete");
    store.getState().ack("g1", 6, []);
    await wait(4_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls).toEqual([[6, JPEG]]);
  });
});
