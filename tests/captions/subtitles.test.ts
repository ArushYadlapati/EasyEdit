import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/types";
import { docCues } from "@/lib/captions/cues";
import { importSubtitleOps, parseSubtitles, subtitleTime, subtitleWords, subtitlesText } from "@/lib/captions/subtitles";
import { findClip } from "@/lib/editor/store";
import { applyOps, prepareOps, type MediaClip } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";

const SRT = `1
00:00:01,000 --> 00:00:02,000
Hello <i>there</i>

2
00:00:02,500 --> 00:00:04,000
second
line of it
`;

describe("writing subtitle files", () => {
  it("writes times as each format wants them", () => {
    expect(subtitleTime(3_723_004, "srt")).toBe("01:02:03,004");
    expect(subtitleTime(3_723_004, "vtt")).toBe("01:02:03.004");
    expect(subtitleTime(0, "srt")).toBe("00:00:00,000");
    expect(subtitleTime(-5, "vtt")).toBe("00:00:00.000");
  });

  it("numbers the lines of an .srt and heads a .vtt", () => {
    const cues = [
      { clipId: "c", assetId: "a", start: 30, end: 60, words: [], text: "Hello there" },
      { clipId: "c", assetId: "a", start: 75, end: 120, words: [], text: "second line" },
    ];
    expect(subtitlesText(cues, 30, "srt")).toBe("1\n00:00:01,000 --> 00:00:02,000\nHello there\n\n2\n00:00:02,500 --> 00:00:04,000\nsecond line\n");
    expect(subtitlesText(cues, 30, "vtt")).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello there\n\n00:00:02.500 --> 00:00:04.000\nsecond line\n");
    expect(subtitlesText([], 30, "vtt")).toBe("WEBVTT\n\n\n");
  });
});

describe("reading subtitle files", () => {
  it("reads an .srt: times, text on several rows, tags taken off", () => {
    expect(parseSubtitles(SRT)).toEqual([
      { from: 1000, to: 2000, text: "Hello there" },
      { from: 2500, to: 4000, text: "second line of it" },
    ]);
  });

  it("reads a .vtt, with its header, cue names, short times and Windows line ends", () => {
    const vtt = "﻿WEBVTT\r\n\r\nintro\r\n00:01.500 --> 00:03.000 align:start\r\nHi\r\n\r\n1:00:00.000 --> 1:00:01.5\r\nLate\r\n";
    expect(parseSubtitles(vtt)).toEqual([
      { from: 1500, to: 3000, text: "Hi" },
      { from: 3_600_000, to: 3_601_500, text: "Late" },
    ]);
  });

  it("leaves out what is no line, and reads nothing from a file that is no subtitle file", () => {
    expect(parseSubtitles("1\n00:00:02,000 --> 00:00:01,000\nbackwards\n\n2\n00:00:03,000 --> 00:00:04,000\n\n\njust words")).toEqual([]);
    expect(parseSubtitles("")).toEqual([]);
    expect(parseSubtitles("{\\an8}")).toEqual([]);
  });

  it("survives writing and reading back", () => {
    const cues = [{ clipId: "c", assetId: "a", start: 30, end: 60, words: [], text: "Hello there" }];
    for (const format of ["srt", "vtt"] as const) {
      expect(parseSubtitles(subtitlesText(cues, 30, format))).toEqual([{ from: 1000, to: 2000, text: "Hello there" }]);
    }
  });
});

describe("a subtitle file as a clip's captions", () => {
  const clip = (extra: Record<string, unknown> = {}) => video("c1", 0, 150, extra) as MediaClip;

  it("places each line where the clip plays at that moment, its words sharing the line's time", () => {
    expect(subtitleWords(clip(), parseSubtitles(SRT), 30)).toEqual([
      { t: "Hello", s: 1000, e: 1500 }, { t: "there", s: 1500, e: 2000 },
      { t: "second", s: 2500, e: 2875 }, { t: "line", s: 2875, e: 3250 }, { t: "of", s: 3250, e: 3625 }, { t: "it", s: 3625, e: 4000 },
    ]);
  });

  it("follows the clip's place, in point and speed", () => {
    // The clip starts one second in, from two seconds into its file, at twice the speed.
    const words = subtitleWords(clip({ start: 30, in: 60, speed: 2, duration: 60 }), [{ from: 1000, to: 2000, text: "Hi you" }], 30);
    expect(words).toEqual([{ t: "Hi", s: 2000, e: 3000 }, { t: "you", s: 3000, e: 4000 }]);
  });

  it("leaves out lines the clip does not play, and cuts one that runs past it", () => {
    const short = clip({ duration: 45 }); // plays to 1.5 s
    expect(subtitleWords(short, parseSubtitles(SRT), 30)).toEqual([{ t: "Hello", s: 1000, e: 1250 }, { t: "there", s: 1250, e: 1500 }]);
    expect(subtitleWords(clip({ start: 300 }), parseSubtitles(SRT), 30)).toEqual([]);
    expect(subtitleWords(clip({ speed: -1, in: 149 }), parseSubtitles(SRT), 30)).toEqual([]);
  });

  it("becomes the clip's captions in one edit, and nothing when no line falls on it", () => {
    const doc = sampleDoc();
    doc.tracks[0].clips = [clip()];
    const ops = importSubtitleOps(doc, findClip(doc, "c1")!.clip as MediaClip, parseSubtitles(SRT), DEFAULT_BRAND_KIT.fonts);
    const after = applyOps(doc, prepareOps(ops, () => "g")).doc;
    expect((findClip(after, "c1")!.clip as MediaClip).captions).toBe(true);
    expect(docCues(after).map((cue) => cue.text).join(" ")).toBe("Hello there second line of it");
    expect(importSubtitleOps(doc, findClip(doc, "c1")!.clip as MediaClip, [{ from: 900_000, to: 901_000, text: "late" }], DEFAULT_BRAND_KIT.fonts)).toEqual([]);
  });
});
