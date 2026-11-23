import { BlendMode, type Adjust } from "./types";

// A picture's colour and focus changes. Every one is 0 when the picture is as recorded: brightness, contrast,
// saturation and temperature run from −1 to 1 (temperature: cooler to warmer), hue is degrees round the colour wheel,
// blur is project pixels and vignette how dark the corners get, 0 to 1.
export const ADJUST_KEYS = ["brightness", "contrast", "saturation", "temperature", "hue", "blur", "vignette"] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];
export type FullAdjust = Record<AdjustKey, number>;

export const NO_ADJUST: Readonly<FullAdjust> = Object.freeze({ brightness: 0, contrast: 0, saturation: 0, temperature: 0, hue: 0, blur: 0, vignette: 0 });

// Every key given its value.
export function adjustOf(adjust: Adjust | undefined): FullAdjust {
  return { ...NO_ADJUST, ...adjust };
}

export function isAdjusted(adjust: Adjust | undefined): boolean {
  return adjust !== undefined && ADJUST_KEYS.some((key) => (adjust[key] ?? 0) !== 0);
}

// The colour keys a look sets. Blur is a focus change, so a look leaves it alone.
export const LOOK_KEYS = ["brightness", "contrast", "saturation", "temperature", "hue", "vignette"] as const;

export type Look = { id: string; label: string; adjust: Partial<FullAdjust> };

// Ready-made colour looks, each a set of the same numbers a person could type.
export const LOOKS: readonly Look[] = [
  { id: "vivid", label: "Vivid", adjust: { contrast: 0.15, saturation: 0.35 } },
  { id: "warm", label: "Warm", adjust: { temperature: 0.35, saturation: 0.1 } },
  { id: "cool", label: "Cool", adjust: { temperature: -0.35, saturation: 0.05 } },
  { id: "mono", label: "B&W", adjust: { saturation: -1, contrast: 0.15 } },
  { id: "fade", label: "Fade", adjust: { brightness: 0.08, contrast: -0.2, saturation: -0.15 } },
  { id: "vintage", label: "Vintage", adjust: { contrast: -0.1, saturation: -0.25, temperature: 0.3, vignette: 0.45 } },
  { id: "drama", label: "Drama", adjust: { brightness: -0.05, contrast: 0.35, saturation: -0.1, vignette: 0.35 } },
];

// The colour keys as a look sets them: its own values, and 0 for the rest.
export function lookPatch(look: Look | null): Record<(typeof LOOK_KEYS)[number], number> {
  const patch = {} as Record<(typeof LOOK_KEYS)[number], number>;
  for (const key of LOOK_KEYS) patch[key] = look?.adjust[key] ?? 0;
  return patch;
}

// The look a picture's colours match exactly, or null: "none" when every colour key is 0.
export function lookOf(adjust: Adjust | undefined): string | null {
  const now = adjustOf(adjust);
  const matches = (look: Look | null) => {
    const patch = lookPatch(look);
    return LOOK_KEYS.every((key) => now[key] === patch[key]);
  };
  if (matches(null)) return "none";
  return LOOKS.find(matches)?.id ?? null;
}

// How a clip mixes with what is under it. "normal" covers it; the rest are the canvas's own blends ("add" brightens by
// adding the two).
export const BLEND_MODES: readonly BlendMode[] = BlendMode.options;

export const BLEND_LABEL: Record<BlendMode, string> = {
  normal: "Normal",
  multiply: "Multiply",
  screen: "Screen",
  overlay: "Overlay",
  darken: "Darken",
  lighten: "Lighten",
  add: "Add",
  "soft-light": "Soft light",
  "hard-light": "Hard light",
  difference: "Difference",
};
