import { defaultResolveFont } from "@/lib/render/compositor";
import { captionsShow, docCues, type Cue } from "@/lib/captions/cues";
import { graphemes } from "@/lib/text";
import type { TextClip, TimelineDoc } from "@/lib/timeline";
import { captionStyleOf } from "@/lib/timeline/captions";
import { mayShow } from "@/lib/timeline/keyframes";
import { expandNests } from "@/lib/timeline/nest";

// The fonts an export needs: the page's @font-face rules turned into faces the worker can build, the font string
// for each family the text uses, and one measured line per font so the worker can prove it draws the same text.

export type RuleLike = { cssText: string; style?: { getPropertyValue(name: string): string }; cssRules?: ArrayLike<RuleLike> };
export type SheetLike = { href: string | null; cssRules: ArrayLike<RuleLike> };
// One @font-face rule as a style sheet gives it. descriptors are keyed by CSS name ("font-weight", "unicode-range", "size-adjust", …).
export type FontRule = { family: string; src: string; baseUrl: string; descriptors: Record<string, string> };
// What the worker passes to new FontFace(family, source, descriptors). required: the face has a file to fetch (a url(...) source).
export type FontFaceSpec = { family: string; source: string; descriptors: Record<string, string>; required: boolean };
// A CSS font and the characters it must draw: what the page's font loader is asked to load.
export type FontRequest = { font: string; text: string };
export type FontProbe = FontRequest & { width: number };
export type FontBundle = { families: Record<string, string>; faces: FontFaceSpec[]; probes: FontProbe[] };

export const PROBE_PX = 100;
export const PROBE_BASE = "Hamburgefonstiv 0123456789";
const MAX_EXTRA_CHARACTERS = 256;

// Each @font-face descriptor carried over, by its CSS name, with the name a FontFace takes it by.
const DESCRIPTORS: Record<string, string> = {
  "font-style": "style",
  "font-weight": "weight",
  "font-stretch": "stretch",
  "unicode-range": "unicodeRange",
  "font-feature-settings": "featureSettings",
  "font-variation-settings": "variationSettings",
  "ascent-override": "ascentOverride",
  "descent-override": "descentOverride",
  "line-gap-override": "lineGapOverride",
  "size-adjust": "sizeAdjust",
};

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

// Every @font-face rule in the given sheets, nested lists (@layer, @media) included. A sheet from another site,
// whose rules may not be read, is skipped.
export function fontRulesFrom(sheets: Iterable<SheetLike>, pageUrl: string): FontRule[] {
  const rules: FontRule[] = [];
  const walk = (list: ArrayLike<RuleLike>, baseUrl: string) => {
    for (const rule of Array.from(list)) {
      if (rule.cssText.startsWith("@font-face") && rule.style) {
        const style = rule.style;
        const descriptors: Record<string, string> = {};
        for (const name of Object.keys(DESCRIPTORS)) {
          const value = style.getPropertyValue(name).trim();
          if (value) descriptors[name] = value;
        }
        rules.push({ family: unquote(style.getPropertyValue("font-family")), src: style.getPropertyValue("src").trim(), baseUrl, descriptors });
      } else if (rule.cssRules) {
        walk(rule.cssRules, baseUrl);
      }
    }
  };
  for (const sheet of sheets) {
    let list: ArrayLike<RuleLike>;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    walk(list, sheet.href ?? pageUrl);
  }
  return rules;
}

const URL_PART = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g;

// The rules of the given families (compared without case), in rule order, as FontFace arguments with every url(...)
// made a full address.
export function fontFaceSpecs(rules: FontRule[], families: string[]): FontFaceSpec[] {
  const wanted = new Set(families.map((family) => family.toLowerCase()));
  return rules
    .filter((rule) => wanted.has(rule.family.toLowerCase()))
    .map((rule) => {
      const source = rule.src.replace(URL_PART, (_all, double?: string, single?: string, bare?: string) =>
        `url("${new URL(double ?? single ?? bare ?? "", rule.baseUrl).href}")`);
      const descriptors: Record<string, string> = {};
      for (const [name, value] of Object.entries(rule.descriptors)) {
        if (Object.hasOwn(DESCRIPTORS, name)) descriptors[DESCRIPTORS[name]] = value;
      }
      return { family: rule.family, source, descriptors, required: source.includes("url(") };
    });
}

// The part of a font request that must load for an export or a saved frame: its font string without each family
// whose @font-face rules on the page all point only at a font installed on the computer (next/font's
// "Geist Fallback", local(Arial)), or null when no family is left. The request itself when none is left out. A
// family with no rule at all stays: the browser answers nothing for it.
export function strictFontRequest(request: FontRequest, rules: FontRule[]): FontRequest | null {
  const installedOnly = (family: string) => {
    const name = unquote(family).toLowerCase();
    const own = rules.filter((rule) => rule.family.toLowerCase() === name);
    return own.length > 0 && own.every((rule) => !rule.src.includes("url("));
  };
  const cut = request.font.indexOf("px ") + "px ".length;
  const families = request.font.slice(cut).split(",").map((family) => family.trim());
  const kept = families.filter((family) => !installedOnly(family));
  if (kept.length === families.length) return request;
  if (kept.length === 0) return null;
  return { font: request.font.slice(0, cut) + kept.join(", "), text: request.text };
}

