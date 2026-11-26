import type { ClipMedia } from "@/lib/export/media-schedule";
import type { FontBundle } from "@/lib/export/fonts";
import type { Acceleration, ExportFormat, VideoSettings } from "@/lib/export/presets";
import type { TimelineDoc } from "@/lib/timeline";

// The one place the shapes an export passes between the page and its worker are written. Types only.

export type ExportMedia = {
  files: Record<string, Blob>; // fileId → its bytes, each file once. A Blob is shared with the worker, not copied.
  clips: Record<string, ClipMedia>; // clipId → the file it draws from, or its placeholder's text
  sounds: Record<string, string>; // clipId → the file it sounds from; a clip not here is silent
};

export type ExportJob = {
  doc: TimelineDoc; // the snapshot; frames 0 … frameCount(doc) − 1 are exported
  video: VideoSettings;
  acceleration: Acceleration; // the encoder hint for this try
  fonts: FontBundle;
  media: ExportMedia;
  sound: boolean; // the page's answer: the file carries a sound track only if the page said so too
  format?: ExportFormat; // the kind of file; an MP4 when left out
};

// Every destination takes a write at any position it already holds, so the worker always writes the index at the
// end (fastStart: false) and never holds the file itself.
export type ExportFailure =
  | "unsupported" | "size" | "empty" | "font" | "font-mismatch" | "effects" | "waiting" | "media" | "decode" | "sound"
  | "encoder" | "write" | "worker" | "too-long" | "unknown";

// There is no cancel message: the page cancels by terminating the worker.
export type ToWorker = { type: "start"; job: ExportJob } | { type: "ack"; seq: number };

export type FromWorker =
  | { type: "chunk"; seq: number; position: number; data: Uint8Array<ArrayBuffer> } // write these bytes at this position, then answer with ack
  | { type: "progress"; framesDone: number; totalFrames: number }
  | { type: "done"; bytes: number; hasAudio: boolean }
  | { type: "failed"; code: ExportFailure; detail: string }; // detail is for the console, never shown

export type ExportOutcome =
  | { status: "done"; bytes: number; hasAudio: boolean; acceleration: Acceleration }
  | { status: "canceled" }
  | { status: "failed"; code: ExportFailure; detail: string };
