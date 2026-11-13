import type { RunDeps } from "@/lib/export/run";
import type { ExportTarget } from "@/lib/export/sinks";
import type { SupportProbe } from "@/lib/export/support";

// Everything the export hook needs from the browser, so DOM tests can pass fakes.

// Where the person chose to save. held: null for a file on disk; for bytes held in memory, gives the finished file once
// the target has closed, for a Download click.
export type PickedTarget = { target: ExportTarget; fileName: string; held: (() => Blob | null) | null };

export type ExportDeps = RunDeps & {
  supportProbe: SupportProbe;
  savesToFile: boolean; // this browser has a save dialog; without one the bytes are held for a Download click
  pickTarget(suggestedName: string): Promise<PickedTarget | null | "again">; // null: closed without a choice; "again": the dialog could not open
  download(blob: Blob, fileName: string): void; // hands a held file to the browser; call it inside a click
  keepRunning(): () => void; // tells the browser the tab is busy; call the result when the export ends
  now(): number;
};
