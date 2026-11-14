import type { ExportFailure } from "@/lib/export/protocol";

// Every sentence a person reads about a failed export or a frame that wasn't saved. The detail of a failure goes to
// the console only.

export const EXPORT_MESSAGES: Record<ExportFailure, string> = {
  unsupported: "This browser can't export video. Use a recent version of Chrome or Edge on a computer.",
  size: "This computer can't make a video at this size. Pick a smaller size.",
  empty: "This project is empty. Add a clip, then export.",
  font: "A font didn't load, so the export was stopped. Check your connection, reload the page and try again.",
  "font-mismatch": "Text would not look the same as in the preview, so the export was stopped. Reload the page and try again.",
  waiting: "Some media is still uploading or being prepared. Export once it's ready.",
  media: "A media file couldn't be read, so the export was stopped. Check your connection and try again.",
  decode: "A video clip couldn't be decoded in this browser, so the export was stopped.",
  sound: "A clip's sound couldn't be decoded in this browser, so the export was stopped. Mute its track to export without it.",
  encoder: "The video encoder stopped. Try again.",
  write: "The file couldn't be saved. Check that the disk has room and try again.",
  worker: "Export couldn't start. Reload the page and try again.",
  "too-long": "This video is too long to export in this browser. Use Chrome or Edge, or pick the draft size.",
  unknown: "Export didn't finish. Try again.",
};

export function failureMessage(code: ExportFailure): string {
  return EXPORT_MESSAGES[code];
}

// Save frame runs no export, so these causes are said of the frame. Every other cause gets the plain sentence.
const FRAME_MESSAGES: Partial<Record<ExportFailure, string>> = {
  font: "A font didn't load, so the frame wasn't saved. Check your connection, reload the page and try again.",
  media: "A media file couldn't be read, so the frame wasn't saved. Check your connection and try again.",
  decode: "A video clip couldn't be decoded in this browser, so the frame wasn't saved.",
  waiting: "Some media is still uploading or being prepared. Save the frame once it's ready.",
};
const FRAME_NOT_SAVED = "The frame couldn't be saved. Try again.";

export function frameFailureMessage(code: ExportFailure): string {
  return FRAME_MESSAGES[code] ?? FRAME_NOT_SAVED;
}

// What a step deep inside throws when it knows which failure it is.
export class ExportError extends Error {
  readonly code: ExportFailure;
  readonly detail: string;

  constructor(code: ExportFailure, detail: string) {
    super(detail);
    this.name = "ExportError";
    this.code = code;
    this.detail = detail;
  }
}

export function failureOf(error: unknown, fallback: ExportFailure): { code: ExportFailure; detail: string } {
  if (error instanceof ExportError) return { code: error.code, detail: error.detail };
  if (error instanceof Error) return { code: fallback, detail: error.message };
  return { code: fallback, detail: String(error) };
}

const field = (error: unknown, key: "name" | "message"): string | null =>
  typeof error === "object" && error !== null && typeof (error as Record<string, unknown>)[key] === "string"
    ? ((error as Record<string, string>)[key])
    : null;

// The error's message, or the value itself as text.
export function errorMessage(error: unknown): string {
  return field(error, "message") ?? String(error);
}

// The file went away under its reader (another tab's cache removed it, for example).
const FILE_GONE = new Set(["NotReadableError", "NotFoundError", "InputDisposedError"]);

export function fileGone(error: unknown): boolean {
  return FILE_GONE.has(field(error, "name") ?? "");
}

// A reader's failure, named by its cause: a file gone is a media failure, and a decoder the browser took back (as
// Chrome can in a background tab) an encoder failure, so the export tries once more in a fresh worker. Anything else
// is the reader's own failure, `fallback`.
export function readFailure(error: unknown, fallback: ExportFailure): ExportError {
  if (fileGone(error)) return new ExportError("media", errorMessage(error));
  if (field(error, "name") === "QuotaExceededError") return new ExportError("encoder", errorMessage(error));
  return new ExportError(fallback, errorMessage(error));
}
