import { describe, expect, it } from "vitest";
import { makeFontResolver } from "@/lib/editor/fonts";
import {
  PROBE_BASE, buildFontBundle, fontFaceSpecs, fontRulesFrom, jobFontResolver, mismatchedProbe, probeRequests, strictFontRequest, type FontRule,
} from "@/lib/export/fonts";
import { drawFrame } from "@/lib/render/compositor";
import { graphemes } from "@/lib/text";
import { createEmptyDoc, type Clip, type TimelineDoc } from "@/lib/timeline";
import { text } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx } from "../render/fake-ctx";

const SHEET = "https://app.test/_next/static/chunks/1jrsbwixkl84l.css";
// The rules next/font writes for Geist, as the built style sheet has them.
const RULES: FontRule[] = [
  { family: "Geist", src: 'url(../media/77814b00d5ca94a4-s.21jp631_3pja2.woff2)format("woff2")', baseUrl: SHEET,
    descriptors: { "font-style": "normal", "font-weight": "100 900", "unicode-range": "U+100-2BA,U+2BD-2C5" } },
  { family: "Geist", src: 'url("../media/605ce01b664af129-s.p.0wgildi0cnwt9.woff2") format("woff2")', baseUrl: SHEET,
    descriptors: { "font-style": "normal", "font-weight": "100 900", "unicode-range": "U+??,U+131" } },
  { family: "Geist Fallback", src: "local(Arial)", baseUrl: SHEET,
    descriptors: { "ascent-override": "95.94%", "descent-override": "28.16%", "line-gap-override": "0.0%", "size-adjust": "104.76%" } },
  { family: "Geist Mono", src: "url(/_next/static/media/mono.woff2)", baseUrl: SHEET, descriptors: { "font-weight": "100 900" } },
];
const pageFont = makeFontResolver((name) => (name === "--font-geist-sans" ? '"Geist", "Geist Fallback"' : ""));
const medium = { fontFamily: "Geist", fontSize: 64, fontWeight: 500, color: "#ffffff", align: "center" };
function docWith(...clips: Clip[]): TimelineDoc {
  const d = createEmptyDoc("short_9x16");
  d.tracks[1].clips = clips;
  return d;
}
const doc = () => docWith(text("a", 0, 30, { text: "GO Žofia" }), text("b", 30, 30, { text: "go!\n🤖" }), text("c", 60, 30, { text: "x", style: medium }));
const measure = (_font: string, t: string) => t.length * 50;

