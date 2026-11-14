import { vi, type Mock } from "vitest";
import type { ExportDeps } from "@/components/editor/export/deps";
import { NO_FONTS, NO_MEDIA, fakeTarget, fakeWorker, type FakeTarget, type FakeWorker } from "../export/fakes";

export type MadeDeps = {
  deps: ExportDeps;
  workers: FakeWorker[];
  target: FakeTarget;
  picked: string[];
  download: Mock<ExportDeps["download"]>;
  saveFrame: Mock<ExportDeps["saveFrame"]>;
};

// Everything the export hook needs from the browser, as fakes: a browser that can export every size with sound, has
// a save dialog that saves to one recorded target under the suggested name, and starts a recorded fake worker. A saved
// frame is recorded and saves nothing.
export function fakeExportDeps(over: Partial<ExportDeps> = {}): MadeDeps {
  const workers: FakeWorker[] = [];
  const target = fakeTarget();
  const picked: string[] = [];
  const download = vi.fn<ExportDeps["download"]>();
  const saveFrame = vi.fn<ExportDeps["saveFrame"]>(async () => {});
  const deps: ExportDeps = {
    createWorker: () => {
      const worker = fakeWorker();
      workers.push(worker);
      return worker;
    },
    supportProbe: {
      hasWorkers: true,
      hasOffscreenCanvas: true,
      hasVideoEncoder: true,
      canEncode: async () => true,
      canEncodeAudio: async () => true,
    },
    savesToFile: true,
    pickTarget: async (name) => {
      picked.push(name);
      return { target, fileName: name, held: null };
    },
    download,
    collectFonts: async () => NO_FONTS,
    collectMedia: async () => NO_MEDIA,
    keepRunning: () => () => {},
    now: () => 0,
    saveFrame,
    ...over,
  };
  return { deps, workers, target, picked, download, saveFrame };
}
