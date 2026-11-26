import { LIMITS } from "@/lib/limits";
import { GIF_FPS, gifSize, gifStep } from "./gif";

// The kinds of file an export makes. picture: it has pictures. sound: it can carry sound. encodes: its pictures go
// through the browser's video encoder (a GIF is written here, with none).
export type ExportFormat = "mp4" | "webm" | "gif" | "m4a" | "wav";
export type FormatFacts = { id: ExportFormat; label: string; extension: string; mime: string; picture: boolean; sound: boolean; encodes: boolean; says: string; saveAs: string };
export const EXPORT_FORMATS: readonly FormatFacts[] = [
  { id: "mp4", label: "MP4 video", extension: "mp4", mime: "video/mp4", picture: true, sound: true, encodes: true, says: "MP4, H.264 video", saveAs: "MP4 video" },
  { id: "webm", label: "WebM video", extension: "webm", mime: "video/webm", picture: true, sound: true, encodes: true, says: "WebM, VP9 video", saveAs: "WebM video" },
  { id: "gif", label: "Animated GIF", extension: "gif", mime: "image/gif", picture: true, sound: false, encodes: false, says: "GIF, no sound, plays over and over", saveAs: "GIF image" },
  { id: "m4a", label: "Sound only (M4A)", extension: "m4a", mime: "audio/mp4", picture: false, sound: true, encodes: false, says: "M4A, AAC sound, no picture", saveAs: "M4A sound" },
  { id: "wav", label: "Sound only (WAV)", extension: "wav", mime: "audio/wav", picture: false, sound: true, encodes: false, says: "WAV, sound as it is mixed, no picture", saveAs: "WAV sound" },
];
export const formatFacts = (id: ExportFormat): FormatFacts => EXPORT_FORMATS.find((f) => f.id === id) ?? EXPORT_FORMATS[0];

export type ExportPresetId = "project" | "1080p" | "draft";
export type ExportSize = { width: number; height: number };
// A box a size must fit inside, either way round: its short side within `short`, its long side within `long`.
export type SizeBox = { short: number; long: number };

export const EXPORT_PRESETS: readonly { id: ExportPresetId; label: string; box: SizeBox | null }[] = [
  { id: "project", label: "Same as project", box: null },
  { id: "1080p", label: "1080p", box: { short: 1080, long: 1920 } },
  { id: "draft", label: "Draft", box: { short: 720, long: 1280 } },
];

const evenSide = (side: number) => Math.round(side / 2) * 2;

// The size a preset exports at: the project's own, or the project scaled down into the preset's box.
// Null when the box would not make it smaller, or would make a side shorter than a frame may be.
export function exportSize(doc: ExportSize, id: ExportPresetId): ExportSize | null {
  const box = EXPORT_PRESETS.find((p) => p.id === id)?.box ?? null;
  const k = box
    ? Math.min(box.short / Math.min(doc.width, doc.height), box.long / Math.max(doc.width, doc.height))
    : 1;
  if (box && k >= 1) return null;
  const size = { width: evenSide(doc.width * k), height: evenSide(doc.height * k) };
  if (size.width < LIMITS.frameSideMin || size.height < LIMITS.frameSideMin) return null;
  return size;
}

export type ExportOption = { id: ExportPresetId; label: string; size: ExportSize };

// The sizes offered for a project, in table order, each labeled with its pixels.
export function exportOptions(doc: ExportSize): ExportOption[] {
  return EXPORT_PRESETS.flatMap((preset) => {
    const size = exportSize(doc, preset.id);
    return size ? [{ id: preset.id, label: `${preset.label} (${size.width} × ${size.height})`, size }] : [];
  });
}

// One row of H.264 Table A-1. maxSideMbs is floor(sqrt(8 × maxFrameMbs)), the limit on each side in
// macroblocks; maxBitrate is the High-profile cap in bits per second.
export type AvcLevel = { level: string; hex: string; maxFrameMbs: number; maxMbsPerSecond: number; maxSideMbs: number; maxBitrate: number };

