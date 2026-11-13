import { LIMITS } from "@/lib/limits";
import { PresetId } from "./types";
import type { Clip, Crop, FormatId, FrameSize, SafeArea, TimelineDoc, Track, TrackKind, Transform } from "./types";

export const FORMAT_PRESETS: Record<PresetId, { width: number; height: number; label: string }> = {
  short_9x16: { width: 1080, height: 1920, label: "Short 9:16" },
  feed_4x5: { width: 1080, height: 1350, label: "Feed 4:5" },
  square_1x1: { width: 1080, height: 1080, label: "Square 1:1" },
  long_16x9: { width: 1920, height: 1080, label: "Long 16:9" },
  long_4k: { width: 3840, height: 2160, label: "Long 4K" },
};

export function isPresetId(format: string): format is PresetId {
  return Object.hasOwn(FORMAT_PRESETS, format);
}

function isFrameSide(side: number): boolean {
  return Number.isInteger(side) && side % 2 === 0 && side >= LIMITS.frameSideMin && side <= LIMITS.frameSideMax;
}

// A custom size: whole, even pixels a side within the limits, and no larger in area than 4K.
export function isFrameSize(width: number, height: number): boolean {
  return isFrameSide(width) && isFrameSide(height) && width * height <= LIMITS.frameAreaMax;
}

const { width: width4k, height: height4k } = FORMAT_PRESETS.long_4k; // frameAreaMax is this area
export const FRAME_SIZE_MESSAGE = `Width and height go from ${LIMITS.frameSideMin} to ${LIMITS.frameSideMax} pixels, up to the area of 4K (${width4k} × ${height4k}).`;
export const CUSTOM_SIZE_ONLY = "Give a width and height only with the custom format.";

// The named size with exactly this width and height, or "custom".
export function formatFor(width: number, height: number): FormatId {
  return PresetId.options.find((id) => FORMAT_PRESETS[id].width === width && FORMAT_PRESETS[id].height === height) ?? "custom";
}

export function formatFields(size: FrameSize): { format: PresetId } | { format: "custom"; width: number; height: number } {
  const format = formatFor(size.width, size.height);
  return format === "custom" ? { format, width: size.width, height: size.height } : { format };
}

// "Short 9:16" for a named size, "Custom 816 × 1056" for a custom one, and "Custom size" when only the id is known.
export function formatLabel(of: { format: FormatId; width?: number; height?: number }): string {
  if (isPresetId(of.format)) return FORMAT_PRESETS[of.format].label;
  return of.width !== undefined && of.height !== undefined ? `Custom ${of.width} × ${of.height}` : "Custom size";
}

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
  custom: { top: 0.05, width: 0.9, height: 0.9 }, // one size for every custom-sized project
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

// A named format takes its own size, and a size given with it is ignored; a custom one takes the size given. The
// size is not checked against the limits here: callers check it.
function frameOf(format: FormatId, size: FrameSize | undefined): FrameSize {
  if (isPresetId(format)) return FORMAT_PRESETS[format];
  if (!size) throw new Error("A custom format needs a width and height");
  return size;
}

export function createEmptyDoc(format: FormatId, size?: FrameSize): TimelineDoc {
  const { width, height } = frameOf(format, size);
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
