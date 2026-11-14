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
