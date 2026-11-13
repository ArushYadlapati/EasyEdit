import type { Units } from "./settings";

// Lengths in the unit chosen in Settings. A project pixel is a CSS pixel: 96 to the inch.
export const PX_PER_INCH = 96;
export const PX_PER_CM = 96 / 2.54;

export const UNIT_SUFFIX: Record<Units, string> = { px: "px", cm: "cm", in: "in" };
export const UNIT_DECIMALS: Record<Units, number> = { px: 0, cm: 2, in: 2 };

const PX_PER_UNIT: Record<Units, number> = { px: 1, cm: PX_PER_CM, in: PX_PER_INCH };

export function toUnit(px: number, units: Units): number {
  return px / PX_PER_UNIT[units];
}

export function fromUnit(value: number, units: Units): number {
  return value * PX_PER_UNIT[units];
}

// The length as shown: rounded to the unit's decimals, with no trailing zeros.
export function showUnit(px: number, units: Units): string {
  return String(Number(toUnit(px, units).toFixed(UNIT_DECIMALS[units])));
}

// A typed length as a frame side: the nearest even number of pixels.
export function toEvenPixels(value: number, units: Units): number {
  return Math.round(fromUnit(value, units) / 2) * 2;
}
