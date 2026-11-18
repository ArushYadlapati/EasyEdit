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
