import { makeFontResolver } from "@/lib/editor/fonts";
import { letterSpacingOf, textFont } from "@/lib/render/text-layout";
import type { TextClip } from "@/lib/timeline";

type Measurer = { ctx: CanvasRenderingContext2D | null; resolveFont: (family: string) => string };

// One 2D context for the whole page, made on the first measure in the browser and kept. Never made on the server.
let shared: Measurer | null = null;

function measurer(): Measurer | null {
  if (typeof document === "undefined") return null;
  if (!shared) {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = document.createElement("canvas").getContext("2d");
    } catch {
      ctx = null;
    }
    shared = { ctx, resolveFont: makeFontResolver(cachedCssVar()) };
  }
  return shared;
}

// Reads CSS variables from the document element, as the preview does. The app's font variables never change once
// set, so a value is read once.
function cachedCssVar(): (name: string) => string {
  const cache = new Map<string, string>();
  return (name) => {
    const known = cache.get(name);
    if (known !== undefined) return known;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    if (value.trim()) cache.set(name, value);
    return value;
  };
}

// The width of a line of the clip's text in its own font, as the preview draws it. Without a 2D context (on the
// server, or where canvas is missing), each character is half the font size wide.
function measureText(clip: TextClip, s: string): number {
  const { fontSize, fontFamily } = clip.style;
  const m = measurer();
  if (!m?.ctx) return (s.length * fontSize) / 2;
  m.ctx.font = textFont(clip.style, m.resolveFont(fontFamily));
  m.ctx.letterSpacing = letterSpacingOf(clip.style) ?? "0px";
  return m.ctx.measureText(s).width;
}

// The text measure the inspector sizes text clips with. The function is the same on every render.
export function useTextMeasure(): (clip: TextClip, s: string) => number {
  return measureText;
}
