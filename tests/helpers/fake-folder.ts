import type { FileHandle, FolderHandle } from "@/lib/media/local-folder";

// A folder that lives in memory, with the parts of the browser's directory handle the app uses. permission: what the
// browser would say before and after it is asked; a folder made with "prompt" opens once request is answered.
export type FakeFolder = FolderHandle & {
  files: Map<string, Blob>;
  folders: Map<string, FakeFolder>;
  asked: number; // how many times permission was requested
  failWrites: boolean;
  names(): string[]; // every file, with its folder's name in front for the ones inside one
};

export function fakeFolder(name = "Footage", permission: { now: "granted" | "prompt" | "denied"; onAsk?: "granted" | "denied" } = { now: "granted" }): FakeFolder {
  const files = new Map<string, Blob>();
  const folders = new Map<string, FakeFolder>();
  let state = permission.now;
  const folder: FakeFolder = {
    name,
    files,
    folders,
    asked: 0,
    failWrites: false,
    names: () => [...files.keys(), ...[...folders].flatMap(([dir, inner]) => inner.names().map((file) => `${dir}/${file}`))].sort(),
    async getFileHandle(fileName, options): Promise<FileHandle> {
      if (!files.has(fileName) && !options?.create) throw new DOMException("not found", "NotFoundError");
      return {
        getFile: async () => {
          const blob = files.get(fileName);
          if (!blob) throw new DOMException("not found", "NotFoundError");
          return new File([blob], fileName);
        },
        createWritable: async () => {
          let written: Blob | null = null;
          return {
            write: async (data: Blob) => {
              if (folder.failWrites) throw new DOMException("no room", "QuotaExceededError");
              written = data;
            },
            close: async () => void (written && files.set(fileName, written)),
            abort: async () => void (written = null),
          };
        },
      };
    },
    async getDirectoryHandle(dirName, options) {
      if (!folders.has(dirName)) {
        if (!options?.create) throw new DOMException("not found", "NotFoundError");
        folders.set(dirName, fakeFolder(dirName));
      }
      return folders.get(dirName)!;
    },
    async removeEntry(entry) {
      if (!files.delete(entry) && !folders.delete(entry)) throw new DOMException("not found", "NotFoundError");
    },
    async *entries() {
      for (const file of files.keys()) yield [file, { kind: "file" as const }] as [string, { kind: "file" | "directory" }];
      for (const dir of folders.keys()) yield [dir, { kind: "directory" as const }] as [string, { kind: "file" | "directory" }];
    },
    queryPermission: async () => state,
    requestPermission: async () => {
      folder.asked++;
      state = permission.onAsk ?? "granted";
      return state;
    },
  };
  return folder;
}
