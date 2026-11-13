import { defaultResolveFont } from "@/lib/render/compositor";

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
