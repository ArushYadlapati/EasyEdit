import { createLocalFolder } from "@/lib/media/local-folder";
import type { MediaServices } from "@/components/editor/media/media-context";
import type { MediaApi } from "@/lib/media/api";
import { createLibraryStore, type LibraryStore } from "@/lib/media/library-store";
import type { AssetView } from "@/lib/media/types";
import type { UploadQueue } from "@/lib/media/upload-queue";

// A ready video. The fixture's video clips (tests/editor/fixtures.ts) name asset "a".
export const assetView = (over: Partial<AssetView> = {}): AssetView => ({
  id: "a",
  kind: "video",
  name: "intake",
  fileName: "intake.mp4",
  sizeBytes: 1000,
  status: "ready",
  removed: false,
  durationMs: 12_500,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  originalFileId: "orig-a",
  previewStatus: "ready",
  previewFileId: "prev-a",
  posterFileId: "post-a",
  event: null,
  uploadedBy: "u1",
  uploadedByName: "Ada Lovelace",
  createdAt: "2026-11-01T10:00:00.000Z",
  ...over,
});

const never = <T,>() => new Promise<T>(() => {});

// A media folder nobody has chosen, which remembers nothing.
export const idleFolder = () => createLocalFolder({ load: async () => null, save: async () => {} });

// The media services of an editor whose library already holds these assets. Nothing in them reaches a server: every
// call to the API waits for ever, the queue takes nothing and no file is ever read.
export function pretendMediaServices(assets: AssetView[], options: { loaded?: boolean } = {}): MediaServices {
  const api: MediaApi = {
    list: never, open: never, offset: never, complete: never, openFile: never, completeFile: never, previewFailed: never, addLocal: never, localFile: never,
    update: never, remove: never, readToken: never,
  };
  const library = createLibraryStore({ api });
  library.setState({ assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])), loaded: options.loaded ?? true });
  const queue: UploadQueue = { add: () => [], cancel() {}, retry() {}, resume() {}, dismiss() {}, stop() {}, items: () => [], active: () => 0 };
  return { library, queue, files: { get: never, put: async () => {} }, local: idleFolder(), dispose() {} };
}

// A loaded library whose every request for more assets fails as if the network were down. Nothing else it could ask
// the server ever answers.
export function unreachableLibrary(): LibraryStore {
  const api: MediaApi = {
    list: async () => ({ ok: false, kind: "network", message: "" }),
    open: never, offset: never, complete: never, openFile: never, completeFile: never, previewFailed: never, addLocal: never, localFile: never,
    update: never, remove: never, readToken: never,
  };
  const library = createLibraryStore({ api });
  library.setState({ loaded: true });
  return library;
}