describe("reading the page's font rules", () => {
  it("finds font rules in every sheet and nested list, and skips a sheet it may not read", () => {
    const rule = (cssText: string, props: Record<string, string>) => ({ cssText, style: { getPropertyValue: (name: string) => props[name] ?? "" } });
    const sheets = [
      { href: SHEET, cssRules: [
        { cssText: ".a { color: red; }" },
        rule("@font-face { font-family: Geist; }", { "font-family": "Geist", src: "url(../media/a.woff2)", "font-weight": "100 900", "unicode-range": "U+100-2BA", "font-display": "swap" }),
        { cssText: "@layer base { }", cssRules: [rule("@font-face { font-family: Inner; }", { "font-family": '"Inner"', src: "local(Arial)", "size-adjust": "104.76%" })] },
      ] },
      { href: "https://other.test/x.css", get cssRules(): never { throw new Error("SecurityError"); } },
      { href: null, cssRules: [rule("@font-face { font-family: Inline; }", { "font-family": "Inline", src: "url(/f/b.woff2)" })] },
    ];
    expect(fontRulesFrom(sheets, "https://app.test/editor/p1")).toEqual([
      { family: "Geist", src: "url(../media/a.woff2)", baseUrl: SHEET, descriptors: { "font-weight": "100 900", "unicode-range": "U+100-2BA" } },
      { family: "Inner", src: "local(Arial)", baseUrl: SHEET, descriptors: { "size-adjust": "104.76%" } },
      { family: "Inline", src: "url(/f/b.woff2)", baseUrl: "https://app.test/editor/p1", descriptors: {} },
    ]);
  });

  it("a style rule is not a font rule, even with a font-family", () => {
    const style = { getPropertyValue: (name: string) => (name === "font-family" ? "Geist" : "") };
    expect(fontRulesFrom([{ href: SHEET, cssRules: [{ cssText: "body { font-family: Geist; }", style }] }], SHEET)).toEqual([]);
  });

  it("resolves a single-quoted address too", () => {
    const rule: FontRule = { family: "Q", src: "local(Q), url('../media/q.woff2') format('woff2')", baseUrl: SHEET, descriptors: {} };
    expect(fontFaceSpecs([rule], ["Q"])[0].source).toBe(`local(Q), url("https://app.test/_next/static/media/q.woff2") format('woff2')`);
  });

  it("turns rules into faces the worker can build, with full addresses", () => {
    expect(fontFaceSpecs(RULES, ["geist", "Geist Fallback"])).toEqual([
      { family: "Geist", source: 'url("https://app.test/_next/static/media/77814b00d5ca94a4-s.21jp631_3pja2.woff2")format("woff2")',
        descriptors: { style: "normal", weight: "100 900", unicodeRange: "U+100-2BA,U+2BD-2C5" }, required: true },
      { family: "Geist", source: 'url("https://app.test/_next/static/media/605ce01b664af129-s.p.0wgildi0cnwt9.woff2") format("woff2")',
        descriptors: { style: "normal", weight: "100 900", unicodeRange: "U+??,U+131" }, required: true },
      { family: "Geist Fallback", source: "local(Arial)",
        descriptors: { ascentOverride: "95.94%", descentOverride: "28.16%", lineGapOverride: "0.0%", sizeAdjust: "104.76%" }, required: false },
    ]);
  });

  it("leaves out of the strict request a family whose faces point only at an installed font", () => {
    const rules: FontRule[] = [
      { family: "Geist", src: 'url("/g.woff2") format("woff2")', baseUrl: SHEET, descriptors: {} },
      { family: "Geist Fallback", src: 'local("Arial")', baseUrl: SHEET, descriptors: {} },
    ];
    expect(strictFontRequest({ font: "700 100px 'Geist', 'Geist Fallback'", text: "Hi" }, rules)).toEqual({ font: "700 100px 'Geist'", text: "Hi" });
    expect(strictFontRequest({ font: '700 100px "Geist Fallback"', text: "Hi" }, rules)).toBeNull();
    const plain = { font: '700 100px "Geist", sans-serif', text: "Hi" };
    expect(strictFontRequest(plain, rules)).toBe(plain); // a family with no rule, and a generic name, stay
    // names are compared without case
    expect(strictFontRequest({ font: '400 100px "geist fallback", "Geist"', text: "Hi" }, rules)).toEqual({ font: '400 100px "Geist"', text: "Hi" });
  });

  // Added beyond the brief: catches the removal of "no rule of that name has a url(...) source".
  it("keeps in the strict request a family with any face that has a file to fetch", () => {
    const rules: FontRule[] = [
      { family: "Mixed", src: "local(Mixed)", baseUrl: SHEET, descriptors: {} },
      { family: "Mixed", src: 'url("/m.woff2")', baseUrl: SHEET, descriptors: {} },
      { family: "Geist Fallback", src: 'local("Arial")', baseUrl: SHEET, descriptors: {} },
    ];
    expect(strictFontRequest({ font: '400 100px "Mixed", "Geist Fallback"', text: "Hi" }, rules)).toEqual({ font: '400 100px "Mixed"', text: "Hi" });
  });
});

