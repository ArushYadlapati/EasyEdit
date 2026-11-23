import { canEncodeAac } from "@/lib/export/aac";
import { gatherMedia, type ExportMediaDeps } from "@/lib/export/gather-media";
import { ExportError } from "@/lib/export/messages";
import { fileTarget, memoryTarget } from "@/lib/export/sinks";
import type { SupportProbe } from "@/lib/export/support";
import { createPosting } from "@/lib/social/post-client";
import { loadMediabunny } from "../media/frame-decode";
import type { MediaServices } from "../media/media-context";
import { collectPageFonts } from "../page-fonts";
import type { ExportDeps, PickedTarget } from "./deps";
import { downloadBlob } from "./download";
import { savePageFrame } from "./save-frame";

// The real ExportDeps of this page, over the editor's media services. Nothing here runs until an export starts, and
// every browser feature is looked up with typeof, so the file can be loaded on the server.

// The save dialog, which TypeScript's DOM types do not have.
type SaveDialogOptions = {
  suggestedName: string;
  id: string;
  startIn: "videos";
  types: { description: string; accept: Record<string, string[]> }[];
};
type WithSaveDialog = { showSaveFilePicker?: (options: SaveDialogOptions) => Promise<FileSystemFileHandle> };

const page = () => globalThis as WithSaveDialog;

const errorName = (error: unknown) => (typeof error === "object" && error !== null && "name" in error ? error.name : null);

async function pickTarget(suggestedName: string): Promise<PickedTarget | null | "again"> {
  const scope = page();
  if (typeof scope.showSaveFilePicker === "function") {
    try {
      // Asked at once, inside the click that started the export: the browser opens the dialog only then.
      const handle = await scope.showSaveFilePicker({
        suggestedName,
        id: "easyedit-export",
        startIn: "videos",
        types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
      });
      // The save dialog gave leave to write the file, which covers reading it back.
      const read = async () => {
        try {
          return await handle.getFile();
        } catch {
          return null; // moved, deleted, or the leave was taken back
        }
      };
      return { target: fileTarget(handle), fileName: handle.name, held: null, read };
    } catch (error) {
      if (errorName(error) === "AbortError") return null; // the person closed it
      // The click's activation has gone, or another dialog is open: the person is asked to click once more. The bytes
      // never quietly go to memory in a browser that has a save dialog.
      return "again";
    }
  }
  let saved: Blob | null = null;
  return {
    target: memoryTarget((blob) => {
      saved = blob;
    }),
    fileName: suggestedName,
    held: () => saved,
  };
}

const supportProbe = (): SupportProbe => ({
  hasWorkers: typeof Worker !== "undefined",
  hasOffscreenCanvas: typeof OffscreenCanvas !== "undefined",
  hasVideoEncoder: typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined",
  async canEncode(config) {
    try {
      return (await VideoEncoder.isConfigSupported(config)).supported === true;
    } catch {
      return false;
    }
  },
  canEncodeAudio: canEncodeAac,
});

// Tells the browser the tab is busy for as long as the export runs, with a Web Lock of this export's own: one shared
// name would leave a second tab's export queued, holding nothing. A release that comes before the lock is granted ends
// the lock as soon as it is.
function keepRunning(): () => void {
  const locks = typeof navigator === "undefined" ? null : navigator.locks;
  if (!locks) return () => {};
  let release = () => {};
  const ended = new Promise<void>((resolve) => {
    release = resolve;
  });
  void locks.request(`easyedit-export-${crypto.randomUUID()}`, () => ended).catch(() => {});
  return release;
}

// What gatherMedia reads through: the editor's own library and files.
export function exportMediaDeps(media: MediaServices): ExportMediaDeps {
  return {
    library: () => media.library.getState(),
    async ensure(ids) {
      const unanswered = await media.library.getState().ensure(ids);
      // An asset the server could not be asked about is a file that cannot be read, never a "Media not found".
      if (unanswered.length > 0) throw new ExportError("media", unanswered.join(","));
    },
    async readFile(fileId) {
      const got = await media.files.get(fileId);
      return got.ok ? got.blob : null;
    },
    decodable: canDrawOriginal,
  };
}

// Whether this browser can draw an original's pictures as they should look: it has a video track the browser's
// decoder takes, and it is not high dynamic range, which a canvas would draw washed out. A file that cannot be opened
// at all counts as one it cannot draw.
async function canDrawOriginal(file: Blob): Promise<boolean> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await loadMediabunny();
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) return false;
      const hdr = (track as { hasHighDynamicRange?: () => Promise<boolean> }).hasHighDynamicRange;
      return typeof hdr === "function" ? !(await hdr.call(track)) : true;
    } finally {
      input.dispose();
    }
  } catch {
    return false;
  }
}

export function browserExportDeps(media: MediaServices): ExportDeps {
  return {
    // Written exactly so: Turbopack bundles a worker only from this expression.
    createWorker: () => new Worker(new URL("../../../workers/export.worker.ts", import.meta.url), { type: "module" }),
    collectFonts: collectPageFonts,
    collectMedia: (doc, options) => gatherMedia(doc, exportMediaDeps(media), options),
    supportProbe: supportProbe(),
    savesToFile: typeof page().showSaveFilePicker === "function",
    pickTarget,
    download: downloadBlob,
    keepRunning,
    now: () => performance.now(),
    saveFrame: savePageFrame(exportMediaDeps(media)),
    posting: createPosting(),
  };
}
