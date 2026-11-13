import { defaultResolveFont } from "@/lib/render/compositor";
import type { TimelineDoc } from "@/lib/timeline";

// Document font names that the app loads itself, and the CSS variable holding each one's loaded family list.
export const FONT_VARS: Record<string, string> = { Geist: "--font-geist-sans", "Geist Mono": "--font-geist-mono" };

// A document font name as a CSS font-family for the page itself, where the app fonts' variables apply directly.
export function cssFontFamily(family: string): string {
  return Object.hasOwn(FONT_VARS, family) ? `var(${FONT_VARS[family]})` : defaultResolveFont(family);
}

// A font resolver for the compositor. readVar reads a CSS variable; an app font whose variable is
// set uses that value, and every other name falls back to the compositor's default.
export function makeFontResolver(readVar: (name: string) => string): (family: string) => string {
  return (family) => {
    const name = Object.hasOwn(FONT_VARS, family) ? FONT_VARS[family] : undefined;
    const value = name ? readVar(name).trim() : "";
    return value || defaultResolveFont(family);
  };
}

// Each distinct weight and family the text clips use, as a CSS font for document.fonts.load. The size
// does not choose the face, so one size stands for all.
export function textFonts(doc: TimelineDoc, resolveFont: (family: string) => string): Set<string> {
  const fonts = new Set<string>();
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (clip.type === "text") fonts.add(`${clip.style.fontWeight} 16px ${resolveFont(clip.style.fontFamily)}`);
    }
  }
  return fonts;
}