export const AVC_LEVELS: readonly AvcLevel[] = [
  { level: "3.1", hex: "1f", maxFrameMbs: 3_600, maxMbsPerSecond: 108_000, maxSideMbs: 169, maxBitrate: 17_500_000 },
  { level: "4.0", hex: "28", maxFrameMbs: 8_192, maxMbsPerSecond: 245_760, maxSideMbs: 256, maxBitrate: 25_000_000 },
  { level: "4.2", hex: "2a", maxFrameMbs: 8_704, maxMbsPerSecond: 522_240, maxSideMbs: 263, maxBitrate: 62_500_000 },
  { level: "5.1", hex: "33", maxFrameMbs: 36_864, maxMbsPerSecond: 983_040, maxSideMbs: 543, maxBitrate: 300_000_000 },
  { level: "5.2", hex: "34", maxFrameMbs: 36_864, maxMbsPerSecond: 2_073_600, maxSideMbs: 543, maxBitrate: 300_000_000 },
];

// The lowest level whose frame, rate and side limits all hold the size at this frame rate.
export function avcLevel(size: ExportSize, fps: number): AvcLevel | null {
  const w = Math.ceil(size.width / 16);
  const h = Math.ceil(size.height / 16);
  return (
    AVC_LEVELS.find(
      (l) => w * h <= l.maxFrameMbs && w * h * fps <= l.maxMbsPerSecond && w <= l.maxSideMbs && h <= l.maxSideMbs,
    ) ?? null
  );
}

// High profile at the lowest level that fits.
export function avcCodec(size: ExportSize, fps: number): string | null {
  const level = avcLevel(size, fps);
  return level ? `avc1.6400${level.hex}` : null;
}

// Bits per second by pixel count, before the level's cap.
export function videoBitrate(size: ExportSize): number {
  const pixels = size.width * size.height;
  if (pixels <= 1280 * 720) return 2_500_000;
  if (pixels <= 1920 * 1080) return 8_000_000;
  return 40_000_000;
}

export type VideoSettings = { width: number; height: number; fps: number; codec: string; bitrate: number };

// How many bits the picture gets, against the standard for its size: a smaller file, the standard, or more bits for
// footage with a lot of motion or detail. The size, the frame rate and the format are the same.
export type ExportQuality = "small" | "standard" | "high";
export const EXPORT_QUALITIES: readonly { id: ExportQuality; label: string; factor: number }[] = [
  { id: "small", label: "Smaller file", factor: 0.5 },
  { id: "standard", label: "Standard", factor: 1 },
  { id: "high", label: "High", factor: 1.6 },
];

// One row of the VP9 levels: the most pixels a picture may have, and the most a second.
const VP9_LEVELS: readonly { level: string; maxPicture: number; maxRate: number; maxBitrate: number }[] = [
  { level: "31", maxPicture: 983_040, maxRate: 36_864_000, maxBitrate: 12_000_000 },
  { level: "40", maxPicture: 2_228_224, maxRate: 83_558_400, maxBitrate: 18_000_000 },
  { level: "41", maxPicture: 2_228_224, maxRate: 160_432_128, maxBitrate: 30_000_000 },
  { level: "50", maxPicture: 8_912_896, maxRate: 311_951_360, maxBitrate: 60_000_000 },
  { level: "51", maxPicture: 8_912_896, maxRate: 588_251_136, maxBitrate: 120_000_000 },
  { level: "52", maxPicture: 8_912_896, maxRate: 1_176_502_272, maxBitrate: 180_000_000 },
];

// VP9, profile 0, eight bits, at the lowest level that holds the size at this frame rate.
export function vp9Codec(size: ExportSize, fps: number): string | null {
  const pixels = size.width * size.height;
  const level = VP9_LEVELS.find((l) => pixels <= l.maxPicture && pixels * fps <= l.maxRate);
  return level ? `vp09.00.${level.level}.08` : null;
}

