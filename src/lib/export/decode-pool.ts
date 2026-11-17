import type { MediaSchedule } from "@/lib/export/media-schedule";
import { ExportError, errorMessage, readFailure } from "@/lib/export/messages";
import type { ResolvedSource } from "@/lib/render/compositor";
import type { PictureSize, SizeRule } from "@/lib/render/decode-image";

export { fileGone } from "./messages";

// The worker's decoders, behind MediaIO: each video file is checked once before the first frame, opened as its first
// clip starts and released after its last use; each clip walks its own moments with its own reader; each image file is
// decoded once and shared. Each picture is decoded at the size its clips are drawn at (sizeOf, needed-size.ts). The
// pool waits only on the IO's promises, never on a timer.

export type VideoFile = {
  firstTimestamp: number; // seconds: the file's first video frame
  width: number; // the pictures' full upright size, with the file's rotation applied
  height: number;
  // A new decoder walking these moments in order, its pictures at this size (no larger than width × height); null: no
  // picture there. A moment past the file's end gives its last frame.
  pictures(seconds: number[], size: PictureSize): AsyncIterator<ResolvedSource | null>;
  dispose(): void;
};

export type DecodedImage = ResolvedSource & { close(): void };

export type MediaIO = {
  canDecode(blob: Blob): Promise<boolean>; // the file has a video track this browser can decode
  openVideo(blob: Blob): Promise<VideoFile>;
  decodeImage(blob: Blob, size: SizeRule): Promise<DecodedImage>; // at the size the rule gives for its full size
};

// The size to decode one clip's picture at, from its source's full upright size.
export type ClipSize = (clipId: string, source: PictureSize) => PictureSize;

export type DecodePool = {
  open(): Promise<void>; // checks every video file once, before the first frame
  frame(frame: number): Promise<ReadonlyMap<string, ResolvedSource>>; // clipId → its picture, for every scheduled clip under the frame
  close(): Promise<void>; // releases everything still open; never rejects; a second call does nothing
};

type Reader = AsyncIterator<ResolvedSource | null>;

// Lets a reader go without waiting: a pending next() may hold its return() back, and a decoder may never answer.
function letGo(reader: Reader): void {
  try {
    void Promise.resolve(reader.return?.()).catch(() => {});
  } catch {
    // released anyway when its file is disposed
  }
}

export function createDecodePool(schedule: MediaSchedule, files: Record<string, Blob>, io: MediaIO, sizeOf: ClipSize): DecodePool {
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
    const opened = await io.openVideo(blob).catch((error: unknown) => {
      throw new ExportError("media", errorMessage(error));
    });
    videos.set(fileId, opened);
    return opened;
  }

  // An image file is decoded once and its picture shared by every clip of it until its last use, so it is decoded at the
  // largest size any of them needs, a clip that starts later included. A video file needs no such rule: the opened file
  // is shared, but each clip has its own reader at its own size.
  const imageSize = (fileId: string): SizeRule => (native) => {
    let size = { width: 1, height: 1 };
    for (const clip of schedule.clips) {
      if (clip.kind !== "image" || clip.fileId !== fileId) continue;
      const need = sizeOf(clip.clipId, native);
      size = { width: Math.max(size.width, need.width), height: Math.max(size.height, need.height) };
    }
    return size;
  };

  async function image(fileId: string): Promise<DecodedImage> {
    const decoded = images.get(fileId);
    if (decoded) return decoded;
    const blob = blobOf(fileId);
    const made = await io.decodeImage(blob, imageSize(fileId)).catch((error: unknown) => {
      throw new ExportError("media", errorMessage(error));
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
          throw readFailure(error, "decode");
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
          const size = sizeOf(clip.clipId, { width: video.width, height: video.height });
          readers.set(clip.clipId, video.pictures(clip.seconds.map((s) => Math.max(video.firstTimestamp, s)), size));
        }
      }

      // Together, so a reader that rejects ends the frame at once even while another never answers. A finished
      // reader keeps answering done.
      const pictures = await Promise.all(
        active.map(async (clip): Promise<ResolvedSource | null> => {
          if (clip.kind === "image") return stills.get(clip.clipId)!;
          const result = await readers.get(clip.clipId)!.next().catch((error: unknown) => {
            throw readFailure(error, "decode");
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
