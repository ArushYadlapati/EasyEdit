import { describe as suite, expect, it } from "vitest";
import { DEFAULT_TRANSFORM, describe, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";

const clip = (extra: Partial<MediaClip> = {}): MediaClip =>
  ({ id: "c1", type: "video", assetId: "a1", start: 0, duration: 300, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, ...extra }) as MediaClip;

// Two lines: a pause longer than 600 ms splits "hello there." from "second one".
const WORDS = [
  { t: "hello", s: 0, e: 400 },
  { t: "there.", s: 450, e: 900 },
  { t: "second", s: 3000, e: 3400 },
  { t: "one", s: 3450, e: 3800 },
];

function docWith(over: Partial<TimelineDoc> = {}, captions = true): TimelineDoc {
  const doc = docWithCaptions("short_9x16");
  doc.tracks[0].clips = [clip({ ...(captions ? { captions: true } : {}) })];
  return { ...doc, ...over };
}

const STYLE = { preset: "block", fontFamily: "Inter", fontWeight: 800, fontSize: 70, color: "#ffffff", highlight: "#FFD400", y: 0.7, uppercase: true } as const;

suite("describe: captions", () => {
  it("says nothing about captions in a project that never used them", () => {
    const text = describe(docWith({}, false));
    expect(text).not.toContain("Captions:");
    expect(text).not.toContain("captions=on");
    expect(text).toContain('Track cap [caption] "Captions"\n  (empty)');
  });

  it("shows the stored style after the Guides line", () => {
    const text = describe(docWith({ captions: { style: STYLE }, guides: [{ id: "g1", axis: "x", at: 0.5 }] }));
    const lines = text.split("\n");
    const guides = lines.findIndex((l) => l.startsWith("Guides:"));
    expect(lines[guides + 1]).toBe('Captions: block font="Inter" size=70 weight=800 color=#ffffff highlight=#FFD400 y=0.7 uppercase');
  });

  it("shows the default style, without uppercase, once a transcript exists", () => {
    const text = describe(docWith({ captions: { transcripts: { a1: WORDS } } }));
    expect(text).toMatch(/\nCaptions: karaoke font="Geist" size=70 weight=700 color=#ffffff highlight=#FFD400 y=\S+\n/);
    expect(text).not.toContain("uppercase");
  });

  it("marks media clips that have captions on, in short and detail", () => {
    const doc = docWith({ captions: { transcripts: { a1: WORDS } } });
    expect(describe(doc).split("\n").find((l) => l.includes("c1  video"))).toContain(" captions=on");
    expect(describe(doc, { detail: true }).split("\n").find((l) => l.includes("c1  video"))).toContain(" captions=on");
  });

  it("lists one line per cue in detail", () => {
    const text = describe(docWith({ captions: { transcripts: { a1: WORDS } } }), { detail: true });
    const track = text.split("\n").slice(text.split("\n").findIndex((l) => l.startsWith("Track cap")));
    expect(track[1]).toBe('  0.00–1.30s  "hello there."  clip=c1 asset="a1" words=0-1');
    expect(track[2]).toBe('  3.00–4.20s  "second one"  clip=c1 asset="a1" words=2-3');
  });

  it("counts the lines in short mode", () => {
    const text = describe(docWith({ captions: { transcripts: { a1: WORDS } } }));
    expect(text).toContain('Track cap [caption] "Captions"\n  (2 caption lines)');
  });

  it("is (empty) when captions are on but the file has no words", () => {
    expect(describe(docWith({ captions: { style: STYLE } }))).toContain('Track cap [caption] "Captions"\n  (empty)');
  });
});
