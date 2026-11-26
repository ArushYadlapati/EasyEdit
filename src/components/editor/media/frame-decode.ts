import type { ResolvedSource } from "@/lib/render/compositor";
import { noLargerThan, type SizeRule } from "@/lib/render/decode-image";

export { decodeImage } from "@/lib/render/decode-image";

// The frame shown at `seconds` of a video, at the size its rule gives (a number: no longer than that), with the file's rotation
// kept. A time before the file's first frame shows that first frame, as the export worker floors every moment, so a
// file whose video starts a little after 0 draws its opening frames. Null when the file has no video track. mediabunny
// loads on the first call, so it stays out of the editor's first bundle.
// The one place the page loads mediabunny from. The export worker imports it outright, and a second import() beside
// that one breaks the chunk they share, so everything on the page that reads a video goes through here.
export const loadMediabunny = () => import("mediabunny");

export async function decodeVideoFrame(blob: Blob, seconds: number, size: number | SizeRule): Promise<ResolvedSource | null> {
  const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await loadMediabunny();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const shownWidth = await track.getDisplayWidth();
    const shownHeight = await track.getDisplayHeight();
    const rule = typeof size === "number" ? noLargerThan(size) : size;
    const wanted = rule({ width: shownWidth, height: shownHeight });
    const sized = wanted.width < shownWidth || wanted.height < shownHeight ? { width: wanted.width, height: wanted.height, fit: "fill" as const } : {};
    const frame = await new CanvasSink(track, sized).getCanvas(Math.max(seconds, await track.getFirstTimestamp()));
    if (!frame) return null;
    return { image: frame.canvas, width: frame.canvas.width, height: frame.canvas.height };
  } finally {
    input.dispose();
  }
}

// Every frame of a video between two moments of its file, in order, small: its pixels at about `side` pixels on the
// longer side, with the moment it is shown at. For looking a video over (finding its cuts), not for showing it. each
// may return false to stop early. False when the file has no video track.
export async function scanFrames(
  blob: Blob,
  from: number,
  to: number,
  side: number,
  each: (seconds: number, rgba: Uint8ClampedArray, width: number, height: number) => boolean | void,
): Promise<boolean> {
  const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await loadMediabunny();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return false;
    const shownWidth = await track.getDisplayWidth();
    const shownHeight = await track.getDisplayHeight();
    const k = Math.min(1, side / Math.max(shownWidth, shownHeight));
    const width = Math.max(2, Math.round(shownWidth * k));
    const height = Math.max(2, Math.round(shownHeight * k));
    const sink = new CanvasSink(track, { width, height, fit: "fill", poolSize: 2 });
    for await (const frame of sink.canvases(Math.max(from, await track.getFirstTimestamp()), to)) {
      const ctx = (frame.canvas as OffscreenCanvas).getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
      if (!ctx) return false;
      if (each(frame.timestamp, ctx.getImageData(0, 0, width, height).data, width, height) === false) break;
    }
    return true;
  } finally {
    input.dispose();
  }
}
