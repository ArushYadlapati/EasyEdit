import { probeRequests, type FontRequest } from "@/lib/export/fonts";
import { exportPlaceholderLabel } from "@/lib/export/media-schedule";
import { jobClips, type ExportMediaPlan } from "@/lib/export/media-sources";
import { fileGone } from "@/lib/export/messages";
import type { ExportSize } from "@/lib/export/presets";
import { activeClips, drawFrame, type Ctx2D, type ResolvedSource } from "@/lib/render/compositor";
import { sourceSeconds } from "@/lib/render/source-time";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";

// One frame of a doc drawn off-screen with real media: the dashboard picture, and Save frame as image.

// One picture the frame needs. fileId: the file to decode, or null to draw the still. stillId: the asset's library
// still, the fallback when the file cannot be read or decoded.
export type FrameSource = { clipId: string; kind: "video" | "image"; fileId: string | null; seconds: number; stillId: string | null };

// The detached canvas the picture is drawn on. quality is for a JPEG; a PNG has none.
export type FrameCanvas = {
  getContext(kind: "2d"): Ctx2D | null;
  toBlob(done: (blob: Blob | null) => void, type: string, quality?: number): void;
};

// What drawing the picture needs from the page: its files, the browser's decoders and fonts, and a canvas.
export type FrameDeps = {
  readFile(fileId: string): Promise<Blob | null>; // null: it could not be read
  // clipId: the clip the picture is drawn for, so its size can be chosen; none for a library still. A rejection whose
  // cause is a file that went away (fileGone) counts as a file that could not be read.
  decodeVideo(blob: Blob, seconds: number, clipId: string): Promise<ResolvedSource | null>;
  decodeImage(blob: Blob, clipId?: string): Promise<ResolvedSource | null>;
  loadFonts(requests: FontRequest[]): Promise<void>;
  resolveFont(family: string): string;
  makeCanvas(width: number, height: number): FrameCanvas;
};

export type FrameRequest = {
  frame: number;
  size: { width: number; height: number }; // the picture's size; the doc is scaled to fill it, as the export worker scales it
  sources: FrameSource[];
  placeholderLabel?: (clip: MediaClip) => string;
  type: "image/jpeg" | "image/png";
  quality?: number; // JPEG only
};

// failed: canvas, no canvas or context, or no picture came out of it; read, a file (and its still) could not be read;
// decode, a picture (and its still) could not be decoded. stopped: isCurrent() turned false partway; nothing more was
// read, drawn or encoded.
export type FrameResult = { kind: "picture"; blob: Blob } | { kind: "failed"; why: "canvas" | "read" | "decode" } | { kind: "stopped" };

const STOPPED = Symbol("stopped");
type SourceFailure = { failed: "read" | "decode" };

// A decode that throws, answers nothing or has no size counts as a failure; "read" when the file went away under it.
async function tryDecode(decode: () => Promise<ResolvedSource | null>, toClose: ResolvedSource[]): Promise<ResolvedSource | null | "read"> {
  let value: ResolvedSource | null;
  try {
    value = await decode();
  } catch (error) {
    return fileGone(error) ? "read" : null;
  }
  if (!value) return null;
  toClose.push(value);
  return value.width > 0 && value.height > 0 ? value : null;
}

