import type { Peaks } from "@/lib/audio/peaks";
import { sourceSeconds } from "@/lib/render/source-time";
import type { MediaClip } from "@/lib/timeline";
import type { MediaFiles } from "./media-files";

// What the timeline draws inside a clip, made from its file in this browser and shared by every clip of that file: a
// video's frames in a row (its strip) and a sound's shape (its peaks). Each is made once, one file at a time, only
// while some clip shows it.

// A sheet of small frames taken at even steps through a video: tile i is the frame at first + i × every seconds, in
// reading order, `columns` to a row.
export type Strip = { image: CanvasImageSource; tiles: number; columns: number; tileWidth: number; tileHeight: number; first: number; every: number };

export type LookKind = "strip" | "peaks";

export type ClipLooks = {
  strip(fileId: string): Strip | null; // once it is made, while a clip holds it
  peaks(fileId: string): Peaks | null; // once they are made; kept after, since they are small
  hold(fileId: string, kind: LookKind): () => void; // makes it once and keeps it while held
  subscribe(listener: () => void): () => void; // a look came or went
};

export type LookMakers = {
  files: MediaFiles;
  makeStrip(blob: Blob): Promise<Strip | null>; // null: the file has no picture this browser can read
  makePeaks(blob: Blob): Promise<Peaks | null>; // null: no sound, or too large to read
  dropStrip?(strip: Strip): void; // frees a strip nobody shows any more
};

type Entry<T> = { holds: number; value: T | null; state: "waiting" | "making" | "done" | "failed" };

export function createClipLooks(deps: LookMakers): ClipLooks {
  const strips = new Map<string, Entry<Strip>>();
  const peaks = new Map<string, Entry<Peaks>>();
  const listeners = new Set<() => void>();
  const queue: { fileId: string; kind: LookKind }[] = [];
  let busy = false;
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const table = (kind: LookKind): Map<string, Entry<Strip>> | Map<string, Entry<Peaks>> => (kind === "strip" ? strips : peaks);

  // One file at a time, in the order asked: decoding several videos at once would starve the preview.
  async function next(): Promise<void> {
    if (busy) return;
    const job = queue.shift();
    if (!job) return;
    const entry = table(job.kind).get(job.fileId);
    // Let go of before its turn came: nothing to make.
    if (!entry || entry.state !== "waiting" || entry.holds === 0) return next();
    busy = true;
    entry.state = "making";
    let made: Strip | Peaks | null = null;
    try {
      const got = await deps.files.get(job.fileId);
      if (got.ok) made = job.kind === "strip" ? await deps.makeStrip(got.blob) : await deps.makePeaks(got.blob);
    } catch {
      made = null;
    }
    busy = false;
    if (table(job.kind).get(job.fileId) !== entry) {
      // Let go of while it was made: a strip is freed, and peaks have nowhere to be kept.
      if (made && job.kind === "strip") deps.dropStrip?.(made as Strip);
    } else {
      entry.value = made as never;
      entry.state = made ? "done" : "failed";
      if (made) changed();
    }
    void next();
  }

  return {
    strip: (fileId) => strips.get(fileId)?.value ?? null,
    peaks: (fileId) => peaks.get(fileId)?.value ?? null,
    hold(fileId, kind) {
      const entries = table(kind) as Map<string, Entry<Strip | Peaks>>;
      let entry = entries.get(fileId);
      if (!entry) {
        entry = { holds: 0, value: null, state: "waiting" };
        entries.set(fileId, entry);
        queue.push({ fileId, kind });
      }
      entry.holds += 1;
      void next();
      const mine = entry;
      let released = false; // letting go twice counts once
      return () => {
        if (released) return;
        released = true;
        mine.holds -= 1;
        if (mine.holds > 0 || entries.get(fileId) !== mine) return;
        // Peaks that are made stay: they are a few kilobytes and a file's sound never changes.
        if (kind === "peaks" && mine.state === "done") return;
        entries.delete(fileId);
        if (kind === "strip" && mine.value) {
          deps.dropStrip?.(mine.value as Strip);
          changed();
        }
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Where each tile of a strip goes in a clip drawn `width` by `height`: tiles keep their shape and sit side by side
// from the clip's left edge, each showing the frame its left edge plays. perPx: timeline frames per pixel.
export function stripTiles(clip: MediaClip, fps: number, perPx: number, width: number, height: number, strip: Strip): { x: number; width: number; tile: number }[] {
  const tileWidth = Math.max(1, (height * strip.tileWidth) / strip.tileHeight);
  const placed: { x: number; width: number; tile: number }[] = [];
  for (let x = 0; x < width; x += tileWidth) {
    const seconds = sourceSeconds(clip, clip.start + x * perPx, fps);
    const nearest = strip.every > 0 ? Math.round((seconds - strip.first) / strip.every) : 0;
    placed.push({ x, width: tileWidth, tile: Math.min(strip.tiles - 1, Math.max(0, nearest)) });
  }
  return placed;
}

// The moments of its file a clip starts and ends on, for reading its peaks: start after end when it plays backward.
export function clipSpanSeconds(clip: MediaClip, fps: number): { from: number; to: number } {
  return { from: sourceSeconds(clip, clip.start, fps), to: sourceSeconds(clip, clip.start + clip.duration, fps) };
}