describe("what a project's text needs", () => {
  it("asks once per family and weight, with the characters the clips use", () => {
    expect(probeRequests(doc(), pageFont)).toEqual([
      { font: '700 100px "Geist", "Geist Fallback"', text: `${PROBE_BASE}GOŽ!🤖` },
      { font: '500 100px "Geist", "Geist Fallback"', text: `${PROBE_BASE}x` },
    ]);
  });

  it("leaves out hidden tracks and invisible clips, and stops at 256 extra characters", () => {
    const hidden = doc();
    hidden.tracks[1].hidden = true;
    expect(probeRequests(hidden, pageFont)).toEqual([]);
    const faded = doc();
    for (const clip of faded.tracks[1].clips) clip.transform.opacity = 0;
    expect(probeRequests(faded, pageFont)).toEqual([]);
    const many = String.fromCodePoint(...Array.from({ length: 300 }, (_, i) => 0x4e00 + i));
    const [probe] = probeRequests(docWith(text("a", 0, 30, { text: many })), pageFont);
    expect(graphemes(probe.text)).toHaveLength(PROBE_BASE.length + 256);
  });

  it("keeps each character whole and once, across clips of one font", () => {
    const requests = probeRequests(docWith(text("a", 0, 30, { text: "👍🏽 🇺🇸 Ž" }), text("b", 30, 30, { text: "Ž👍🏽\r\n🇺🇸🇸🇪" })), pageFont);
    expect(requests).toEqual([{ font: '700 100px "Geist", "Geist Fallback"', text: `${PROBE_BASE}👍🏽🇺🇸Ž🇸🇪` }]);
  });

  it("bundles the font map, the faces in use and the measured widths", () => {
    const bundle = buildFontBundle(doc(), pageFont, RULES, measure);
    expect(bundle.families).toEqual({ Geist: '"Geist", "Geist Fallback"' });
    expect(bundle.faces.map((f) => f.family)).toEqual(["Geist", "Geist", "Geist Fallback"]); // Geist Mono is not in use
    expect(bundle.probes).toEqual([
      { font: '700 100px "Geist", "Geist Fallback"', text: `${PROBE_BASE}GOŽ!🤖`, width: `${PROBE_BASE}GOŽ!🤖`.length * 50 },
      { font: '500 100px "Geist", "Geist Fallback"', text: `${PROBE_BASE}x`, width: 27 * 50 },
    ]);
  });

  it("leaves the fonts of clips that do not draw out of the bundle", () => {
    const d = doc();
    d.tracks[0].hidden = true;
    d.tracks[0].clips = [text("h", 0, 30, { style: { ...medium, fontFamily: "Geist Mono" } })];
    d.tracks[1].clips.push(text("f", 0, 30, { style: { ...medium, fontFamily: "Inter" }, transform: { ...d.tracks[1].clips[0].transform, opacity: 0 } }));
    const bundle = buildFontBundle(d, pageFont, RULES, measure);
    expect(bundle.families).toEqual({ Geist: '"Geist", "Geist Fallback"' });
    expect(bundle.faces.map((f) => f.family)).toEqual(["Geist", "Geist", "Geist Fallback"]);
  });

  it("keeps the font and characters of text that fades in from opacity 0", () => {
    const d = docWith(text("a", 0, 30, { text: "Ž", style: { ...medium, fontFamily: "Geist Mono" } }));
    const a = d.tracks[1].clips[0];
    a.transform.opacity = 0;
    a.keyframes = { opacity: [{ at: 0, value: 0 }, { at: 10, value: 1 }] };
    expect(probeRequests(d, pageFont).map((r) => r.text)).toEqual([`${PROBE_BASE}Ž`]);
    expect(Object.keys(buildFontBundle(d, pageFont, RULES, measure).families)).toEqual(["Geist Mono"]);
  });

  it("a font the app does not provide travels by name only", () => {
    const inter = { ...medium, fontFamily: "Inter" };
    const bundle = buildFontBundle(docWith(text("a", 0, 30, { style: inter })), pageFont, RULES, measure);
    expect(bundle.families).toEqual({ Inter: '"Inter", sans-serif' });
    expect(bundle.faces).toEqual([]);
    expect(bundle.probes.map((p) => p.font)).toEqual(['500 100px "Inter", sans-serif']);
  });
});

