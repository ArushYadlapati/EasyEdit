export type PictureSize = { width: number; height: number };

// The size to decode a picture at, given its full upright size. It is never larger than that size.
export type SizeRule = (native: PictureSize) => PictureSize;

// Made smaller, keeping its shape, when its longer side is over maxSide; otherwise left as it is.
export function noLargerThan(maxSide: number): SizeRule {
  return (native) => {
    const scale = maxSide / Math.max(native.width, native.height);
    if (scale >= 1) return { width: native.width, height: native.height };
    return { width: Math.max(1, Math.round(native.width * scale)), height: Math.max(1, Math.round(native.height * scale)) };
  };
}

// Decodes an image at the size its rule asks for: made smaller when the rule asks for less than the whole picture.
// A number is the long-side rule, noLargerThan(size).
export async function decodeImage(blob: Blob, size: number | SizeRule): Promise<{ image: ImageBitmap; width: number; height: number }> {
  const full = await createImageBitmap(blob);
  const rule = typeof size === "number" ? noLargerThan(size) : size;
  const { width, height } = rule({ width: full.width, height: full.height });
  if (width >= full.width && height >= full.height) return { image: full, width: full.width, height: full.height };
  try {
    return { image: await createImageBitmap(full, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" }), width, height };
  } finally {
    full.close();
  }
}
