import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FONT_LIST, fontVariable, fontWeights, isListedFont, nearestWeight } from "@/lib/brand/fonts";
import { FONT_VARS, makeFontResolver } from "@/lib/editor/fonts";

const appFonts = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/app/fonts.ts"), "utf8");

describe("the brand kit's font list", () => {
  it("has Geist, Inter and Orbitron", () => {
    for (const family of ["Geist", "Inter", "Orbitron"]) expect(isListedFont(family)).toBe(true);
    expect(FONT_LIST.length).toBeGreaterThanOrEqual(30);
    expect(isListedFont("Comic Sans MS")).toBe(false);
  });

  it("lists each family once, by name", () => {
    const names = FONT_LIST.map((f) => f.family);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("gives each family its real weights, lightest first", () => {
    for (const font of FONT_LIST) {
      expect(font.weights.length, font.family).toBeGreaterThan(0);
      expect([...font.weights].sort((a, b) => a - b), font.family).toEqual(font.weights);
      for (const w of font.weights) expect(w % 100 === 0 && w >= 100 && w <= 900, `${font.family} ${w}`).toBe(true);
    }
    expect(fontWeights("Bebas Neue")).toEqual([400]);
    expect(fontWeights("Orbitron")).toContain(900);
    expect(fontWeights("Comic Sans MS")).toBeNull();
  });

  it("finds the nearest weight a font has", () => {
    expect(nearestWeight("Bebas Neue", 700)).toBe(400);
    expect(nearestWeight("Inter", 700)).toBe(700);
    expect(nearestWeight("Lato", 500)).toBe(400); // 400 and 700 are not a tie: 400 is nearer
    expect(nearestWeight("Lato", 800)).toBe(900); // a tie between 700 and 900 goes to the heavier
    expect(nearestWeight("Comic Sans MS", 650)).toBe(650);
  });

  it("names each family's CSS variable", () => {
    expect(fontVariable("Geist")).toBe("--font-geist-sans");
    expect(fontVariable("Exo 2")).toBe("--font-exo-2");
    expect(fontVariable("IBM Plex Sans")).toBe("--font-ibm-plex-sans");
  });

  it("gives every family a resolver variable", () => {
    for (const { family } of FONT_LIST) expect(FONT_VARS[family], family).toBe(fontVariable(family));
    const resolve = makeFontResolver((name) => (name === "--font-orbitron" ? "'Orbitron', 'Orbitron Fallback'" : ""));
    expect(resolve("Orbitron")).toBe("'Orbitron', 'Orbitron Fallback'");
  });

  it("loads every family in src/app/fonts.ts", () => {
    for (const { family } of FONT_LIST) expect(appFonts, family).toContain(`variable: "${fontVariable(family)}"`);
  });
});
