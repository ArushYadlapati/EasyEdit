import { mediaWants } from "@/lib/editor/media-plan";
import { probeRequests, type FontRequest } from "@/lib/export/fonts";
import type { LibraryState } from "@/lib/media/library-store";
import { playbackFileFor, posterFileFor } from "@/lib/media/playback";
import { activeClips, drawFrame, type Ctx2D, type ResolvedSource } from "@/lib/render/compositor";
import { thumbnailFrame } from "@/lib/render/thumbnail-frame";
import type { TimelineDoc } from "@/lib/timeline";

export const THUMBNAIL_LONG_SIDE = 640;
export const THUMBNAIL_QUALITY = 0.8;
export const THUMBNAIL_SOURCE_MAX_SIDE = 1280; // a picture is decoded no larger than this on its long side

// The picture's size: the project's shape, THUMBNAIL_LONG_SIDE on its long side, so a smaller project is scaled up.
export function thumbnailSize(doc: { width: number; height: number }): { width: number; height: number } {
  const k = THUMBNAIL_LONG_SIDE / Math.max(doc.width, doc.height);
  return { width: Math.max(1, Math.round(doc.width * k)), height: Math.max(1, Math.round(doc.height * k)) };
}

// One picture the frame needs. fileId: the file to decode, or null to draw the still. stillId: the asset's library
// still, the fallback when the file cannot be read or decoded.
export type ThumbnailSource = { clipId: string; kind: "video" | "image"; fileId: string | null; seconds: number; stillId: string | null };
export type ThumbnailPlan =
  | { kind: "draw"; frame: number; sources: ThumbnailSource[] }
  | { kind: "wait" } // shown media is uploading or having its preview made, or the library has not loaded
  | { kind: "skip" }; // shown media was removed or is missing, or has neither a file nor a still

// What drawing the thumbnail needs, settled before anything is read: each picture that shows under its frame, or why it
// cannot be drawn yet (wait) or at all (skip). Every picture is looked at, so a skip anywhere wins over a wait anywhere.
export function planThumbnail(doc: TimelineDoc, library: Pick<LibraryState, "assets" | "loaded">): ThumbnailPlan {
  const frame = thumbnailFrame(doc);
  const seconds = new Map(mediaWants(doc, frame, { playing: false, rate: 1 }).map((want) => [want.clipId, want.seconds]));
  const sources: ThumbnailSource[] = [];
  let wait = false;
  let skip = false;
  for (const { clip } of activeClips(doc, frame)) {
    if (clip.type !== "video" && clip.type !== "image") continue;
    if (clip.transform.opacity === 0) continue; // shows nothing, so it is neither waited for nor a reason to skip
    const asset = library.assets[clip.assetId];
    if (asset === undefined && !library.loaded) {
      wait = true;
      continue;
    }
    const file = playbackFileFor(asset);
    const stillId = posterFileFor(asset);
    if (file.fileId !== null) {
      sources.push({ clipId: clip.id, kind: clip.type, fileId: file.fileId, seconds: seconds.get(clip.id) ?? 0, stillId });
    } else if (file.why === "uploading" || file.why === "preparing") {
      wait = true;
    } else if (file.why === "no-preview" && stillId !== null) {
      sources.push({ clipId: clip.id, kind: clip.type, fileId: null, seconds: seconds.get(clip.id) ?? 0, stillId });
    } else {
      skip = true;
    }
  }
  if (skip) return { kind: "skip" };
  if (wait) return { kind: "wait" };
  return { kind: "draw", frame, sources };
}

// The detached canvas the picture is drawn on.
export type ThumbnailCanvas = {
  getContext(kind: "2d"): Ctx2D | null;
  toBlob(done: (blob: Blob | null) => void, type: string, quality: number): void;
};

// What drawing the picture needs from the page: the library, its files, the browser's decoders and fonts, and a canvas.
export type ThumbnailDeps = {
  library(): Pick<LibraryState, "assets" | "loaded">;
  readFile(fileId: string): Promise<Blob | null>; // null: it could not be read
  decodeVideo(blob: Blob, seconds: number): Promise<ResolvedSource | null>;
  decodeImage(blob: Blob): Promise<ResolvedSource | null>;
  loadFonts(requests: FontRequest[]): Promise<void>;
  resolveFont(family: string): string;
  makeCanvas(width: number, height: number): ThumbnailCanvas;
};

