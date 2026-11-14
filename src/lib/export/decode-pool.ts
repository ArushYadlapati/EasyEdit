import type { MediaSchedule } from "@/lib/export/media-schedule";
import { ExportError } from "@/lib/export/messages";
import type { ResolvedSource } from "@/lib/render/compositor";

// The worker's decoders, behind MediaIO: each video file is checked once before the first frame, opened as its first
// clip starts and released after its last use; each clip walks its own moments with its own reader; each image file is
// decoded once and shared. The pool waits only on the IO's promises, never on a timer.

export type VideoFile = {
  firstTimestamp: number; // seconds: the file's first video frame
  pictures(seconds: number[]): AsyncIterator<ResolvedSource | null>; // a new decoder walking these moments in order; null: no picture there
  dispose(): void;
};

export type DecodedImage = ResolvedSource & { close(): void };

export type MediaIO = {
  canDecode(blob: Blob): Promise<boolean>; // the file has a video track this browser can decode
  openVideo(blob: Blob, maxSide: number): Promise<VideoFile>; // pictures no larger than maxSide on their long side
  decodeImage(blob: Blob, maxSide: number): Promise<DecodedImage>;
};

export type DecodePool = {
  open(): Promise<void>; // checks every video file once, before the first frame
  frame(frame: number): Promise<ReadonlyMap<string, ResolvedSource>>; // clipId → its picture, for every scheduled clip under the frame
  close(): Promise<void>; // releases everything still open; never rejects; a second call does nothing
};

type Reader = AsyncIterator<ResolvedSource | null>;

// The file went away under the reader (another tab's cache removed it, for example).
const FILE_GONE = new Set(["NotReadableError", "NotFoundError", "InputDisposedError"]);

const field = (error: unknown, key: "name" | "message"): string | null =>
  typeof error === "object" && error !== null && typeof (error as Record<string, unknown>)[key] === "string"
    ? ((error as Record<string, string>)[key])
    : null;
const messageOf = (error: unknown): string => field(error, "message") ?? String(error);

// The error says the file went away under its reader.
export function fileGone(error: unknown): boolean {
  return FILE_GONE.has(field(error, "name") ?? "");
}

// A reader's failure, named by its cause. A decoder the browser took back (as Chrome can in a background tab) is an
// encoder failure, so the export tries once more in a fresh worker.
function readerFailure(error: unknown): ExportError {
  const name = field(error, "name") ?? "";
  if (fileGone(error)) return new ExportError("media", messageOf(error));
  if (name === "QuotaExceededError") return new ExportError("encoder", messageOf(error));
  return new ExportError("decode", messageOf(error));
}

// Lets a reader go without waiting: a pending next() may hold its return() back, and a decoder may never answer.
function letGo(reader: Reader): void {
  try {
    void Promise.resolve(reader.return?.()).catch(() => {});
  } catch {
    // released anyway when its file is disposed
  }
}

export function createDecodePool(schedule: MediaSchedule, files: Record<string, Blob>, io: MediaIO, maxSide: number): DecodePool {
  const videos = new Map<string, VideoFile>(); // fileId → the open file
  const images = new Map<string, DecodedImage>(); // fileId → the decoded picture
  const readers = new Map<string, Reader>(); // clipId → its reader

  const blobOf = (fileId: string): Blob => {
    const blob = files[fileId];
    if (!blob) throw new ExportError("media", fileId);
    return blob;
  };

  async function videoFile(fileId: string): Promise<VideoFile> {
    const open = videos.get(fileId);
    if (open) return open;
    const blob = blobOf(fileId);
    const opened = await io.openVideo(blob, maxSide).catch((error: unknown) => {
      throw new ExportError("media", messageOf(error));
    });
    videos.set(fileId, opened);
    return opened;
  }

  async function image(fileId: string): Promise<DecodedImage> {
    const decoded = images.get(fileId);
    if (decoded) return decoded;
    const blob = blobOf(fileId);
    const made = await io.decodeImage(blob, maxSide).catch((error: unknown) => {
      throw new ExportError("media", messageOf(error));
    });
    images.set(fileId, made);
    return made;
  }

  function release(n: number): void {
    for (const clip of schedule.clips) {
      const reader = readers.get(clip.clipId);
      if (!reader || clip.end > n) continue;
      readers.delete(clip.clipId);
      letGo(reader);
    }
    for (const [fileId, video] of videos) {
      if (!(schedule.lastUse[fileId] < n)) continue;
      videos.delete(fileId);
      video.dispose();
    }
    for (const [fileId, decoded] of images) {
      if (!(schedule.lastUse[fileId] < n)) continue;
      images.delete(fileId);
      decoded.close();
    }
  }

  return {
    async open() {
      const checked = new Set<string>();
      for (const clip of schedule.clips) {
        if (clip.kind !== "video" || checked.has(clip.fileId)) continue;
        checked.add(clip.fileId);
        const blob = blobOf(clip.fileId);
        const decodable = await io.canDecode(blob).catch((error: unknown) => {
          throw readerFailure(error);
        });
        if (!decodable) throw new ExportError("decode", clip.fileId);
      }
    },

    async frame(n) {
      release(n);

      const active = schedule.clips.filter((clip) => clip.start <= n && n < clip.end);
      const stills = new Map<string, DecodedImage>(); // clipId → its file's picture
      for (const clip of active) {
        if (clip.kind === "image") {
          stills.set(clip.clipId, await image(clip.fileId));
        } else if (!readers.has(clip.clipId)) {
          const video = await videoFile(clip.fileId);
          readers.set(clip.clipId, video.pictures(clip.seconds.map((s) => Math.max(video.firstTimestamp, s))));
        }
      }

      // Together, so a reader that rejects ends the frame at once even while another never answers. A finished
      // reader keeps answering done.
      const pictures = await Promise.all(
        active.map(async (clip): Promise<ResolvedSource | null> => {
          if (clip.kind === "image") return stills.get(clip.clipId)!;
          const result = await readers.get(clip.clipId)!.next().catch((error: unknown) => {
            throw readerFailure(error);
          });
          return result.done ? null : result.value;
        }),
      );

      const sources = new Map<string, ResolvedSource>();
      active.forEach((clip, i) => {
        const picture = pictures[i];
        if (picture) sources.set(clip.clipId, picture);
      });
      return sources;
    },

    // Disposing a file cancels its pending reads and closes its decoders, so the readers are let go only after. What is
    // released leaves the pool, so a second call finds nothing.
    async close() {
      for (const video of videos.values()) {
        try {
          video.dispose();
        } catch {
          // already gone
        }
      }
      for (const decoded of images.values()) {
        try {
          decoded.close();
        } catch {
          // already gone
        }
      }
      for (const reader of readers.values()) letGo(reader);
      videos.clear();
      images.clear();
      readers.clear();
    },
  };
}
