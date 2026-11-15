import { BRAND_LIMITS } from "./types";

// What a refused brand kit change says, to the person in the kit editor and to an agent.
export const BRAND_MESSAGES = {
  unknownFont: (family: string) => `"${family}" is not one of the fonts EasyEdit has.`,
  badColor: (color: string) => `"${color}" is not a color. Use a hex color like #ff5a1f.`,
  tooManyColors: `A brand kit holds up to ${BRAND_LIMITS.colors} colors.`,
  tooManyLogos: `A brand kit holds up to ${BRAND_LIMITS.logos} logos.`,
  badLogo: "A logo must be an uploaded image in this space's media.",
} as const;
