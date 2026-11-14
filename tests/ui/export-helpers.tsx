import { Profiler } from "react";
import { vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { exportMediaDeps } from "@/components/editor/export/browser-deps";
import type { ExportDeps } from "@/components/editor/export/deps";
import { MediaProvider } from "@/components/editor/media/media-context";
import { gatherMedia } from "@/lib/export/gather-media";
import type { FromWorker } from "@/lib/export/protocol";
import type { MediaFiles } from "@/lib/media/media-files";
import type { AssetView } from "@/lib/media/types";
import type { TimelineDoc } from "@/lib/timeline";
import { makeStore } from "../editor/fixtures";
import type { FakeWorker } from "../export/fakes";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { fakeExportDeps } from "./export-fakes";

export type ShowInit = { canEdit?: boolean; doc?: TimelineDoc; assets?: AssetView[]; loaded?: boolean; readFile?: MediaFiles["get"] };

// The editor screen with a fake browser underneath: a worker that says what the test tells it to, a file that records, and a
// media library holding asset "a" (the fixture's video clips) as a ready video with a preview copy. The media is read for
// real, through gatherMedia, from files that answer at once unless readFile says otherwise.
export function show(over: Partial<ExportDeps> = {}, init: ShowInit = {}) {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const { assets = [assetView()], loaded = true, readFile, ...editor } = init;
  const store = makeStore(editor);
  const media = pretendMediaServices(assets, { loaded });
  media.files = { get: readFile ?? (async (fileId) => ({ ok: true, blob: new File([fileId], fileId) })), put: async () => {} };
  const made = fakeExportDeps({ collectMedia: (doc, options) => gatherMedia(doc, exportMediaDeps(media), options), ...over });
  let renders = 0; // every commit inside the editor, to see what a progress message draws again
  const view = render(
    <Profiler id="editor" onRender={() => { renders += 1; }}>
      <EditorProvider store={store} exportDeps={made.deps}>
        <MediaProvider services={media}>
          <EditorScreen />
        </MediaProvider>
      </EditorProvider>
    </Profiler>,
  );
  return { ...made, store, media, view, renders: () => renders };
}

export const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
export const click = async (name: string) => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
  await flush();
};
export const emit = async (worker: FakeWorker, message: FromWorker) => {
  await act(async () => { worker.emit(message); });
  await flush();
};
export const dialog = () => within(screen.getByText("Export", { selector: "h2" }).closest("dialog")!);
export const openDialog = async () => { await click("Export"); return dialog(); };
export const startExport = async () => { const d = await openDialog(); await click("Export video"); return d; };
