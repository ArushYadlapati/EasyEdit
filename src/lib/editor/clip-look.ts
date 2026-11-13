// How a clip on the timeline shows what it holds: a video's or image's still, or a text's "Aa" sample.

export const MIN_STILL_PX = 120; // below this the name keeps the room

// sRGB channel (0–255) to linear light.
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// The backdrop a text sample of this color reads best on: the light one under a relative luminance of 0.18, where the
// contrast with either backdrop is about equal. Only #rgb and #rrggbb are read; any other color gets the dark one.
export function sampleBackdrop(color: string): "dark" | "light" {
  const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color.slice(1) : null;
  if (hex === null) return "dark";
  const full = hex.length === 3 ? [...hex].map((d) => d + d).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18 ? "light" : "dark";
}
