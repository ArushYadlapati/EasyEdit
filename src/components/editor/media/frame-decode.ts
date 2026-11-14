import type { ResolvedSource } from "@/lib/render/compositor";

export { decodeImage } from "@/lib/render/decode-image";

// The frame shown at `seconds` of a video, made smaller when its longer side is over maxSide, with the file's rotation
// kept. A time before the file's first frame shows that first frame, as the export worker floors every moment, so a
// file whose video starts a little after 0 draws its opening frames. Null when the file has no video track. mediabunny
// loads on the first call, so it stays out of the editor's first bundle.
export async function decodeVideoFrame(blob: Blob, seconds: number, maxSide: number): Promise<ResolvedSource | null> {
  const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const shownWidth = await track.getDisplayWidth();
    const shownHeight = await track.getDisplayHeight();
    const scale = maxSide / Math.max(shownWidth, shownHeight);
    const size =
      scale < 1
        ? { width: Math.max(1, Math.round(shownWidth * scale)), height: Math.max(1, Math.round(shownHeight * scale)), fit: "fill" as const }
        : {};
    const frame = await new CanvasSink(track, size).getCanvas(Math.max(seconds, await track.getFirstTimestamp()));
    if (!frame) return null;
    return { image: frame.canvas, width: frame.canvas.width, height: frame.canvas.height };
  } finally {
    input.dispose();
  }
}
