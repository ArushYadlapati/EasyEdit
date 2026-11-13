import type { Clip, Crop, MediaClip, TextClip, TimelineDoc, Track } from "@/lib/timeline";
import { isCropped } from "@/lib/timeline/presets";
import { layoutText, textRect, type LocalRect } from "./text-layout";

export type { LocalRect };

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ResolvedSource = { image: CanvasImageSource; width: number; height: number };
export type DrawOptions = {
  // The seam where media plugs in. clip: the video or image clip being drawn. frame: the timeline frame being drawn.
  resolveSource?: (clip: MediaClip, frame: number) => ResolvedSource | null;
  // What a clip with no picture says in its placeholder. Default: "Video" or "Image".
  placeholderLabel?: (clip: MediaClip) => string;
  resolveFont?: (family: string) => string; // a document font name to a CSS font-family list
};

// Repeats the --ed-clip-video and --ed-clip-image colors from src/app/globals.css, because a worker cannot read CSS variables.
export const PLACEHOLDER_FILL = { video: "#2c3d5c", image: "#3b3160" } as const;

export function defaultResolveFont(family: string): string {
  return `"${family}", sans-serif`;
}

export function activeClips(doc: TimelineDoc, frame: number): { track: Track; clip: Clip }[] {
  const active: { track: Track; clip: Clip }[] = [];
  for (const track of doc.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.type === "audio") continue;
      if (clip.start <= frame && frame < clip.start + clip.duration) active.push({ track, clip });
    }
  }
  return active;
}

export function fitRect(srcW: number, srcH: number, dstW: number, dstH: number, fit: "cover" | "contain"): { width: number; height: number } {
  const ratio = fit === "cover" ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  return { width: srcW * ratio, height: srcH * ratio };
}

// The size a video or image is drawn at before scale and rotation: fitted to the frame, or the whole frame for a placeholder.
export function mediaSize(
  doc: { width: number; height: number },
  clip: MediaClip,
  source: { width: number; height: number } | null,
): { width: number; height: number } {
  if (!hasPicture(source)) return { width: doc.width, height: doc.height };
  return fitRect(source.width, source.height, doc.width, doc.height, clip.transform.fit);
}

// A source with no size (a video before its metadata, or with no video track) draws a placeholder.
function hasPicture<T extends { width: number; height: number }>(source: T | null | undefined): source is T {
  return !!source && source.width > 0 && source.height > 0;
}

// What is left of a box once each side's share of its width or height is cut away.
export function cropRect(rect: LocalRect, crop: Crop | undefined): LocalRect {
  if (!crop) return { ...rect };
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  return { left: rect.left + crop.left * w, top: rect.top + crop.top * h, right: rect.right - crop.right * w, bottom: rect.bottom - crop.bottom * h };
}

const centred = ({ width, height }: { width: number; height: number }): LocalRect => ({ left: -width / 2, top: -height / 2, right: width / 2, bottom: height / 2 });

function drawText(ctx: Ctx2D, doc: TimelineDoc, clip: TextClip, resolveFont: (family: string) => string): void {
  const { fontWeight, fontSize, fontFamily, color, align } = clip.style;
  ctx.font = `${fontWeight} ${fontSize}px ${resolveFont(fontFamily)}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const measure = (s: string) => ctx.measureText(s).width;
  const crop = clip.transform.crop;
  if (crop && isCropped(crop)) {
    const k = cropRect(textRect(clip, doc.width, measure), crop);
    // An uncut side moves out by the font size, so glyphs wider than their measured advance are not shaved.
    if (crop.left === 0) k.left -= fontSize;
    if (crop.top === 0) k.top -= fontSize;
    if (crop.right === 0) k.right += fontSize;
    if (crop.bottom === 0) k.bottom += fontSize;
    ctx.beginPath();
    ctx.rect(k.left, k.top, k.right - k.left, k.bottom - k.top);
    ctx.clip();
  }
  for (const line of layoutText(clip, doc.width, measure)) ctx.fillText(line.text, line.x, line.y);
}

function drawMedia(ctx: Ctx2D, doc: TimelineDoc, clip: MediaClip & { type: "video" | "image" }, frame: number, options: DrawOptions): void {
  const source = options.resolveSource?.(clip, frame) ?? null;
  const size = mediaSize(doc, clip, source);
  const crop = clip.transform.crop;
  const k = cropRect(centred(size), crop);
  if (hasPicture(source)) {
    if (!crop || !isCropped(crop)) {
      ctx.drawImage(source.image, -size.width / 2, -size.height / 2, size.width, size.height);
      return;
    }
    const { width: sw, height: sh } = source;
    ctx.drawImage(
      source.image,
      crop.left * sw,
      crop.top * sh,
      sw - crop.left * sw - crop.right * sw,
      sh - crop.top * sh - crop.bottom * sh,
      k.left,
      k.top,
      k.right - k.left,
      k.bottom - k.top,
    );
    return;
  }
  ctx.fillStyle = PLACEHOLDER_FILL[clip.type];
  ctx.fillRect(k.left, k.top, k.right - k.left, k.bottom - k.top);
  ctx.fillStyle = "#ededed";
  ctx.font = `500 ${Math.round(doc.width * 0.04)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(options.placeholderLabel?.(clip) ?? (clip.type === "video" ? "Video" : "Image"), (k.left + k.right) / 2, (k.top + k.bottom) / 2);
}

// Draws in project pixels and never reads the canvas size: a caller that wants a smaller canvas scales the context first.
export function drawFrame(ctx: Ctx2D, doc: TimelineDoc, frame: number, options: DrawOptions = {}): void {
  const resolveFont = options.resolveFont ?? defaultResolveFont;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const { clip } of activeClips(doc, frame)) {
    const t = clip.transform;
    ctx.save();
    ctx.globalAlpha = t.opacity;
    ctx.translate(t.x * doc.width, t.y * doc.height);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.scale, t.scale);
    if (clip.type === "text") drawText(ctx, doc, clip, resolveFont);
    else if (clip.type === "video" || clip.type === "image") drawMedia(ctx, doc, clip as MediaClip & { type: "video" | "image" }, frame, options);
    ctx.restore();
  }
}
