import type { Units } from "@/lib/editor/settings";
import { showUnit, toEvenPixels } from "@/lib/editor/units";
import type { FrameSize } from "@/lib/timeline";

// The New project dialog's width and height, as typed, in the dialog's unit.
export type SizeDraft = { units: Units; width: string; height: string };

const NUMBER = /^\s*(\d+(\.\d*)?|\.\d+)\s*$/;

const sidePixels = (text: string, units: Units): number | null => (NUMBER.test(text) ? toEvenPixels(Number(text), units) : null);

// The typed size as even pixels, or null while either side is not a number. Limits are the caller's.
export function draftPixels(draft: SizeDraft): FrameSize | null {
  const width = sidePixels(draft.width, draft.units);
  const height = sidePixels(draft.height, draft.units);
  return width === null || height === null ? null : { width, height };
}

export function draftFor(size: FrameSize, units: Units): SizeDraft {
  return { units, width: showUnit(size.width, units), height: showUnit(size.height, units) };
}

// The same size in another unit; a side that is not a number keeps its text.
export function convertDraft(draft: SizeDraft, units: Units): SizeDraft {
  const convert = (text: string) => {
    const px = sidePixels(text, draft.units);
    return px === null ? text : showUnit(px, units);
  };
  return { units, width: convert(draft.width), height: convert(draft.height) };
}

export function swapDraft(draft: SizeDraft): SizeDraft {
  return { units: draft.units, width: draft.height, height: draft.width };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const RATIO_TERM_MAX = 32;

// "9:16", or null when the reduced ratio has a term past 32 and would read as noise.
export function ratioOf(size: FrameSize): string | null {
  const divisor = gcd(size.width, size.height);
  const [w, h] = [size.width / divisor, size.height / divisor];
  return w <= RATIO_TERM_MAX && h <= RATIO_TERM_MAX ? `${w}:${h}` : null;
}

// "1080 × 1920 px · 9:16", or "4 × 6 in · 384 × 576 px · 2:3".
export function sizeCaption(size: FrameSize, units: Units): string {
  const pixels = `${size.width} × ${size.height} px`;
  const parts = units === "px" ? [pixels] : [`${showUnit(size.width, units)} × ${showUnit(size.height, units)} ${units}`, pixels];
  const ratio = ratioOf(size);
  if (ratio) parts.push(ratio);
  return parts.join(" · ");
}

export function pixelLine(size: FrameSize): string {
  return `${size.width} × ${size.height} pixels`;
}
