import type { FullAdjust } from "@/lib/timeline/adjust";
import type { BlendMode } from "@/lib/timeline/types";

// How a picture's colour changes are drawn on a canvas. Pure: it only makes the strings and colours the compositor sets.

const tidy = (n: number) => String(Number(n.toFixed(4)));

// The canvas filter for the changes a filter can make, or null when there are none. scale: how many canvas pixels a
// project pixel is, since a canvas blur is measured in its own pixels whatever the drawing scale.
export function adjustFilter(adjust: FullAdjust, scale: number): string | null {
  const parts: string[] = [];
  if (adjust.brightness !== 0) parts.push(`brightness(${tidy(1 + adjust.brightness)})`);
  if (adjust.contrast !== 0) parts.push(`contrast(${tidy(1 + adjust.contrast)})`);
  if (adjust.saturation !== 0) parts.push(`saturate(${tidy(1 + adjust.saturation)})`);
  if (adjust.hue !== 0) parts.push(`hue-rotate(${tidy(adjust.hue)}deg)`);
  if (adjust.blur > 0) parts.push(`blur(${tidy(adjust.blur * scale)}px)`);
  return parts.length ? parts.join(" ") : null;
}

// The colour a picture is multiplied by to warm or cool it: white takes nothing away, warmer takes out blue and a
// little green, cooler takes out red and a little green.
export function temperatureColor(temperature: number): string {
  const t = Math.min(1, Math.abs(temperature));
  const most = Math.round(255 - 110 * t);
  const some = Math.round(255 - 40 * t);
  return temperature > 0 ? `rgb(255,${some},${most})` : `rgb(${most},${some},255)`;
}

// Whether the changes need the picture drawn on a layer of its own first: a canvas filter cannot warm, cool or
// darken the corners.
export function needsLayer(adjust: FullAdjust): boolean {
  return adjust.temperature !== 0 || adjust.vignette > 0;
}

const COMPOSITE: Partial<Record<BlendMode, GlobalCompositeOperation>> = { add: "lighter" };

// The canvas's name for a blend, or null for "normal", which needs none set.
export function compositeOf(blend: BlendMode | undefined): GlobalCompositeOperation | null {
  if (!blend || blend === "normal") return null;
  return COMPOSITE[blend] ?? (blend as GlobalCompositeOperation);
}
