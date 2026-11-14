import { expect, it } from "vitest";
import { ExportError } from "@/lib/export/messages";
import type { FromWorker, ToWorker } from "@/lib/export/protocol";
import { createWorkerSession, type WorkerRun } from "@/lib/export/worker-session";
import { tick } from "./fakes";

const START = { type: "start", job: {} } as unknown as ToWorker;
function setup(run: WorkerRun) {
  const posted: FromWorker[] = [];
  const session = createWorkerSession(run, (message) => posted.push(message), () => 7);
  return { session, posted };
}

it("runs the first start once, passes progress and the clock on, and posts the result", async () => {
  const clocks: number[] = [];
  const { session, posted } = setup(async (_job, _bridge, control) => {
    clocks.push(control.now());
    control.onProgress(1, 2);
    return { type: "done", bytes: 3, hasAudio: true };
  });
  session.receive(START);
  session.receive(START); // a second start is ignored
  await tick();
  expect(clocks).toEqual([7]);
  expect(posted).toEqual([{ type: "progress", framesDone: 1, totalFrames: 2 }, { type: "done", bytes: 3, hasAudio: true }]);
});

it("hands each ack to the chunk bridge, and ignores one before the start", async () => {
  const { session, posted } = setup(async (_job, bridge) => {
    const writer = new WritableStream(bridge.sink).getWriter();
    await writer.write({ type: "write", data: new Uint8Array([1]), position: 0 });
    return { type: "done", bytes: bridge.bytes(), hasAudio: false };
  });
  session.receive({ type: "ack", seq: 0 }); // nothing has been sent yet
  session.receive(START);
  await tick();
  expect(posted.map((m) => m.type)).toEqual(["chunk"]);
  session.receive({ type: "ack", seq: 0 });
  await tick();
  expect(posted.at(-1)).toEqual({ type: "done", bytes: 1, hasAudio: false });
});

it("a crash ends the session with one failure, and nothing is posted after it", async () => {
  let finish: (result: { type: "done"; bytes: number; hasAudio: boolean }) => void = () => {};
  const { session, posted } = setup(() => new Promise((resolve) => { finish = resolve; }));
  session.receive(START);
  session.crash("A message could not be read.");
  session.crash("again");
  finish({ type: "done", bytes: 1, hasAudio: true });
  await tick();
  expect(posted).toEqual([{ type: "failed", code: "unknown", detail: "A message could not be read." }]);
});

it("a run that rejects is posted as an unknown failure", async () => {
  const { session, posted } = setup(async () => { throw new Error("boom"); });
  session.receive(START);
  await tick();
  expect(posted).toEqual([{ type: "failed", code: "unknown", detail: "boom" }]);
});

it("a run that rejects with a named failure is still posted as an unknown failure, with its message", async () => {
  const { session, posted } = setup(async () => { throw new ExportError("media", "f1"); });
  session.receive(START);
  await tick();
  expect(posted).toEqual([{ type: "failed", code: "unknown", detail: "f1" }]);
});

it("once the result is out, a late progress, a late chunk and a crash are not posted", async () => {
  let late = () => {};
  const { session, posted } = setup(async (_job, bridge, control) => {
    late = () => {
      control.onProgress(2, 2);
      void new WritableStream(bridge.sink).getWriter().write({ type: "write", data: new Uint8Array([1]), position: 0 });
    };
    return { type: "done", bytes: 0, hasAudio: false };
  });
  session.receive(START);
  await tick();
  late();
  session.crash("late");
  await tick();
  expect(posted).toEqual([{ type: "done", bytes: 0, hasAudio: false }]);
});
