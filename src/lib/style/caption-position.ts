import type { FormatId } from "@/lib/timeline";
import type { CaptionPosition } from "./types";

// Where a style's caption positions put the captions, and which position a project's captions are at. Fill in from my
// videos reads a project's captions with this table, and the skills give agents the same numbers to put captions at,
// so a style saved from a project reads back to the same spot.

// The spots on 9:16, whose default safe area runs from 0.14 to 0.65 (the apps' buttons and descriptions cover the
// bottom 35%), and on every other format, whose default safe area runs from 0.05 to 0.95.
const TALL = { upper: 0.25, middle: 0.45, lower: 0.558 } as const;
const OTHER = { upper: 0.2, middle: 0.5, lower: 0.788 } as const;

// The caption y (the middle of the caption lines, as a share of the frame's height) each position stands for, by
// format. Lower is where the editor puts captions before anyone moves them (defaultCaptionStyle, 82% of the way down
// the default safe area), and all three sit inside that safe area.
export const CAPTION_POSITION_Y: Readonly<Record<FormatId, Readonly<Record<CaptionPosition, number>>>> = {
  short_9x16: TALL,
  feed_4x5: OTHER,
  square_1x1: OTHER,
  long_16x9: OTHER,
  long_4k: OTHER,
  custom: OTHER,
};

// The position captions at this y are at, in a project of this format: the nearest of the format's three, with a y
// halfway between two taken as the lower one. On 9:16 that is upper under 0.35, middle under 0.504, lower from there;
// on the other formats upper under 0.35, middle under 0.644, lower from there.
export function positionOfCaption(format: FormatId, y: number): CaptionPosition {
  const spots = CAPTION_POSITION_Y[format] ?? OTHER;
  if (y < (spots.upper + spots.middle) / 2) return "upper";
  if (y < (spots.middle + spots.lower) / 2) return "middle";
  return "lower";
}
