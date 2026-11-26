import type { ExportFormat, ExportSize } from "@/lib/export/presets";
import type { RunDeps } from "@/lib/export/run";
import type { ExportTarget } from "@/lib/export/sinks";
import type { SupportProbe } from "@/lib/export/support";
import type { Posting } from "@/lib/social/post-client";
import type { TimelineDoc } from "@/lib/timeline";

// Everything the export hook needs from the browser, so DOM tests can pass fakes.

// Where the person chose to save. held: null for a file on disk; for bytes held in memory, gives the finished file once
// the target has closed, for a Download click.
// read: for a file on disk, gives the finished file back (null when it can no longer be read), for posting it.
export type PickedTarget = { target: ExportTarget; fileName: string; held: (() => Blob | null) | null; read?: () => Promise<Blob | null> };

export type ExportDeps = RunDeps & {
  supportProbe: SupportProbe;
  savesToFile: boolean; // this browser has a save dialog; without one the bytes are held for a Download click
  // null: closed without a choice; "again": the dialog could not open. format: the kind of file; an MP4 when left out.
  pickTarget(suggestedName: string, format?: ExportFormat): Promise<PickedTarget | null | "again">;
  download(blob: Blob, fileName: string): void; // hands a held file to the browser; call it inside a click
  keepRunning(): () => void; // tells the browser the tab is busy; call the result when the export ends
  now(): number;
  // Saves one frame of the doc as a PNG at this size, with its media, under this name. Rejects with an ExportError
  // and saves nothing when the frame could not be drawn.
  saveFrame(doc: TimelineDoc, frame: number, size: ExportSize, fileName: string): Promise<void>;
  // Posting the finished file to the space's YouTube channel. Absent: the dialog offers no posting.
  posting?: Posting;
};
