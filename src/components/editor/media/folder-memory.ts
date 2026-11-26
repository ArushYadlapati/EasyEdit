import type { FolderHandle, HandleMemory } from "@/lib/media/local-folder";

// Where this browser remembers a space's media folder between visits. A folder's handle can be kept in IndexedDB and
// nowhere else; the browser still asks the person before it opens the folder again.

const DATABASE = "easyedit-media-folder";
const STORE = "folders";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

// One space's memory. A browser without IndexedDB remembers nothing: the folder is chosen again each visit.
export function folderMemory(spaceId: string): HandleMemory {
  return {
    async load() {
      if (typeof indexedDB === "undefined") return null;
      return ((await run("readonly", (store) => store.get(spaceId))) as FolderHandle | undefined) ?? null;
    },
    async save(handle) {
      if (typeof indexedDB === "undefined") return;
      await run("readwrite", (store) => (handle ? store.put(handle, spaceId) : store.delete(spaceId)) as IDBRequest<unknown>);
    },
  };
}

// Whether this browser can be given a folder at all (Chrome and Edge on a computer).
export const canPickFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

// Asks the person for a folder to read and write. It rejects when they close the picker.
export function pickFolder(): Promise<FolderHandle> {
  const picker = (window as unknown as { showDirectoryPicker(options: { id: string; mode: "readwrite" }): Promise<FolderHandle> }).showDirectoryPicker;
  return picker.call(window, { id: "easyedit-media", mode: "readwrite" });
}
