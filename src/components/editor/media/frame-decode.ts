import type { ResolvedSource } from "@/lib/render/compositor";

// Decodes an image, made smaller when its longer side is over maxSide.
export async function decodeImage(blob: Blob, maxSide: number): Promise<{ image: ImageBitmap; width: number; height: number }> {
  const full = await createImageBitmap(blob);
  const scale = maxSide / Math.max(full.width, full.height);
  if (scale >= 1) return { image: full, width: full.width, height: full.height };
  const width = Math.max(1, Math.round(full.width * scale));
  const height = Math.max(1, Math.round(full.height * scale));
  try {
    return { image: await createImageBitmap(full, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" }), width, height };
  } finally {
    full.close();
  }
}

// The frame shown at `seconds` of a video, made smaller when its longer side is over maxSide, with the file's rotation
// kept. Null when the file has no video track, or the time is before its first frame. mediabunny loads on the first
// call, so it stays out of the editor's first bundle.
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
    const frame = await new CanvasSink(track, size).getCanvas(seconds);
    if (!frame) return null;
    return { image: frame.canvas, width: frame.canvas.width, height: frame.canvas.height };
  } finally {
    input.dispose();
  }
}