describe("the worker's side", () => {
  it("the worker draws with the page's font strings", () => {
    const workerFont = jobFontResolver(buildFontBundle(doc(), pageFont, RULES, measure).families);
    const fontsSet = (resolveFont: (family: string) => string) => {
      const { ctx, calls } = fakeCtx();
      for (const frame of [0, 30, 60]) drawFrame(ctx, doc(), frame, { resolveFont });
      return calls.filter(([name]) => name === "set font");
    };
    expect(fontsSet(workerFont)).toEqual(fontsSet(pageFont));
    expect(fontsSet(workerFont)).toHaveLength(3);
    expect(workerFont("Inter")).toBe('"Inter", sans-serif');
  });

  it("accepts widths within half a pixel and names the first font that measures differently", () => {
    const { probes } = buildFontBundle(doc(), pageFont, RULES, measure);
    expect(mismatchedProbe(probes, measure)).toBeNull();
    expect(mismatchedProbe(probes, (font, t) => measure(font, t) + 0.4)).toBeNull();
    expect(mismatchedProbe(probes, (font, t) => measure(font, t) * 1.02)?.font).toBe('700 100px "Geist", "Geist Fallback"');
    expect(mismatchedProbe(probes, (font, t) => (font.startsWith("500") ? 0 : measure(font, t)))?.font).toBe('500 100px "Geist", "Geist Fallback"');
  });

  it("allows 0.1% of a wide line, and never less than half a pixel", () => {
    const wide = [{ font: "700 100px a", text: "t", width: 2000 }];
    expect(mismatchedProbe(wide, () => 2001.9)).toBeNull();
    expect(mismatchedProbe(wide, () => 2002.1)).toBe(wide[0]);
    const narrow = [{ font: "700 100px a", text: "t", width: 100 }];
    expect(mismatchedProbe(narrow, () => 99.6)).toBeNull();
    expect(mismatchedProbe(narrow, () => 100.6)).toBe(narrow[0]);
  });
});

describe("caption fonts", () => {
  const captioned = (style: Record<string, unknown> = {}) => {
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [{ id: "c", type: "video", assetId: "a", start: 0, duration: 90, in: 0, speed: 1, volume: 1, transform: { ...text("x", 0, 1).transform }, captions: true } as Clip];
    d.captions = {
      transcripts: { a: [{ t: "żółw", s: 0, e: 400 }, { t: "go", s: 500, e: 900 }] },
      style: { preset: "block", fontFamily: "Geist Mono", fontWeight: 600, fontSize: 60, color: "#ffffff", highlight: "#ffd400", y: 0.8, uppercase: false, ...style },
    };
    return d;
  };

  it("asks for the caption font with the words' characters", () => {
    const requests = probeRequests(captioned(), pageFont);
    expect(requests).toEqual([{ font: '600 100px "Geist Mono", sans-serif', text: `${PROBE_BASE}żółw` }]);
  });

  it("upper-cases the characters when the style does", () => {
    expect(probeRequests(captioned({ uppercase: true }), pageFont)[0].text).toBe(`${PROBE_BASE}ŻÓŁWGO`);
  });

  it("asks the same for an hour of ASCII words as for their first few hundred", () => {
    const vocabulary = ["quick", "jumps", "over", "lazy", "dogs", "WHY?", "yes,", "zap!", "Q&A", "x-ray", "(maybe)", "it's", "#1", "$5", "50%", "@team"];
    const long = (count: number) => {
      const d = captioned();
      d.tracks[0].clips[0].duration = 30 * 3000;
      d.captions!.transcripts = { a: Array.from({ length: count }, (_, i) => ({ t: vocabulary[i % vocabulary.length], s: i * 300, e: i * 300 + 250 })) };
      return d;
    };
    const all = probeRequests(long(9000), pageFont);
    expect(all).toEqual(probeRequests(long(300), pageFont));
    expect(all[0].text).toBe(`${PROBE_BASE}qckjplzydWY?,!Q&Ax-()'#$%@`);
  });

  it("adds nothing when captions are hidden or there are no words, and puts the family in the bundle otherwise", () => {
    const hidden = captioned();
    hidden.tracks.find((t) => t.kind === "caption")!.hidden = true;
    expect(probeRequests(hidden, pageFont)).toEqual([]);
    const empty = captioned();
    empty.captions!.transcripts = { a: [] };
    expect(probeRequests(empty, pageFont)).toEqual([]);
    const bundle = buildFontBundle(captioned(), pageFont, RULES, measure);
    expect(Object.keys(bundle.families)).toEqual(["Geist Mono"]);
    expect(bundle.faces.map((f) => f.family)).toEqual(["Geist Mono"]);
  });
});