// The text clips that draw: on tracks that are shown, and visible at some point (a fade in from opacity 0 counts).
function drawnTextClips(doc: TimelineDoc): TextClip[] {
  const clips: TextClip[] = [];
  for (const track of expandNests(doc).tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) if (clip.type === "text" && mayShow(clip)) clips.push(clip);
  }
  return clips;
}

// The caption look and the lines it will draw, when captions are shown and there is something to say; else null.
function drawnCaptions(doc: TimelineDoc): { style: ReturnType<typeof captionStyleOf>; cues: Cue[] } | null {
  if (!captionsShow(doc)) return null;
  const cues = docCues(doc);
  if (cues.length === 0) return null;
  return { style: captionStyleOf(doc), cues };
}

const isLineBreak = (character: string) => /^[\r\n]+$/.test(character);
// Each character of plain ASCII text is one grapheme, so such text needs no segmenter.
const isAscii = (text: string) => /^[\x00-\x7f]*$/.test(text);

// The one rule for which fonts and characters a project needs: one request per family and weight its drawn text
// uses, in the order first met, with the base line and then each character those clips add, once.
export function probeRequests(doc: TimelineDoc, resolveFont: (family: string) => string): FontRequest[] {
  const base = new Set(graphemes(PROBE_BASE));
  const byFont = new Map<string, Set<string>>();
  for (const clip of drawnTextClips(doc)) {
    // The clip's own weight, then each other weight a styled span of it is drawn in.
    const weights = new Set([clip.style.fontWeight, ...(clip.spans ?? []).flatMap((span) => (span.fontWeight === undefined ? [] : [span.fontWeight]))]);
    for (const weight of weights) {
      const font = `${weight} ${PROBE_PX}px ${resolveFont(clip.style.fontFamily)}`;
      let extra = byFont.get(font);
      if (!extra) byFont.set(font, (extra = new Set()));
      for (const character of graphemes(clip.text)) {
        if (extra.size >= MAX_EXTRA_CHARACTERS) break;
        if (!base.has(character) && !isLineBreak(character)) extra.add(character);
      }
    }
  }
  const captions = drawnCaptions(doc);
  if (captions) {
    const font = `${captions.style.fontWeight} ${PROBE_PX}px ${resolveFont(captions.style.fontFamily)}`;
    let extra = byFont.get(font);
    if (!extra) byFont.set(font, (extra = new Set()));
    // This runs on every change of the shown document, and an hour of speech is thousands of words: it stops once the
    // most characters are collected, and takes a plain ASCII word's characters as they are.
    collect: for (const cue of captions.cues) {
      for (const { text } of cue.words) {
        if (extra.size >= MAX_EXTRA_CHARACTERS) break collect;
        const word = captions.style.uppercase ? text.toUpperCase() : text;
        for (const character of isAscii(word) ? word : graphemes(word)) {
          if (extra.size >= MAX_EXTRA_CHARACTERS) break;
          if (!base.has(character) && !isLineBreak(character)) extra.add(character);
        }
      }
    }
  }
  return Array.from(byFont, ([font, extra]) => ({ font, text: PROBE_BASE + Array.from(extra).join("") }));
}

const familyNames = (list: string) => list.split(",").map(unquote).filter(Boolean);

// Everything the worker needs to draw the project's text as the page does, measured on the page.
export function buildFontBundle(
  doc: TimelineDoc, resolveFont: (family: string) => string, rules: FontRule[], measure: (font: string, text: string) => number,
): FontBundle {
  const families: Record<string, string> = {};
  for (const clip of drawnTextClips(doc)) {
    const family = clip.style.fontFamily;
    if (!Object.hasOwn(families, family)) families[family] = resolveFont(family);
  }
  const captions = drawnCaptions(doc);
  if (captions && !Object.hasOwn(families, captions.style.fontFamily)) families[captions.style.fontFamily] = resolveFont(captions.style.fontFamily);
  const names = [...new Set(Object.values(families).flatMap(familyNames))];
  const probes = probeRequests(doc, resolveFont).map((request) => ({ ...request, width: measure(request.font, request.text) }));
  return { families, faces: fontFaceSpecs(rules, names), probes };
}

// The worker's resolveFont: the page's string for a family it sent, the compositor's default for any other.
export function jobFontResolver(families: Record<string, string>): (family: string) => string {
  return (family) => (Object.hasOwn(families, family) ? families[family] : defaultResolveFont(family));
}

// The first probe that measures differently here than on the page, by more than half a pixel or 0.1%, or null.
export function mismatchedProbe(probes: FontProbe[], measure: (font: string, text: string) => number): FontProbe | null {
  return probes.find((probe) => Math.abs(measure(probe.font, probe.text) - probe.width) > Math.max(0.5, probe.width * 0.001)) ?? null;
}
