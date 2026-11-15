// The fonts text can be set in: a fixed list, each family served by the app itself (src/app/fonts.ts loads every one
// with next/font, so no browser asks Google for anything and export copies them as it copies Geist). A plain module,
// so the server checks a brand kit against it and the editor builds its menus from it.

export type FontCategory = "sans" | "serif" | "display" | "handwriting" | "mono";
export type BrandFont = { family: string; category: FontCategory; weights: readonly number[] };

export const DEFAULT_FONT = "Geist";

// Each family's weights between 300 and 900 that Google has for it: the editor never offers a weight a font lacks.
const ALL = [300, 400, 500, 600, 700, 800, 900] as const;
const font = (family: string, category: FontCategory, weights: readonly number[] = ALL): BrandFont => ({ family, category, weights });

export const FONT_LIST: readonly BrandFont[] = [
  font("Anton", "display", [400]),
  font("Archivo Black", "display", [400]),
  font("Audiowide", "display", [400]),
  font("Bangers", "display", [400]),
  font("Barlow", "sans"),
  font("Barlow Condensed", "sans"),
  font("Bebas Neue", "display", [400]),
  font("Caveat", "handwriting", [400, 500, 600, 700]),
  font("DM Sans", "sans"),
  font("DM Serif Display", "serif", [400]),
  font("Exo 2", "sans"),
  font("Fira Sans", "sans"),
  font("Geist", "sans"),
  font("IBM Plex Sans", "sans", [300, 400, 500, 600, 700]),
  font("Inter", "sans"),
  font("JetBrains Mono", "mono", [300, 400, 500, 600, 700, 800]),
  font("Kanit", "sans"),
  font("Lato", "sans", [300, 400, 700, 900]),
  font("Lobster", "handwriting", [400]),
  font("Lora", "serif", [400, 500, 600, 700]),
  font("Merriweather", "serif"),
  font("Montserrat", "sans"),
  font("Nunito", "sans"),
  font("Open Sans", "sans", [300, 400, 500, 600, 700, 800]),
  font("Orbitron", "display", [400, 500, 600, 700, 800, 900]),
  font("Oswald", "sans", [300, 400, 500, 600, 700]),
  font("Pacifico", "handwriting", [400]),
  font("Permanent Marker", "handwriting", [400]),
  font("Playfair Display", "serif", [400, 500, 600, 700, 800, 900]),
  font("Poppins", "sans"),
  font("Rajdhani", "sans", [300, 400, 500, 600, 700]),
  font("Raleway", "sans"),
  font("Righteous", "display", [400]),
  font("Roboto", "sans"),
  font("Rubik", "sans"),
  font("Russo One", "display", [400]),
  font("Source Serif 4", "serif"),
  font("Space Grotesk", "sans", [300, 400, 500, 600, 700]),
  font("Teko", "display", [300, 400, 500, 600, 700]),
  font("Titillium Web", "sans", [300, 400, 600, 700, 900]),
  font("Work Sans", "sans"),
];

const byFamily = new Map(FONT_LIST.map((f) => [f.family, f]));

export function isListedFont(family: string): boolean {
  return byFamily.has(family);
}

// The weights a listed font has; null for any other name.
export function fontWeights(family: string): readonly number[] | null {
  return byFamily.get(family)?.weights ?? null;
}

// The weight of the font nearest the one wanted; a tie goes to the heavier. A font not in the list keeps what was wanted.
export function nearestWeight(family: string, wanted: number): number {
  const weights = fontWeights(family);
  if (!weights) return wanted;
  let best = weights[0];
  for (const w of weights) {
    const d = Math.abs(w - wanted);
    const bestD = Math.abs(best - wanted);
    if (d < bestD || (d === bestD && w > best)) best = w;
  }
  return best;
}

// The CSS variable next/font sets to the family's loaded font list. Geist keeps the name it has always had.
export function fontVariable(family: string): string {
  if (family === "Geist") return "--font-geist-sans";
  return `--font-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
