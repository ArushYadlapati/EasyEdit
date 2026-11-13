import type { Clip, Crop, FormatId, SafeArea, TimelineDoc, Track, TrackKind, Transform } from "./types";

export const FORMAT_PRESETS: Record<FormatId, { width: number; height: number; label: string }> = {
  short_9x16: { width: 1080, height: 1920, label: "Short 9:16" },
  feed_4x5: { width: 1080, height: 1350, label: "Feed 4:5" },
  square_1x1: { width: 1080, height: 1080, label: "Square 1:1" },
  long_16x9: { width: 1920, height: 1080, label: "Long 16:9" },
  long_4k: { width: 3840, height: 2160, label: "Long 4K" },
};

export const DEFAULT_FPS = 30;

// Each format's safe area before anyone changes it, as shares of the frame: centred sideways, its top edge at `top`.
// A changed size keeps that top and grows downward. 9:16 follows Meta's published Reels guidance (14% of the top,
// 35% of the bottom and 6% of each side kept clear); it is written for ads, so it errs on the side of room. YouTube
// publishes no Shorts margins. The other formats keep 5% clear on every side.
export const SAFE_AREA_DEFAULTS: Record<FormatId, Readonly<SafeArea & { top: number }>> = {
  short_9x16: { top: 0.14, width: 0.88, height: 0.51 },
  feed_4x5: { top: 0.05, width: 0.9, height: 0.9 },
  square_1x1: { top: 0.05, width: 0.9, height: 0.9 },
  long_16x9: { top: 0.05, width: 0.9, height: 0.9 },
  long_4k: { top: 0.05, width: 0.9, height: 0.9 },
};

// The tallest safe area a format allows: what is left below its top.
export function maxSafeAreaHeight(format: FormatId): number {
  return Number((1 - SAFE_AREA_DEFAULTS[format].top).toFixed(4));
}

// The safe area the project shows now: its own size for its format, or the default.
export function safeAreaOf(doc: Pick<TimelineDoc, "format" | "safeAreas">): SafeArea & { top: number; custom: boolean } {
  const fallback = SAFE_AREA_DEFAULTS[doc.format];
  const own = doc.safeAreas?.[doc.format];
  return own ? { top: fallback.top, width: own.width, height: own.height, custom: true } : { ...fallback, custom: false };
}

export const DEFAULT_TRANSFORM: Readonly<Transform> = Object.freeze({
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  opacity: 1,
  fit: "cover",
});

// Nothing cut. DEFAULT_TRANSFORM has no crop at all, which means the same.
export const NO_CROP: Readonly<Crop> = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

export function isCropped(crop: Crop | undefined): boolean {
  return crop !== undefined && (crop.left > 0 || crop.top > 0 || crop.right > 0 || crop.bottom > 0);
}

// The clip keeps its own shape. DEFAULT_TRANSFORM has no stretch at all, which means the same.
export const NO_STRETCH = 1;

export function stretchOf(t: { stretch?: number }): number {
  return t.stretch ?? NO_STRETCH;
}

export const TRACK_ACCEPTS: Record<TrackKind, Clip["type"][]> = {
  video: ["video", "image"],
  overlay: ["image", "video"],
  text: ["text"],
  caption: [],
  audio: ["audio"],
};

function emptyTrack(id: string, kind: TrackKind, name: string): Track {
  return { id, kind, name, muted: false, hidden: false, locked: false, clips: [] };
}

export function createEmptyDoc(format: FormatId): TimelineDoc {
  const { width, height } = FORMAT_PRESETS[format];
  return {
    schemaVersion: 1,
    format,
    width,
    height,
    fps: DEFAULT_FPS,
    tracks: [
      emptyTrack("v1", "video", "Video 1"),
      emptyTrack("t1", "text", "Text 1"),
      emptyTrack("cap", "caption", "Captions"),
      emptyTrack("a1", "audio", "Audio 1"),
    ],
  };
}

export function docDuration(doc: TimelineDoc): number {
  let end = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration);
    }
  }
  return end;
}
