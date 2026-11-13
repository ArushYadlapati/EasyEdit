import { ExportError } from "@/lib/export/messages";

// Where an export's bytes go on the page. A try writes through a ByteSink; the export as a whole owns an ExportTarget.
// Dropping a try's bytes (abort) and removing the file (discard) are two different things: a second try opens the
// same file again, so only the export's final end may remove it.

export type ByteSink = {
  write(position: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>; // keep what was written
  abort(): Promise<void>; // drop what this try wrote; never throws. The file itself stays, for a next try
};

// A destination. open() is called once per try and starts from nothing each time.
export type ExportTarget = {
  limit: number | null; // the most bytes it can hold; null: no limit (a file on disk)
  open(): Promise<ByteSink>;
  discard(): Promise<void>; // once the export has ended without a file: removes what the save dialog made; never throws
};

// The parts of FileSystemFileHandle and its writable stream that are used, so tests can pass plain objects.
export type WritableFileLike = {
  write(chunk: { type: "write"; position: number; data: Uint8Array<ArrayBuffer> }): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};
export type FileHandleLike = {
  name: string;
  createWritable(): Promise<WritableFileLike>;
  getFile(): Promise<{ size: number }>;
  remove?(): Promise<void>;
};

export const MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;

// A file the person chose. Each try writes a new, empty temporary copy that the browser puts in place of the file
// only on close, so an aborted try leaves the file as it was.
export function fileTarget(handle: FileHandleLike): ExportTarget {
  return {
    limit: null,
    async open() {
      const writable = await handle.createWritable();
      return {
        write: (position, data) => writable.write({ type: "write", position, data }),
        close: () => writable.close(),
        async abort() {
          try {
            await writable.abort();
          } catch {
            // The temporary copy is gone or stuck either way; the file is not touched.
          }
        },
      };
    },
    async discard() {
      try {
        // An empty file is the one the save dialog made; an older file the person chose to replace has bytes.
        if (handle.remove && (await handle.getFile()).size === 0) await handle.remove();
      } catch {
        // Nothing more can be done about the file.
      }
    },
  };
}

// The bytes held in memory, for a browser without a save dialog. The muxer writes in order and goes back once, at the
// end, to patch the start of the file, so a write may overwrite bytes already held but never leave a gap.
export function memoryTarget(onSaved: (blob: Blob) => void, limit: number = MEMORY_LIMIT_BYTES): ExportTarget {
  return {
    limit,
    async open() {
      let parts: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      return {
        async write(position, data) {
          const end = position + data.length;
          if (end > limit) throw new ExportError("too-long", "");
          if (position > size) throw new Error(`A write at byte ${position} would leave a gap after byte ${size}.`);
          if (position < size) {
            // Overwrite what is held, across part boundaries.
            let start = 0;
            for (const part of parts) {
              const from = Math.max(position, start);
              const to = Math.min(end, start + part.length);
              if (from < to) part.set(data.subarray(from - position, to - position), from - start);
              start += part.length;
              if (start >= end) break;
            }
          }
          if (end > size) {
            parts.push(position === size ? data : data.slice(size - position));
            size = end;
          }
        },
        async close() {
          onSaved(new Blob(parts, { type: "video/mp4" }));
          parts = [];
          size = 0;
        },
        async abort() {
          parts = [];
          size = 0;
        },
      };
    },
    async discard() {},
  };
}
