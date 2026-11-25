import { BlendMode, type Adjust } from "./types";

// A picture's colour and focus changes. Every one is 0 when the picture is as recorded: brightness, contrast,
// saturation and temperature run from −1 to 1 (temperature: cooler to warmer), hue is degrees round the colour wheel,
// blur is project pixels and vignette how dark the corners get, 0 to 1.
export const TONE_KEYS = ["brightness", "contrast", "saturation", "temperature", "hue", "blur", "vignette"] as const;
// The stylised effects: how sharp, how grainy, how far red and blue are pulled apart, how glitchy and how much like a
// worn video tape, each 0 to 1, and the side of a pixelated picture's blocks in project pixels.
export const STYLE_KEYS = ["sharpen", "grain", "pixelate", "split", "glitch", "vhs"] as const;
export const ADJUST_KEYS = [...TONE_KEYS, ...STYLE_KEYS] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];
export type StyleKey = (typeof STYLE_KEYS)[number];
export type FullAdjust = Record<AdjustKey, number>;

export const NO_ADJUST: Readonly<FullAdjust> = Object.freeze({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  hue: 0,
  blur: 0,
  vignette: 0,
  sharpen: 0,
  grain: 0,
  pixelate: 0,
  split: 0,
  glitch: 0,
  vhs: 0,
});

// The least and most each may be.
export const ADJUST_LIMITS: Record<AdjustKey, { min: number; max: number }> = {
  brightness: { min: -1, max: 1 },
  contrast: { min: -1, max: 1 },
  saturation: { min: -1, max: 1 },
  temperature: { min: -1, max: 1 },
  hue: { min: -180, max: 180 },
  blur: { min: 0, max: 200 },
  vignette: { min: 0, max: 1 },
  sharpen: { min: 0, max: 1 },
  grain: { min: 0, max: 1 },
  pixelate: { min: 0, max: 200 },
  split: { min: 0, max: 1 },
  glitch: { min: 0, max: 1 },
  vhs: { min: 0, max: 1 },
};

// Every key given its value.
export function adjustOf(adjust: Adjust | undefined): FullAdjust {
  return { ...NO_ADJUST, ...adjust };
}

export function isAdjusted(adjust: Adjust | undefined): boolean {
  return adjust !== undefined && ADJUST_KEYS.some((key) => (adjust[key] ?? 0) !== 0);
}

// Whether any colour or focus change is on (what a canvas draws), and whether any stylised effect is (what the
// graphics card draws).
export function isToned(adjust: Adjust | undefined): boolean {
  return adjust !== undefined && TONE_KEYS.some((key) => (adjust[key] ?? 0) !== 0);
}
export function isStyled(adjust: Adjust | undefined): boolean {
  return adjust !== undefined && STYLE_KEYS.some((key) => (adjust[key] ?? 0) !== 0);
}

// Each kind's keys at 0, as an update_clip patch that takes that kind off.
export const NO_TONE = Object.freeze(Object.fromEntries(TONE_KEYS.map((key) => [key, 0]))) as Readonly<Record<(typeof TONE_KEYS)[number], number>>;
export const NO_STYLE = Object.freeze(Object.fromEntries(STYLE_KEYS.map((key) => [key, 0]))) as Readonly<Record<StyleKey, number>>;

// The colour keys a look sets. Blur is a focus change, so a look leaves it alone.
export const LOOK_KEYS = ["brightness", "contrast", "saturation", "temperature", "hue", "vignette"] as const;

export type Look = { id: string; label: string; adjust: Partial<FullAdjust> };

// Ready-made colour looks, each a set of the same numbers a person could type.
export const LOOKS: readonly Look[] = [
  { id: "vivid", label: "Vivid", adjust: { contrast: 0.15, saturation: 0.35 } },
  { id: "pop", label: "Pop", adjust: { brightness: 0.03, contrast: 0.25, saturation: 0.6 } },
  { id: "warm", label: "Warm", adjust: { temperature: 0.35, saturation: 0.1 } },
  { id: "golden", label: "Golden", adjust: { brightness: 0.05, contrast: 0.05, saturation: 0.2, temperature: 0.5 } },
  { id: "cool", label: "Cool", adjust: { temperature: -0.35, saturation: 0.05 } },
  { id: "dusk", label: "Dusk", adjust: { contrast: 0.1, saturation: 0.15, temperature: -0.2, hue: -12, vignette: 0.25 } },
  { id: "soft", label: "Soft", adjust: { brightness: 0.06, contrast: -0.12, saturation: 0.1, temperature: 0.1 } },
  { id: "fade", label: "Fade", adjust: { brightness: 0.08, contrast: -0.2, saturation: -0.15 } },
  { id: "vintage", label: "Vintage", adjust: { contrast: -0.1, saturation: -0.25, temperature: 0.3, vignette: 0.45 } },
  { id: "moody", label: "Moody", adjust: { brightness: -0.1, contrast: 0.2, saturation: -0.3, temperature: -0.15, vignette: 0.3 } },
  { id: "drama", label: "Drama", adjust: { brightness: -0.05, contrast: 0.35, saturation: -0.1, vignette: 0.35 } },
  { id: "mono", label: "B&W", adjust: { saturation: -1, contrast: 0.15 } },
  { id: "noir", label: "Noir", adjust: { brightness: -0.05, contrast: 0.45, saturation: -1, vignette: 0.5 } },
  { id: "sepia", label: "Sepia", adjust: { contrast: 0.05, saturation: -1, temperature: 0.55 } },
];

const places = (n: number) => Number(n.toFixed(4));

// The colour keys as a look sets them: its own values, and 0 for the rest. strength: how much of the look, 0 to 1;
// every value is that share of the look's own.
export function lookPatch(look: Look | null, strength = 1): Record<(typeof LOOK_KEYS)[number], number> {
  const patch = {} as Record<(typeof LOOK_KEYS)[number], number>;
  for (const key of LOOK_KEYS) patch[key] = places((look?.adjust[key] ?? 0) * strength);
  return patch;
}

// How far two numbers stored to four places may be apart and still be the same share of a look.
const NEAR = 0.00016;

// The look a picture's colours are, and how much of it: every colour the same share of the look's own, above none and
// at most the whole. "none" when every colour key is 0; null when the colours are no look's.
export function lookMatch(adjust: Adjust | undefined): { id: string; strength: number } | null {
  const now = adjustOf(adjust);
  if (LOOK_KEYS.every((key) => now[key] === 0)) return { id: "none", strength: 1 };
  for (const look of LOOKS) {
    // The share is read off the look's largest colour, where rounding moves it least.
    const lead = LOOK_KEYS.reduce((a, b) => (Math.abs(look.adjust[b] ?? 0) > Math.abs(look.adjust[a] ?? 0) ? b : a));
    const strength = now[lead] / look.adjust[lead]!;
    if (!(strength > 0) || strength > 1 + NEAR) continue;
    if (LOOK_KEYS.every((key) => Math.abs(now[key] - (look.adjust[key] ?? 0) * strength) <= NEAR)) return { id: look.id, strength: Math.min(1, places(strength)) };
  }
  return null;
}

// The look a picture's colours are, at any strength, or null: "none" when every colour key is 0.
export function lookOf(adjust: Adjust | undefined): string | null {
  return lookMatch(adjust)?.id ?? null;
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
