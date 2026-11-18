import { describe, expect, it, vi } from "vitest";
import { makeFontResolver } from "@/lib/editor/fonts";
import { PROBE_BASE, probeRequests } from "@/lib/export/fonts";
import * as text from "@/lib/text";
import type { CaptionWord, Clip, TimelineDoc } from "@/lib/timeline";
import { DEFAULT_TRANSFORM } from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";

// The font requests are worked out on every change of the shown document, so they must not walk every caption word
// through the grapheme segmenter. This file counts the segmenter's calls.
vi.mock("@/lib/text", async (original) => {
  const actual = await original<typeof import("@/lib/text")>();
  return { ...actual, graphemes: vi.fn(actual.graphemes) };
});

const pageFont = makeFontResolver((name) => (name === "--font-geist-sans" ? '"Geist", "Geist Fallback"' : ""));

function captioned(words: CaptionWord[]): TimelineDoc {
  const d = docWithCaptions("short_9x16");
  d.tracks[0].clips = [{ id: "c", type: "video", assetId: "a", start: 0, duration: 30 * 3000, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, captions: true } as Clip];
  d.captions = { transcripts: { a: words } };
  return d;
}

const many = (count: number, wordAt: (i: number) => string) => Array.from({ length: count }, (_, i) => ({ t: wordAt(i), s: i * 300, e: i * 300 + 250 }));

describe("the cost of caption font requests", () => {
  it("never runs the segmenter over plain ASCII words", () => {
    const doc = captioned(many(9000, (i) => ["hello", "world!", "Q&A"][i % 3]));
    vi.mocked(text.graphemes).mockClear();
    const [request] = probeRequests(doc, pageFont);
    expect(request.text).toBe(`${PROBE_BASE}hlwd!Q&A`);
    // Only the base line is segmented.
    expect(vi.mocked(text.graphemes).mock.calls.map(([s]) => s)).toEqual([PROBE_BASE]);
  });

  it("stops looking at words once 256 extra characters are collected", () => {
    // Each word brings one new character, from a run of 300 letters past ASCII, then many more words follow.
    const doc = captioned(many(9000, (i) => `é${String.fromCodePoint(0x4e00 + (i % 300))}`));
    vi.mocked(text.graphemes).mockClear();
    const [request] = probeRequests(doc, pageFont);
    expect([...text.graphemes(request.text)].length - [...text.graphemes(PROBE_BASE)].length).toBe(256);
    expect(vi.mocked(text.graphemes).mock.calls.length).toBeLessThan(300);
  });
});
