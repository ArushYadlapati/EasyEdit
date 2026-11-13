import type { FromWorker } from "@/lib/export/protocol";

// Worker side: each write the muxer makes becomes one chunk message to the page, and the write finishes only when the
// page answers that it wrote those bytes. A WritableStream calls write one at a time, so at most one chunk is in flight.

export const CHUNK_BYTES = 4 * 1024 * 1024;

export type MuxerChunk = { type: "write"; data: Uint8Array<ArrayBuffer>; position: number }; // what Mediabunny's StreamTarget writes

export type ChunkBridge = {
  sink: UnderlyingSink<MuxerChunk>; // give it to new WritableStream(...)
  ack(seq: number): void; // the page wrote chunk seq
  bytes(): number; // the file's size so far: the furthest byte any chunk reached
};

type ChunkMessage = Extract<FromWorker, { type: "chunk" }>;

export function createChunkBridge(post: (message: ChunkMessage, transfer: Transferable[]) => void): ChunkBridge {
  let nextSeq = 0;
  let furthest = 0;
  const waiting = new Map<number, () => void>();

  return {
    sink: {
      write(chunk) {
        const seq = nextSeq++;
        // A copy, so the muxer may reuse its own buffer once the write returns; the copy's buffer moves to the page.
        const data = chunk.data.slice();
        furthest = Math.max(furthest, chunk.position + data.byteLength);
        return new Promise<void>((resolve) => {
          waiting.set(seq, resolve);
          post({ type: "chunk", seq, position: chunk.position, data }, [data.buffer]);
        });
      },
    },
    ack(seq) {
      const resolve = waiting.get(seq);
      if (!resolve) return;
      waiting.delete(seq);
      resolve();
    },
    bytes: () => furthest,
  };
}
