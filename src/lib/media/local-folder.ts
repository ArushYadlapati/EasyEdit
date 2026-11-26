import { LOCAL_FILE, localFileOf, type LocalRole } from "./types";
import type { MediaFiles } from "./media-files";

// Media kept in a folder on the person's own computer, in place of Google Drive. The browser is given the folder
// once (the File System Access API, in Chrome and Edge); after that it writes each added file there and reads it
// back from there. The folder is remembered by this browser, which asks for permission again on a later visit.
// Nothing here knows the DOM or IndexedDB: the folder's handle and where it is remembered are handed in.

// The parts of a directory handle that are used, so a test can stand one in.
export type FolderHandle = {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterable<[string, { kind: "file" | "directory" }]>;
  queryPermission?(options: { mode: "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission?(options: { mode: "readwrite" }): Promise<"granted" | "denied" | "prompt">;
};
export type FileHandle = {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
};

// Where this browser remembers the folder between visits (IndexedDB can hold a handle; nothing else can).
export type HandleMemory = { load(): Promise<FolderHandle | null>; save(handle: FolderHandle | null): Promise<void> };

// none: no folder chosen. locked: one is remembered, and the browser wants a click before it opens it again.
export type FolderState = "none" | "locked" | "ready";

// What is known of an asset when its file is looked for.
export type LocalAsset = { id: string; fileName: string; sizeBytes: number };

export type LocalFolder = {
  state(): FolderState;
  name(): string | null;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>; // looks up the remembered folder, once, when the editor opens
  choose(pick: () => Promise<FolderHandle>): Promise<boolean>; // false: the person closed the picker
  unlock(): Promise<boolean>; // asks the browser for the folder again; must run inside a click
  forget(): Promise<void>;
  write(asset: LocalAsset, role: LocalRole, blob: Blob): Promise<void>;
  read(asset: LocalAsset, role: LocalRole): Promise<Blob | null>;
  remove(asset: LocalAsset): Promise<void>;
};

// The copies made from a file sit apart from the files a person put there.
const MADE_FOLDER = ".easyedit";
const MADE_NAME: Record<Exclude<LocalRole, "original">, string> = { preview: "preview.mp4", poster: "poster.jpg" };

// Characters a file name may not hold on some system, and names Windows keeps for itself.
const cleanFileName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").trim() || "file";

// An original's name in the folder: its own name with the asset's id before the ending, so two files with one name
// never collide and a file can be found again by its id alone.
export function localName(asset: Pick<LocalAsset, "id" | "fileName">): string {
  const name = cleanFileName(asset.fileName);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} [${asset.id}]${name.slice(dot)}` : `${name} [${asset.id}]`;
}

export function createLocalFolder(memory: HandleMemory): LocalFolder {
  let handle: FolderHandle | null = null;
  let state: FolderState = "none";
  const listeners = new Set<() => void>();
  const set = (next: FolderState, nextHandle: FolderHandle | null) => {
    if (state === next && handle === nextHandle) return;
    state = next;
    handle = nextHandle;
    for (const listener of listeners) listener();
  };
  const permitted = async (folder: FolderHandle, ask: boolean): Promise<boolean> => {
    try {
      // A handle with no permission methods (a private folder of the browser's own) is always open.
      if (!folder.queryPermission) return true;
      if ((await folder.queryPermission({ mode: "readwrite" })) === "granted") return true;
      return ask && !!folder.requestPermission && (await folder.requestPermission({ mode: "readwrite" })) === "granted";
    } catch {
      return false;
    }
  };
  const fileOf = async (folder: FolderHandle, name: string): Promise<File | null> => {
    try {
      return await (await folder.getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  };
  const store = async (folder: FolderHandle, name: string, blob: Blob) => {
    const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => {});
      throw error;
    }
  };

  return {
    state: () => state,
    name: () => handle?.name ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async restore() {
      const kept = await memory.load().catch(() => null);
      if (!kept) return;
      set((await permitted(kept, false)) ? "ready" : "locked", kept);
    },
    async choose(pick) {
      let picked: FolderHandle;
      try {
        picked = await pick();
      } catch {
        return false; // the picker was closed
      }
      if (!(await permitted(picked, true))) return false;
      await memory.save(picked).catch(() => {}); // not remembered: it is asked for again next visit
      set("ready", picked);
      return true;
    },
    async unlock() {
      if (!handle) return false;
      const open = await permitted(handle, true);
      set(open ? "ready" : "locked", handle);
      return open;
    },
    async forget() {
      await memory.save(null).catch(() => {});
      set("none", null);
    },
    async write(asset, role, blob) {
      if (state !== "ready" || !handle) throw new Error("No media folder is open.");
      if (role === "original") return store(handle, localName(asset), blob);
      const made = await handle.getDirectoryHandle(MADE_FOLDER, { create: true });
      await store(made, `${asset.id}.${MADE_NAME[role]}`, blob);
    },
    async read(asset, role) {
      if (state !== "ready" || !handle) return null;
      if (role !== "original") {
        try {
          return await fileOf(await handle.getDirectoryHandle(MADE_FOLDER), `${asset.id}.${MADE_NAME[role]}`);
        } catch {
          return null;
        }
      }
      // The copy this app wrote, by its name. Failing that, the person's own file of the same name and size: a
      // folder of the original footage works as it is, on this computer or a teammate's.
      const own = await fileOf(handle, localName(asset));
      if (own) return own;
      const same = await fileOf(handle, asset.fileName);
      return same && same.size === asset.sizeBytes ? same : null;
    },
    async remove(asset) {
      if (state !== "ready" || !handle) return;
      await handle.removeEntry(localName(asset)).catch(() => {});
      const made = await handle.getDirectoryHandle(MADE_FOLDER).catch(() => null);
      for (const name of Object.values(MADE_NAME)) await made?.removeEntry(`${asset.id}.${name}`).catch(() => {});
    },
  };
}

// The media files of an editor, with those kept on this computer read from the folder and the rest as before.
// describe: what the library knows of an asset, by id. A local file that is not in the folder (no folder is open, or
// it is on another computer) is "missing". A preview copy that is not there falls back to the original, which a
// folder of the person's own footage has and a copy made elsewhere does not.
export function withLocalFiles(files: MediaFiles, folder: LocalFolder, describe: (assetId: string) => LocalAsset | null): MediaFiles {
  return {
    async get(fileId) {
      const local = localFileOf(fileId);
      if (!local) return files.get(fileId);
      const asset = describe(local.assetId);
      if (!asset) return { ok: false, problem: "missing" };
      const blob = (await folder.read(asset, local.role)) ?? (local.role === "preview" ? await folder.read(asset, "original") : null);
      return blob ? { ok: true, blob } : { ok: false, problem: "missing" };
    },
    put: (fileId, blob) => (fileId.startsWith(LOCAL_FILE) ? Promise.resolve() : files.put(fileId, blob)),
  };
}