// One source's picture: its file, or its still when the file is missing, cannot be read or cannot be decoded. A failure
// names the last step that failed; STOPPED when the render stopped being current before a read or a decode.
async function decodeSource(
  source: FrameSource,
  deps: FrameDeps,
  isCurrent: () => boolean,
  toClose: ResolvedSource[],
): Promise<ResolvedSource | SourceFailure | typeof STOPPED> {
  const { fileId, stillId } = source;
  let failure: SourceFailure = { failed: "read" };
  if (fileId !== null) {
    if (!isCurrent()) return STOPPED;
    const blob = await deps.readFile(fileId);
    if (blob) {
      if (!isCurrent()) return STOPPED;
      const value = await tryDecode(
        () => (source.kind === "video" ? deps.decodeVideo(blob, source.seconds, source.clipId) : deps.decodeImage(blob, source.clipId)),
        toClose,
      );
      if (value && value !== "read") return value;
      failure = { failed: value ?? "decode" };
    }
  }
  if (stillId === null) return failure;
  if (!isCurrent()) return STOPPED;
  const still = await deps.readFile(stillId);
  if (!still) return { failed: "read" };
  if (!isCurrent()) return STOPPED;
  const value = await tryDecode(() => deps.decodeImage(still), toClose);
  return value && value !== "read" ? value : { failed: value ?? "decode" };
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

// Draws one complete frame of the doc off-screen at request.size and encodes it. Nothing is read before the canvas has
// a 2D context. The sources decode one after another while the text's fonts load, and every decoded bitmap is closed on
// every path. isCurrent is asked before each read, each decode, the drawing and the encoding, so a render that has gone
// stale stops at its next step. Rejects when the fonts do not load (Save frame's strict loader), or the drawing throws.
export async function renderFrame(
  doc: TimelineDoc,
  request: FrameRequest,
  deps: FrameDeps,
  isCurrent: () => boolean = () => true,
): Promise<FrameResult> {
  const { width, height } = request.size;
  let canvas: FrameCanvas;
  let ctx: Ctx2D | null;
  try {
    canvas = deps.makeCanvas(width, height);
    ctx = canvas.getContext("2d");
  } catch {
    return { kind: "failed", why: "canvas" };
  }
  if (!ctx) return { kind: "failed", why: "canvas" };

  const toClose: ResolvedSource[] = [];
  try {
    const fontsLoaded = deps.loadFonts(probeRequests(doc, deps.resolveFont));
    fontsLoaded.catch(() => {}); // awaited below once the sources are decoded; not left unhandled meanwhile
    const decoded = new Map<string, ResolvedSource>();
    for (const source of request.sources) {
      const value = await decodeSource(source, deps, isCurrent, toClose);
      if (value === STOPPED) return { kind: "stopped" };
      if ("failed" in value) return { kind: "failed", why: value.failed };
      decoded.set(source.clipId, value);
    }
    await fontsLoaded;
    if (!isCurrent()) return { kind: "stopped" };
    // Each axis on its own, as the export worker scales, so a saved frame and the video agree to the pixel.
    ctx.setTransform(width / doc.width, 0, 0, height / doc.height, 0, 0);
    drawFrame(ctx, doc, request.frame, {
      resolveFont: deps.resolveFont,
      placeholderLabel: request.placeholderLabel,
      resolveSource: (clip) => decoded.get(clip.id) ?? null,
    });
  } finally {
    for (const value of toClose) closeImage(value);
  }

  if (!isCurrent()) return { kind: "stopped" };
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, request.type, request.quality));
  if (!blob || blob.size === 0) return { kind: "failed", why: "canvas" };
  return { kind: "picture", blob };
}

// Save frame: the frame under the playhead at the export's size, as a PNG, drawn from the export's files with the
// export's placeholder rule, never a still. Each video or image clip under the frame that shows and whose plan is use
// is decoded at its moment; every other media clip draws its placeholder.
export function saveFrameRequest(doc: TimelineDoc, frame: number, size: ExportSize, plan: ExportMediaPlan): FrameRequest {
  const sources: FrameSource[] = [];
  for (const { clip } of activeClips(doc, frame)) {
    if (clip.type !== "video" && clip.type !== "image") continue;
    if (clip.transform.opacity <= 0) continue;
    const media = plan.clips[clip.id];
    if (media?.kind !== "use") continue;
    sources.push({ clipId: clip.id, kind: clip.type, fileId: media.fileId, seconds: sourceSeconds(clip, frame, doc.fps), stillId: null });
  }
  return {
    frame,
    size: { width: size.width, height: size.height },
    sources,
    placeholderLabel: exportPlaceholderLabel(jobClips(plan)),
    type: "image/png",
  };
}
