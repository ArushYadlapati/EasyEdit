import { makeFontResolver } from "@/lib/editor/fonts";
import {
  buildFontBundle, fontRulesFrom, probeRequests, strictFontRequest, type FontBundle, type FontRequest, type FontRule,
} from "@/lib/export/fonts";
import type { TimelineDoc } from "@/lib/timeline";

// The page's one font rule, shared by the preview, thumbnails and export: which font strings the text is drawn with
// (pageFontResolver), and which faces and characters must be loaded first (probeRequests).

// Reads CSS variables from the document element. The app's font variables never change once set, so a
// value is read once.
export function cachedCssVar(): (name: string) => string {
  const cache = new Map<string, string>();
  return (name) => {
    const known = cache.get(name);
    if (known !== undefined) return known;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    if (value.trim()) cache.set(name, value);
    return value;
  };
}

// The font string each document family is drawn with on this page: the preview's, the thumbnail's and the export's.
export function pageFontResolver(): (family: string) => string {
  return makeFontResolver(cachedCssVar());
}

// Asks the page for each font with the characters it must draw, and settles once each has loaded or failed. It never
// rejects, and does nothing where the page has no document.fonts: a face that fails is drawn in its fallback.
export async function loadFonts(requests: Iterable<FontRequest>): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const load = async ({ font, text }: FontRequest) => {
    try {
      await document.fonts.load(font, text);
    } catch {
      // the text is drawn in its fallback face
    }
  };
  await Promise.all(Array.from(requests, load));
}

// As loadFonts, but rejects when a face cannot be loaded, so nothing is drawn in a substitute: for export and Save
// frame. A font no face on this page provides answers nothing, and is drawn as the page draws it. A family whose
// faces all point at a font installed on the computer (strictFontRequest) is loaded as the preview loads it, and may
// fail.
export async function loadFontsStrict(requests: Iterable<FontRequest>, rules?: FontRule[]): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) throw new Error("This page cannot load fonts.");
  const pageRules = rules ?? fontRulesFrom(Array.from(document.styleSheets), document.baseURI);
  const load = async (request: FontRequest) => {
    const strict = strictFontRequest(request, pageRules);
    if (strict !== request) await loadFonts([request]);
    if (strict === null) return;
    const faces = await document.fonts.load(strict.font, strict.text);
    const failed = faces.find((face) => face.status !== "loaded");
    if (failed) throw new Error(`The font ${strict.font} did not load (${failed.status}).`);
  };
  await Promise.all(Array.from(requests, load));
}

// The export's font bundle: every face the drawn text needs, loaded with its characters, then each probe measured on a
// canvas of this page that is never added to it.
export async function collectPageFonts(doc: TimelineDoc): Promise<FontBundle> {
  const resolveFont = pageFontResolver();
  await loadFontsStrict(probeRequests(doc, resolveFont));
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("The page's canvas has no 2D context.");
  const measure = (font: string, text: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  return buildFontBundle(doc, resolveFont, fontRulesFrom(Array.from(document.styleSheets), document.baseURI), measure);
}