// stopped: isCurrent() turned false partway; nothing more was read, drawn or encoded.
export type ThumbnailResult = { kind: "picture"; jpeg: Blob } | { kind: "wait" } | { kind: "skip" } | { kind: "stopped" };

const STOPPED = Symbol("stopped");

// A decode that throws, answers nothing or has no size counts as a failure.
async function tryDecode(decode: () => Promise<ResolvedSource | null>, toClose: ResolvedSource[]): Promise<ResolvedSource | null> {
  let value: ResolvedSource | null;
  try {
    value = await decode();
  } catch {
    return null;
  }
  if (!value) return null;
  toClose.push(value);
  return value.width > 0 && value.height > 0 ? value : null;
}

// One source's picture: its file, or its still when the file is missing, cannot be read or cannot be decoded. Null when
// the still fails too; STOPPED when the capture stopped being current before a read or a decode.
async function decodeSource(
  source: ThumbnailSource,
  deps: ThumbnailDeps,
  isCurrent: () => boolean,
  toClose: ResolvedSource[],
): Promise<ResolvedSource | null | typeof STOPPED> {
  const { fileId, stillId } = source;
  if (fileId !== null) {
    if (!isCurrent()) return STOPPED;
    const blob = await deps.readFile(fileId);
    if (blob) {
      if (!isCurrent()) return STOPPED;
      const value = await tryDecode(() => (source.kind === "video" ? deps.decodeVideo(blob, source.seconds) : deps.decodeImage(blob)), toClose);
      if (value) return value;
    }
  }
  if (stillId === null) return null;
  if (!isCurrent()) return STOPPED;
  const still = await deps.readFile(stillId);
  if (!still) return null;
  if (!isCurrent()) return STOPPED;
  return tryDecode(() => deps.decodeImage(still), toClose);
}

function closeImage(value: ResolvedSource): void {
  const image = value.image as { close?: unknown };
  if (typeof image.close !== "function") return; // a video decoder's canvas is left to the garbage collector
  try {
    image.close();
  } catch {
    // already closed
  }
}

// Draws one complete frame of the doc, the one planThumbnail names, off-screen, and encodes it as a small JPEG. Nothing
// is read before the canvas has a 2D context. The sources decode one after another while the text's fonts load, and
// every decoded bitmap is closed on every path. isCurrent is asked before each read, each decode, the drawing and the
// encoding, so a capture that has gone stale stops at its next step.
export async function renderThumbnail(doc: TimelineDoc, deps: ThumbnailDeps, isCurrent: () => boolean = () => true): Promise<ThumbnailResult> {
  const plan = planThumbnail(doc, deps.library());
  if (plan.kind !== "draw") return { kind: plan.kind };

  const { width, height } = thumbnailSize(doc);
  let canvas: ThumbnailCanvas;
  let ctx: Ctx2D | null;
  try {
    canvas = deps.makeCanvas(width, height);
    ctx = canvas.getContext("2d");
  } catch {
    return { kind: "skip" };
  }
  if (!ctx) return { kind: "skip" };

  const toClose: ResolvedSource[] = [];
  try {
    const fontsLoaded = deps.loadFonts(probeRequests(doc, deps.resolveFont));
    const decoded = new Map<string, ResolvedSource>();
    for (const source of plan.sources) {
      const value = await decodeSource(source, deps, isCurrent, toClose);
      if (value === STOPPED) return { kind: "stopped" };
      if (value === null) return { kind: "skip" };
      decoded.set(source.clipId, value);
    }
    await fontsLoaded;
    if (!isCurrent()) return { kind: "stopped" };
    const k = THUMBNAIL_LONG_SIDE / Math.max(doc.width, doc.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawFrame(ctx, doc, plan.frame, { resolveFont: deps.resolveFont, resolveSource: (clip) => decoded.get(clip.id) ?? null });
  } finally {
    for (const value of toClose) closeImage(value);
  }

  if (!isCurrent()) return { kind: "stopped" };
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", THUMBNAIL_QUALITY));
  if (!jpeg || jpeg.size === 0) return { kind: "skip" };
  return { kind: "picture", jpeg };
}
