import { createChunkBridge, type ChunkBridge } from "@/lib/export/chunk-bridge";
import { failureOf } from "@/lib/export/messages";
import type { PipelineControl, PipelineResult } from "@/lib/export/pipeline";
import type { ExportJob, FromWorker, ToWorker } from "@/lib/export/protocol";

// Worker side: the worker's messages in and out, so they can be tested without a worker. One start per worker, acks to
// the chunk bridge, and a crash as an unknown failure. Once a result or a failure is out, nothing more is posted.

export type WorkerRun = (job: ExportJob, bridge: ChunkBridge, control: PipelineControl) => Promise<PipelineResult>;
export type WorkerSession = { receive(message: ToWorker): void; crash(detail: string): void };

export function createWorkerSession(
  run: WorkerRun,
  post: (message: FromWorker, transfer: Transferable[]) => void,
  now: () => number,
): WorkerSession {
  let bridge: ChunkBridge | null = null;
  let ended = false;

  const send = (message: FromWorker, transfer: Transferable[]) => {
    if (ended) return;
    if (message.type === "done" || message.type === "failed") ended = true;
    post(message, transfer);
  };

  return {
    receive(message) {
      if (message.type === "ack") {
        bridge?.ack(message.seq);
        return;
      }
      if (bridge) return; // one export per worker
      const started = createChunkBridge(send);
      bridge = started;
      const control: PipelineControl = {
        onProgress: (framesDone, totalFrames) => send({ type: "progress", framesDone, totalFrames }, []),
        now,
      };
      run(message.job, started, control).then(
        (outcome) => send(outcome, []),
        (reason: unknown) => send({ type: "failed", code: "unknown", detail: failureOf(reason, "unknown").detail }, []),
      );
    },
    crash(detail) {
      send({ type: "failed", code: "unknown", detail }, []);
    },
  };
}
