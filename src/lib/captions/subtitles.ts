import type { BrandFonts } from "@/lib/brand/types";
import { LIMITS } from "@/lib/limits";
import { isStorableText } from "@/lib/text";
import type { CaptionWord, MediaClip, OpInput, TimelineDoc } from "@/lib/timeline";
import { captionOps } from "./actions";
import type { Cue } from "./cues";

// Captions as subtitle files, both ways: the project's lines written out as .srt or .vtt on the project's own clock,
// to post beside the exported video, and an .srt or .vtt read in as the words of one clip's file.

export type SubtitleFormat = "srt" | "vtt";

// One line of a subtitle file: when it shows, in milliseconds, and what it says.
export type Subtitle = { from: number; to: number; text: string };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

// 3 723 004 ms as 01:02:03,004 (srt) or 01:02:03.004 (vtt).
export function subtitleTime(ms: number, format: SubtitleFormat): string {
  const whole = Math.max(0, Math.round(ms));
  const clock = `${pad(Math.floor(whole / 3_600_000))}:${pad(Math.floor(whole / 60_000) % 60)}:${pad(Math.floor(whole / 1000) % 60)}`;
  return `${clock}${format === "srt" ? "," : "."}${pad(whole % 1000, 3)}`;
}

// The project's caption lines as a subtitle file's text.
export function subtitlesText(cues: readonly Cue[], fps: number, format: SubtitleFormat): string {
  const ms = (frame: number) => (frame * 1000) / fps;
  const blocks = cues.map((cue, i) => {
    const times = `${subtitleTime(ms(cue.start), format)} --> ${subtitleTime(ms(cue.end), format)}`;
    return format === "srt" ? `${i + 1}\n${times}\n${cue.text}` : `${times}\n${cue.text}`;
  });
  return `${format === "vtt" ? "WEBVTT\n\n" : ""}${blocks.join("\n\n")}\n`;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const SPAN = new RegExp(`${TIME.source}\\s*-->\\s*${TIME.source}`);

function millis(hours: string | undefined, minutes: string, seconds: string, fraction: string): number {
  return Number(hours ?? 0) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(fraction.padEnd(3, "0"));
}

// The lines of an .srt or .vtt file, in the order written. Tags (<i>, <b>, {\an8}) are taken off; a block with no time
// line, no text or an end before its start is left out. Never throws: text that is no subtitle file gives no lines.
export function parseSubtitles(text: string): Subtitle[] {
  const lines: Subtitle[] = [];
  for (const block of text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const rows = block.split("\n");
    const at = rows.findIndex((row) => SPAN.test(row));
    if (at === -1) continue;
    const m = SPAN.exec(rows[at])!;
    const from = millis(m[1], m[2], m[3], m[4]);
    const to = millis(m[5], m[6], m[7], m[8]);
    const said = rows
      .slice(at + 1)
      .join(" ")
      .replace(/<[^>]*>|\{\\[^}]*\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (said && to > from) lines.push({ from, to, text: said });
  }
  return lines;
}

// A subtitle file's lines as the words of one clip's file. The file's clock is taken as the project's, so each line
// is placed where the clip plays at that moment; lines outside the clip are left out. A line's words share its time
// evenly, since the file says when a line shows and not when each word is said.
export function subtitleWords(clip: MediaClip, subtitles: readonly Subtitle[], fps: number): CaptionWord[] {
  if (clip.speed <= 0) return [];
  const clipFrom = (clip.start * 1000) / fps;
  const clipTo = ((clip.start + clip.duration) * 1000) / fps;
  // A moment of the project, in ms, as a moment of the clip's file.
  const inFile = (ms: number) => (clip.in * 1000) / fps + (ms - clipFrom) * clip.speed;
  const words: CaptionWord[] = [];
  for (const line of [...subtitles].sort((a, b) => a.from - b.from)) {
    const from = Math.max(line.from, clipFrom);
    const to = Math.min(line.to, clipTo);
    if (to <= from) continue;
    const said = line.text.split(" ").filter((word) => word.length > 0 && isStorableText(word));
    const each = (inFile(to) - inFile(from)) / Math.max(1, said.length);
    said.forEach((word, i) => {
      const s = Math.round(inFile(from) + each * i);
      const last = words.at(-1);
      // Words stay in time order, each no longer than a word may be.
      const start = last ? Math.max(s, last.s) : s;
      words.push({ t: word.slice(0, LIMITS.captionWordChars), s: start, e: Math.max(start, Math.round(inFile(from) + each * (i + 1))) });
    });
  }
  return words.slice(0, LIMITS.captionWordsPerFile);
}

// The edit that gives a clip a subtitle file's words as its captions, replacing its file's words. [] when the file
// has no line the clip plays.
export function importSubtitleOps(doc: TimelineDoc, clip: MediaClip, subtitles: readonly Subtitle[], fonts: BrandFonts): OpInput[] {
  const words = subtitleWords(clip, subtitles, doc.fps);
  return words.length === 0 ? [] : captionOps(doc, { assetId: clip.assetId, words, clipIds: [clip.id], fonts });
}
