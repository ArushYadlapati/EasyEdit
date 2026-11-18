import { LIMITS } from "@/lib/limits";
import { graphemes } from "@/lib/text";
import { safeAreaOf } from "./presets";
import type { CaptionStyle, CaptionWord, TimelineDoc, Track } from "./types";

// The look a project gets before anyone changes it: big white words, the spoken one in yellow, low in the safe area.
export function defaultCaptionStyle(doc: TimelineDoc): CaptionStyle {
  const safe = safeAreaOf(doc);
  return {
    preset: "karaoke",
    fontFamily: "Geist",
    fontWeight: 700,
    fontSize: Math.round(doc.width * 0.065),
    color: "#ffffff",
    highlight: "#FFD400",
    y: Math.round((safe.top + safe.height * 0.82) * 1000) / 1000,
    uppercase: false,
  };
}

// The stored style, else the default.
export function captionStyleOf(doc: TimelineDoc): CaptionStyle {
  return doc.captions?.style ?? defaultCaptionStyle(doc);
}

export function transcriptOf(doc: TimelineDoc, assetId: string): CaptionWord[] | undefined {
  return doc.captions?.transcripts?.[assetId];
}

// A project has at most one caption track.
export function captionTrack(doc: TimelineDoc): Track | undefined {
  return doc.tracks.find((t) => t.kind === "caption");
}

// A word cut to the most the document allows, in graphemes and in the UTF-16 units zod counts, never mid-character.
function cutWord(text: string): string {
  const parts = graphemes(text);
  let out = "";
  let count = 0;
  for (const part of parts) {
    if (count + 1 > LIMITS.captionWordChars || out.length + part.length > LIMITS.captionWordChars) break;
    out += part;
    count++;
  }
  return out;
}

// A run of words said again as typed text. Same count: each word keeps its times. Otherwise the run's whole span is
// shared out by how long each new word is, so the times stay inside the old ones and in order. No words: the run goes.
export function rewordRun(old: readonly CaptionWord[], text: string): CaptionWord[] {
  const next = text.split(/\s+/).filter(Boolean).map(cutWord).filter(Boolean);
  if (next.length === 0 || old.length === 0) return [];
  if (next.length === old.length) return next.map((t, i) => ({ t, s: old[i].s, e: old[i].e }));

  const from = old[0].s;
  const to = old[old.length - 1].e;
  const span = to - from;
  const weights = next.map((t) => graphemes(t).length);
  const total = weights.reduce((a, b) => a + b, 0);
  // Boundaries between words, rounded to whole milliseconds. Where the span is long enough, each word gets at least
  // one: a boundary is at least one past the last and leaves room for the words still to come.
  const bounds = [from];
  let sum = 0;
  for (let k = 1; k < next.length; k++) {
    sum += weights[k - 1];
    let at = from + Math.round((span * sum) / total);
    if (span >= next.length) at = Math.min(Math.max(at, bounds[k - 1] + 1), to - (next.length - k));
    bounds.push(at);
  }
  bounds.push(to);
  return next.map((t, i) => ({ t, s: bounds[i], e: bounds[i + 1] }));
}
