import { LIMITS } from "@/lib/limits";

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

// The video track for a size, or null when no level fits it. The level stays the lowest that fits,
// and the bitrate is held under that level's cap.
export function videoSettings(size: ExportSize, fps: number): VideoSettings | null {
  const level = avcLevel(size, fps);
  if (!level) return null;
  return {
    width: size.width,
    height: size.height,
    fps,
    codec: `avc1.6400${level.hex}`,
    bitrate: Math.min(videoBitrate(size), level.maxBitrate),
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
  avc: { format: "avc" };
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
    avc: { format: "avc" },
  };
}

// AAC-LC, stereo, 48 kHz.
export const AUDIO = { codec: "mp4a.40.2", sampleRate: 48_000, channels: 2, bitrate: 128_000 } as const;

export const KEYFRAME_SECONDS = 2;
