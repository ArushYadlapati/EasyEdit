import type { AssetView } from "@/lib/media/types";
import { DEFAULT_FONT } from "./fonts";

// The font each kind of text starts in.
export type BrandFonts = { title: string; subtitle: string; body: string };
export type BrandRole = keyof BrandFonts;

// A space's kit as members see it: logos are the images themselves, in the kit's order, only those still in the library.
export type BrandKit = { fonts: BrandFonts; colors: string[]; logos: AssetView[]; updatedAt: string | null };

// A change: each field given replaces the one kept.
export type BrandKitPatch = { titleFont?: string; subtitleFont?: string; bodyFont?: string; colors?: string[]; logoAssetIds?: string[] };

export const DEFAULT_BRAND_FONTS: BrandFonts = { title: DEFAULT_FONT, subtitle: DEFAULT_FONT, body: DEFAULT_FONT };
export const DEFAULT_BRAND_KIT: BrandKit = { fonts: DEFAULT_BRAND_FONTS, colors: [], logos: [], updatedAt: null };
export const BRAND_LIMITS = { colors: 24, logos: 24 } as const;
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
