import { renderFrame, saveFrameRequest, type FrameCanvas, type FrameResult } from "@/lib/editor/frame-render";
import type { FontRequest } from "@/lib/export/fonts";
import { refuseWaiting, type ExportMediaDeps } from "@/lib/export/gather-media";
import { exportAssetIds, planExportMedia } from "@/lib/export/media-sources";
import { ExportError, failureOf } from "@/lib/export/messages";
import { clipSizes } from "@/lib/export/needed-size";
import type { ExportFailure } from "@/lib/export/protocol";
import type { ResolvedSource } from "@/lib/render/compositor";
import { noLargerThan, type SizeRule } from "@/lib/render/decode-image";
import { decodeImage, decodeVideoFrame } from "../media/frame-decode";
import { loadFontsStrict, pageFontResolver } from "../page-fonts";
import type { ExportDeps } from "./deps";
import { downloadBlob } from "./download";

// Save frame as image: one frame of the project drawn on the page as a PNG at the export's size, from the files the
// export reads and with its placeholder rule, by the renderer that draws the dashboard picture. It is also the
// reference the check script compares the video against.

// What saving a frame needs from the browser, so tests can pass fakes.
export type SaveFrameIO = {
  decodeVideoFrame(blob: Blob, seconds: number, size: SizeRule): Promise<ResolvedSource | null>;
  decodeImage(blob: Blob, size: SizeRule): Promise<{ image: ImageBitmap; width: number; height: number }>;
  loadFonts(requests: FontRequest[]): Promise<void>; // rejects when a face does not load: nothing is drawn in a substitute
  makeCanvas(width: number, height: number): FrameCanvas;
  download(blob: Blob, fileName: string): void;
};

// A canvas that is never added to the page.
function detachedCanvas(width: number, height: number): FrameCanvas {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const pageIO: SaveFrameIO = { decodeVideoFrame, decodeImage, loadFonts: loadFontsStrict, makeCanvas: detachedCanvas, download: downloadBlob };

// What each step that gave no picture is called: a file that could not be read, a picture that could not be decoded,
// or no canvas (or nothing came out of it).
const FAILED: Record<"read" | "decode" | "canvas", ExportFailure> = { read: "media", decode: "decode", canvas: "unknown" };

const detailOf = (error: unknown) => failureOf(error, "unknown").detail;

export function savePageFrame(media: ExportMediaDeps, io: SaveFrameIO = pageIO): ExportDeps["saveFrame"] {
  return async (doc, frame, size, fileName) => {
    // An asset the server could not be asked about is a file that cannot be read, never a "Media not found".
    try {
      await media.ensure(exportAssetIds(doc));
    } catch (error) {
      throw new ExportError("media", detailOf(error));
    }
    const plan = planExportMedia(doc, media.library());
    refuseWaiting(plan); // never a placeholder for media that is about to be ready

    // Each picture at the size this clip draws it, by the export's sizing rule. The export decodes a file shared by
    // several clips once, at the largest of their sizes, so a saved frame can differ slightly from the video there. A
    // decode that rejects is named by renderFrame: a file gone is a read failure, anything else a decode failure.
    const sizeOf = clipSizes(doc, size);
    const ruleFor = (clipId: string | undefined): SizeRule =>
      clipId === undefined ? noLargerThan(Math.max(size.width, size.height)) : (native) => sizeOf(clipId, native);
    let result: FrameResult;
    try {
      result = await renderFrame(doc, saveFrameRequest(doc, frame, size, plan), {
        readFile: media.readFile,
        decodeVideo: (blob, seconds, clipId) => io.decodeVideoFrame(blob, seconds, ruleFor(clipId)),
        decodeImage: (blob, clipId) => io.decodeImage(blob, ruleFor(clipId)),
        loadFonts: async (requests) => {
          try {
            await io.loadFonts(requests);
          } catch (error) {
            throw new ExportError("font", detailOf(error));
          }
        },
        resolveFont: pageFontResolver(),
        makeCanvas: io.makeCanvas,
      });
    } catch (error) {
      // The fonts did not load; anything else that threw while drawing is not a cause a person can act on.
      throw error instanceof ExportError ? error : new ExportError("unknown", detailOf(error));
    }
    if (result.kind === "picture") {
      io.download(result.blob, fileName);
      return;
    }
    // Nothing asks this render to stop, so a stopped one would be a fault of its own.
    if (result.kind === "stopped") throw new ExportError("unknown", "stopped");
    throw new ExportError(FAILED[result.why], result.why);
  };
}
