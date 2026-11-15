"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useStore } from "zustand";
import type { MediaDrop, MediaDropState } from "@/lib/editor/media-drop";
import { createMediaApi, type MediaApi } from "@/lib/media/api";
import type { SpaceKind } from "@/lib/spaces/types";
import type { StorageBlock } from "@/lib/storage/messages";
import { createIngest } from "@/lib/media/ingest-protocol";
import { createLibraryStore, type LibraryState, type LibraryStore } from "@/lib/media/library-store";
import { createMediaFiles, createMemoryStore, type MediaFiles } from "@/lib/media/media-files";
import { createReadTokens } from "@/lib/media/read-tokens";
import { createUploadQueue, type UploadQueue } from "@/lib/media/upload-queue";
import { createDriveTransport } from "@/lib/media/uploader";
import { createOpfsStore, createSettledStore } from "./media-cache";

// What one open editor uses of the media library. dispose: for leaving the editor; it stops the uploads that run
// (removing nothing on the server) and ends the worker. The services stay usable afterwards.
export type MediaServices = { library: LibraryStore; queue: UploadQueue; files: MediaFiles; dispose(): void };

// A wait between tries of an upload's piece. It always resolves.
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The real ones for one open editor: the API client, the worker, the token source and the browser's file storage.
// Nothing is asked of the server, the worker or the storage until it is first used.
export function createMediaServices(spaceId: string): MediaServices {
  const api = createMediaApi(spaceId);
  const library = createLibraryStore({ api });
  const files = createMediaFiles({
    tokens: createReadTokens({ api }),
    store: createSettledStore(async () => (await createOpfsStore().catch(() => null)) ?? createMemoryStore()),
  });
  const ingest = createIngest(() => new Worker(new URL("../../../workers/ingest.worker.ts", import.meta.url), { type: "module" }));
  const queue = createUploadQueue({
    api,
    ingest,
    transport: createDriveTransport(),
    sleep,
    onChange: (items) => library.getState().setUploads(items),
    onAsset: (asset) => library.getState().put(asset), // the member's own uploads need no fetch of the library
    onPreviewFile: (fileId, blob) => void files.put(fileId, blob),
    event: () => library.getState().uploadEvent,
  });
  return {
    library,
    queue,
    files,
    dispose() {
      queue.stop();
      ingest.dispose();
    },
  };
}

// The services of a space with no storage: the queue takes no file. Every way a file gets in (the Media tab, the window,
// the timeline, the preview) ends at queue.add, so this one place refuses them all, whatever the library's setUp says
// before its first refresh. Nothing is ever sent to the media API for a file.
export function gateStorage(services: MediaServices, storageReady: boolean): MediaServices {
  if (storageReady) return services;
  return { ...services, queue: { ...services.queue, add: () => [] } };
}

// Without a provider, as in tests of other parts of the editor: a library that never loads, a queue that takes
// nothing, and files that cannot be read.
function idleServices(): MediaServices {
  const never = () => new Promise<never>(() => {});
  const api: MediaApi = {
    list: never,
    open: never,
    offset: never,
    complete: never,
    openFile: never,
    completeFile: never,
    previewFailed: never,
    update: never,
    remove: never,
    readToken: never,
  };
  const queue: UploadQueue = {
    add: () => [],
    cancel() {},
    retry() {},
    resume() {},
    dismiss() {},
    stop() {},
    items: () => [],
    active: () => 0,
  };
  const files: MediaFiles = { get: async () => ({ ok: false, problem: "offline" }), put: async () => {} };
  return { library: createLibraryStore({ api }), queue, files, dispose() {} };
}

const MediaContext = createContext<MediaServices | null>(null);
// Why a space has no storage to upload to: it has none ("none"), or its Google connection needs reconnecting
// ("broken"). null: nothing is wrong.
export type StorageProblem = "none" | "broken" | null;

// What the Media tab's setup card needs to know of a space without storage: its kind and address, whether the person
// runs it (only admins set storage up or reconnect it), and what stops this server setting storage up (block); for a
// broken connection, whether the person made it (only they can reconnect it) and, if not, who did (ownerEmail).
export type StorageSetup = { kind: SpaceKind; slug: string; isAdmin: boolean; block: StorageBlock; ownsConnection: boolean; ownerEmail: string | null };

// The space the library belongs to, whether it has storage to upload to, and if not, why, and who can set it up.
type MediaSpace = { spaceId: string | null; storageReady: boolean; storageProblem: StorageProblem; storageSetup: StorageSetup | null };
// The default agrees with MediaProvider's: with no provider no space is named and storage counts as ready. "Not ready"
// hides uploading, so it must only ever come from a provider that was told so (the editor page, from storageState).
const MediaSpaceContext = createContext<MediaSpace>({ spaceId: null, storageReady: true, storageProblem: null, storageSetup: null });
const MediaDropContext = createContext<MediaDrop | null>(null);
const IDLE = idleServices();

// drop: the editor's file and library drags. Without one, every drag feature does nothing.
// spaceId, storageReady, storageProblem: the library's space, whether it has storage, and if not, why. Without them
// (tests of other parts of the editor) no space is named and storage counts as ready. storageSetup: for the setup
// card; without it the card offers no way to set storage up.
export function MediaProvider({
  services,
  spaceId = null,
  storageReady = true,
  storageProblem = storageReady ? null : "none",
  storageSetup = null,
  drop = null,
  children,
}: {
  services: MediaServices;
  spaceId?: string | null;
  storageReady?: boolean;
  storageProblem?: StorageProblem;
  storageSetup?: StorageSetup | null;
  drop?: MediaDrop | null;
  children: ReactNode;
}): ReactNode {
  // The setup's fields, not the object, so a new object with the same values keeps the context as it is.
  const { kind, slug, isAdmin, block, ownsConnection, ownerEmail } = storageSetup ?? {};
  const space = useMemo(
    () => ({
      spaceId,
      storageReady,
      storageProblem,
      storageSetup:
        kind !== undefined && slug !== undefined
          ? { kind, slug, isAdmin: isAdmin === true, block: block ?? null, ownsConnection: ownsConnection === true, ownerEmail: ownerEmail ?? null }
          : null,
    }),
    [spaceId, storageReady, storageProblem, kind, slug, isAdmin, block, ownsConnection, ownerEmail],
  );
  return (
    <MediaContext value={services}>
      <MediaSpaceContext value={space}>
        <MediaDropContext value={drop}>{children}</MediaDropContext>
      </MediaSpaceContext>
    </MediaContext>
  );
}

export function useMediaSpace(): MediaSpace {
  return useContext(MediaSpaceContext);
}

export function useMedia(): MediaServices {
  return useContext(MediaContext) ?? IDLE;
}

// Reads from the library store and re-renders when the selected value changes. As with useEditor, the selector must
// return a primitive or an existing reference; wrap derived arrays and objects (visibleAssets) in useShallow.
export function useLibrary<T>(selector: (state: LibraryState) => T): T {
  return useStore(useMedia().library, selector);
}

export function useMediaDrop(): MediaDrop | null {
  return useContext(MediaDropContext);
}

// Reads from the drag state and re-renders when the selected value changes; fallback without a drop. The selector
// must return a primitive or an existing reference.
export function useMediaDropState<T>(selector: (state: MediaDropState) => T, fallback: T): T {
  const drop = useMediaDrop();
  const subscribe = useCallback((onChange: () => void) => (drop ? drop.state.subscribe(onChange) : () => {}), [drop]);
  const read = () => (drop ? selector(drop.state.getState()) : fallback);
  return useSyncExternalStore(subscribe, read, read);
}
