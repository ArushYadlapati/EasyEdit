import { MEASURE_MAX_BYTES } from "@/lib/audio/decode";
import { peaksOf, type Peaks } from "@/lib/audio/peaks";
import type { Strip } from "@/lib/media/clip-looks";
import { loadMediabunny } from "./frame-decode";

// Makes a file's timeline looks in the browser: a sheet of small frames from a video, and the shape of a sound.

export const STRIP_TILE_HEIGHT = 64; // twice the clip's height on the timeline, for sharp screens
export const STRIP_SECONDS = 1; // a tile a second, until the sheet is full
export const STRIP_MAX_TILES = 120; // a longer video spaces its tiles further apart
const STRIP_COLUMNS = 20;
const PEAK_RATE = 8000; // the lowest rate a browser decodes at: enough for a sound's outline

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// How many tiles a video this long gets, and the seconds between them.
export function stripPlan(durationSeconds: number): { tiles: number; every: number } {
  const tiles = clamp(Math.ceil(durationSeconds / STRIP_SECONDS), 1, STRIP_MAX_TILES);
  return { tiles, every: tiles > 1 ? durationSeconds / tiles : 0 };
}

// mediabunny loads on the first call, so it stays out of the editor's first bundle.
export async function makeStrip(blob: Blob): Promise<Strip | null> {
  const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await loadMediabunny();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const first = await track.getFirstTimestamp();
    const { tiles, every } = stripPlan(Math.max(0, (await track.computeDuration()) - first));
    const shape = (await track.getDisplayWidth()) / Math.max(1, await track.getDisplayHeight());
    const tileHeight = STRIP_TILE_HEIGHT;
    const tileWidth = Math.round(tileHeight * clamp(shape, 0.4, 2.5));
    const columns = Math.min(tiles, STRIP_COLUMNS);
    const sheet = document.createElement("canvas");
    sheet.width = columns * tileWidth;
    sheet.height = Math.ceil(tiles / columns) * tileHeight;
    const ctx = sheet.getContext("2d");
    if (!ctx) return null;
    const sink = new CanvasSink(track, { width: tileWidth, height: tileHeight, fit: "cover", poolSize: 1 });
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(Array.from({ length: tiles }, (_, n) => first + n * every))) {
      if (frame) ctx.drawImage(frame.canvas, (i % columns) * tileWidth, Math.floor(i / columns) * tileHeight);
      i += 1;
    }
    return { image: sheet, tiles, columns, tileWidth, tileHeight, first, every };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

export function dropStrip(strip: Strip): void {
  if (strip.image instanceof HTMLCanvasElement) strip.image.width = strip.image.height = 0;
}

// The file's sound as peaks, read at a low rate so a long file stays small in memory. A video file gives its sound
// track. Null for a file with no sound, one too large to read whole, or where the browser cannot decode.
export async function makePeaks(blob: Blob): Promise<Peaks | null> {
  const Offline = typeof window === "undefined" ? undefined : window.OfflineAudioContext;
  if (!Offline || blob.size > MEASURE_MAX_BYTES) return null;
  try {
    const buffer = await new Offline(1, 1, PEAK_RATE).decodeAudioData(await blob.arrayBuffer());
    const sides = Array.from({ length: buffer.numberOfChannels }, (_, side) => buffer.getChannelData(side));
    return peaksOf(sides, buffer.sampleRate);
  } catch {
    return null;
  }
}