// What a GIF's bytes come to at most, as bits a second: a byte a pixel for every frame it draws. Most come out at a
// fraction of that.
const gifBitrate = (size: ExportSize, fps: number) => Math.round(size.width * size.height * 8 * Math.min(fps, fps / gifStep(fps)));

// The picture for a size in a format, or null when the format cannot hold it. For a video the level stays the lowest
// that fits and the bitrate is held under that level's cap; a GIF is made smaller and slower (gif.ts); a file with
// sound only keeps the size and frame rate, which time its sound, and has no picture bits.
export function videoSettings(size: ExportSize, fps: number, quality: ExportQuality = "standard", format: ExportFormat = "mp4"): VideoSettings | null {
  const factor = EXPORT_QUALITIES.find((q) => q.id === quality)?.factor ?? 1;
  if (format === "gif") {
    const small = gifSize(size);
    return { ...small, fps, codec: "gif", bitrate: gifBitrate(small, fps) };
  }
  if (format === "m4a" || format === "wav") return { width: size.width, height: size.height, fps, codec: "none", bitrate: 0 };
  if (format === "webm") {
    const codec = vp9Codec(size, fps);
    const cap = VP9_LEVELS.find((l) => codec?.includes(`.${l.level}.`))?.maxBitrate ?? 0;
    return codec ? { width: size.width, height: size.height, fps, codec, bitrate: Math.min(Math.round(videoBitrate(size) * factor), cap) } : null;
  }
  const level = avcLevel(size, fps);
  if (!level) return null;
  return {
    width: size.width,
    height: size.height,
    fps,
    codec: `avc1.6400${level.hex}`,
    bitrate: Math.min(Math.round(videoBitrate(size) * factor), level.maxBitrate),
  };
}

// The encoder is tried with the browser's choice first, then once more in software.
export const ACCELERATION_ORDER = ["no-preference", "prefer-software"] as const;
export type Acceleration = (typeof ACCELERATION_ORDER)[number];

export type EncoderConfig = {
  codec: string;
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  hardwareAcceleration: Acceleration;
  latencyMode: "quality";
  avc?: { format: "avc" }; // H.264 only: its frames are asked for in the form an MP4 holds
};

// What the encoder is asked whether it supports, on the page and in the worker alike.
export function encoderConfig(video: VideoSettings, acceleration: Acceleration): EncoderConfig {
  return {
    codec: video.codec,
    width: video.width,
    height: video.height,
    bitrate: video.bitrate,
    framerate: video.fps,
    hardwareAcceleration: acceleration,
    latencyMode: "quality",
    ...(video.codec.startsWith("avc1") ? { avc: { format: "avc" as const } } : {}),
  };
}

// AAC-LC, stereo, 48 kHz.
export const AUDIO = { codec: "mp4a.40.2", sampleRate: 48_000, channels: 2, bitrate: 128_000 } as const;

// The sound a format carries: AAC in an MP4 or M4A, Opus in a WebM, the mix itself (16 bits a sample) in a WAV, and
// none in a GIF. Always stereo at 48 kHz.
export type SoundCodec = "aac" | "opus" | "pcm";
export function soundCodec(format: ExportFormat): SoundCodec | null {
  if (format === "gif") return null;
  return format === "webm" ? "opus" : format === "wav" ? "pcm" : "aac";
}
// Bits a second of sound in a file of this format.
export function soundBitrate(format: ExportFormat): number {
  const codec = soundCodec(format);
  return codec === null ? 0 : codec === "pcm" ? AUDIO.sampleRate * AUDIO.channels * 16 : AUDIO.bitrate;
}
// How many frames a second a file of this format shows: a GIF draws every few frames of the project.
export function shownFps(format: ExportFormat, fps: number): number {
  return format === "gif" ? fps / gifStep(fps) : fps;
}
export { GIF_FPS };

export const KEYFRAME_SECONDS = 2;
