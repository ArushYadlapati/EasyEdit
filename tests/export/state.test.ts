import { expect, it } from "vitest";
import { exportReducer, isBusy, progressFraction, type ExportEvent, type ExportState } from "@/lib/export/state";

const IDLE: ExportState = { phase: "idle" };
const run = (events: ExportEvent[], from: ExportState = IDLE) => events.reduce(exportReducer, from);
const progress = (attempt: number, framesDone: number, at: number): ExportEvent => ({ type: "progress", attempt, framesDone, totalFrames: 120, at });
const done: ExportEvent = { type: "finish", outcome: { status: "done", bytes: 9, hasAudio: true, acceleration: "no-preference" }, changed: true, held: false };

it("goes from the choices through preparing and running to done", () => {
  const preparing = run([{ type: "start", fileName: "a.mp4" }]);
  expect(preparing).toEqual({ phase: "preparing", fileName: "a.mp4" });
  expect([isBusy(IDLE), isBusy(preparing), progressFraction(preparing)]).toEqual([false, true, 0]);
  const running = exportReducer(preparing, progress(1, 30, 5_000));
  expect(running).toEqual({ phase: "running", fileName: "a.mp4", attempt: 1, framesDone: 30, totalFrames: 120, startedAt: 5_000 });
  expect([isBusy(running), progressFraction(running)]).toEqual([true, 0.25]);
  const finished = exportReducer(running, done);
  expect(finished).toEqual({ phase: "done", fileName: "a.mp4", bytes: 9, hasAudio: true, changed: true, held: false });
  expect(isBusy(finished)).toBe(false);
  expect(exportReducer(finished, { type: "reset" })).toEqual(IDLE);
  const heldDone: ExportEvent = { type: "finish", outcome: { status: "done", bytes: 9, hasAudio: true, acceleration: "no-preference" }, changed: false, held: true };
  expect(exportReducer(running, heldDone)).toMatchObject({ phase: "done", held: true }); // the file waits for Download
});

it("never counts backward inside a try, and starts the count again on a second try", () => {
  const running = run([{ type: "start", fileName: "a.mp4" }, progress(1, 60, 1_000), progress(1, 40, 2_000)]);
  expect(running).toMatchObject({ attempt: 1, framesDone: 60, startedAt: 1_000 });
  expect(exportReducer(running, progress(2, 5, 9_000))).toMatchObject({ attempt: 2, framesDone: 5, startedAt: 9_000 });
});

it("ends canceled or failed, and a new export can start from either", () => {
  const busy = run([{ type: "start", fileName: "a.mp4" }]);
  const canceled = exportReducer(busy, { type: "finish", outcome: { status: "canceled" }, changed: false, held: false });
  expect(canceled).toEqual({ phase: "canceled" });
  const failed = exportReducer(busy, { type: "finish", outcome: { status: "failed", code: "font", detail: "Geist" }, changed: false, held: false });
  expect(failed).toEqual({ phase: "failed", code: "font" });
  expect(exportReducer(canceled, { type: "start", fileName: "b.mp4" })).toEqual({ phase: "preparing", fileName: "b.mp4" });
  expect(exportReducer(failed, { type: "reset" })).toEqual(IDLE);
});

it("ignores what arrives late or out of place", () => {
  expect(exportReducer(IDLE, progress(1, 10, 0))).toBe(IDLE);
  expect(exportReducer(IDLE, done)).toBe(IDLE);
  expect(exportReducer(IDLE, { type: "reset" })).toBe(IDLE);
  const busy = run([{ type: "start", fileName: "a.mp4" }, progress(1, 10, 0)]);
  expect(exportReducer(busy, { type: "start", fileName: "b.mp4" })).toBe(busy);
  expect(exportReducer(busy, { type: "reset" })).toBe(busy);
  const finished = exportReducer(busy, done);
  expect(exportReducer(finished, progress(1, 99, 5))).toBe(finished);
  expect(exportReducer(finished, done)).toBe(finished);
});

it("reads the media between preparing and running", () => {
  const reading = run([{ type: "start", fileName: "a.mp4" }, { type: "reading", filesRead: 1, totalFiles: 3 }]);
  expect(reading).toEqual({ phase: "reading", fileName: "a.mp4", filesRead: 1, totalFiles: 3 });
  expect([isBusy(reading), progressFraction(reading)]).toEqual([true, 0]);
  expect(exportReducer(reading, { type: "reading", filesRead: 3, totalFiles: 3 })).toMatchObject({ phase: "reading", filesRead: 3 });
  expect(exportReducer(reading, progress(1, 5, 2_000))).toEqual({ phase: "running", fileName: "a.mp4", attempt: 1, framesDone: 5, totalFrames: 120, startedAt: 2_000 });
  expect(exportReducer(reading, { type: "finish", outcome: { status: "canceled" }, changed: false, held: false })).toEqual({ phase: "canceled" });
  expect(exportReducer(reading, { type: "start", fileName: "b.mp4" })).toBe(reading);
  const running = exportReducer(reading, progress(1, 5, 2_000));
  expect(exportReducer(running, { type: "reading", filesRead: 1, totalFiles: 3 })).toBe(running);
  expect(exportReducer(IDLE, { type: "reading", filesRead: 1, totalFiles: 3 })).toBe(IDLE);
});

it("ignores progress from an earlier try once a second try is counting", () => {
  const second = run([{ type: "start", fileName: "a.mp4" }, progress(1, 60, 1_000), progress(2, 5, 9_000)]);
  expect(exportReducer(second, progress(1, 61, 9_500))).toBe(second);
  expect(exportReducer(second, progress(2, 9, 9_500))).toMatchObject({ attempt: 2, framesDone: 9, startedAt: 9_000 });
});
