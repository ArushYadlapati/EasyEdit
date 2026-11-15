import { DEFAULT_FONT, nearestWeight } from "@/lib/brand/fonts";
import { DEFAULT_BRAND_FONTS, type BrandFonts, type BrandRole } from "@/lib/brand/types";
import { DEFAULT_TRANSFORM, type TextClip } from "@/lib/timeline";

export const TEXT_FONT = DEFAULT_FONT;
export const DEFAULT_TEXT_SECONDS = 3;

export type TextPresetId = "title" | "subtitle" | "body" | "lower-third";

// A kind of text. Its font is the brand kit's font for its role, at the weight here or the nearest that font has.
export type TextPreset = {
  id: TextPresetId;
  label: string;
  text: string;
  role: BrandRole;
  fontSize: number;
  fontWeight: number;
  align: "left" | "center" | "right";
  y: number;
};

// The Text tab's presets, in its order.
export const TEXT_PRESETS: TextPreset[] = [
  { id: "title", label: "Title", text: "Your title", role: "title", fontSize: 96, fontWeight: 700, align: "center", y: 0.5 },
  { id: "subtitle", label: "Subtitle", text: "Your subtitle", role: "subtitle", fontSize: 56, fontWeight: 500, align: "center", y: 0.6 },
  { id: "body", label: "Body text", text: "Your text", role: "body", fontSize: 40, fontWeight: 400, align: "center", y: 0.7 },
];

// What agents' add_text offers: the Text tab's presets, and the lower third the Text tab used to have, which agents
// may still ask for.
export const TOOL_PRESETS: TextPreset[] = [
  ...TEXT_PRESETS,
  { id: "lower-third", label: "Lower third", text: "Name and role", role: "body", fontSize: 44, fontWeight: 600, align: "left", y: 0.62 },
];

export function presetFont(preset: TextPreset, fonts: BrandFonts): { fontFamily: string; fontWeight: number } {
  const fontFamily = fonts[preset.role];
  return { fontFamily, fontWeight: nearestWeight(fontFamily, preset.fontWeight) };
}

// The id is a stand-in: placement gives the clip its real one. The length is in seconds, as Settings gives it. Without
// fonts the preset is in the default kit's.
export function presetClip(preset: TextPreset, start: number, fps: number, seconds = DEFAULT_TEXT_SECONDS, fonts: BrandFonts = DEFAULT_BRAND_FONTS): TextClip {
  return {
    id: "preset",
    type: "text",
    start,
    duration: Math.max(1, Math.round(seconds * fps)),
    text: preset.text,
    transform: { ...DEFAULT_TRANSFORM, x: 0.5, y: preset.y },
    style: { ...presetFont(preset, fonts), fontSize: preset.fontSize, color: "#ffffff", align: preset.align },
  };
}
