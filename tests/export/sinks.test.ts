import { describe, expect, it } from "vitest";
import { MEMORY_LIMIT_BYTES, fileTarget, memoryTarget, type FileHandleLike } from "@/lib/export/sinks";

// A file handle as the File System spec has it: once the file is removed, the handle can no longer open or read it.
function fakeHandle(existingSize = 0, over: Partial<FileHandleLike> = {}) {
  const state = { size: existingSize, opened: 0, writes: [] as [number, number[]][], closed: 0, aborted: 0, removed: 0 };
  const gone = () => new DOMException("The file is gone.", "NotFoundError");
  const handle: FileHandleLike = {
    name: "Qual recap.mp4",
    async createWritable() {
      if (state.removed > 0) throw gone();
      state.opened++;
      return {
        async write(chunk) { state.writes.push([chunk.position, [...chunk.data]]); },
        async close() { state.closed++; state.size = 99; },
        async abort() { state.aborted++; },
      };
    },
    async getFile() {
      if (state.removed > 0) throw gone();
      return { size: state.size };
    },
    async remove() { state.removed++; },
    ...over,
  };
  return { handle, state };
}

describe("a chosen file", () => {
  it("writes each chunk at its position and keeps the file on close", async () => {
    const { handle, state } = fakeHandle();
    const target = fileTarget(handle);
    expect(target.limit).toBeNull();
    const sink = await target.open();
    await sink.write(0, new Uint8Array([1, 2]));
    await sink.write(40, new Uint8Array([3]));
    await sink.write(0, new Uint8Array([9])); // the muxer goes back to patch the start
    await sink.close();
    expect(state).toMatchObject({ opened: 1, writes: [[0, [1, 2]], [40, [3]], [0, [9]]], closed: 1, aborted: 0, removed: 0 });
  });

  it("abort drops what the try wrote and leaves the file for the next try", async () => {
    const { handle, state } = fakeHandle(0);
    const target = fileTarget(handle);
    const first = await target.open();
    await first.write(0, new Uint8Array([1]));
    await first.abort();
    expect(state).toMatchObject({ closed: 0, aborted: 1, removed: 0 });
    const second = await target.open(); // the software encoder's try, in the same file
    await second.write(0, new Uint8Array([2]));
    await second.close();
    expect(state).toMatchObject({ opened: 2, aborted: 1, closed: 1, removed: 0 });
  });

  it("discard removes the empty file the save dialog made", async () => {
    const { handle, state } = fakeHandle(0);
    const target = fileTarget(handle);
    const sink = await target.open();
    await sink.write(0, new Uint8Array([1]));
    await sink.abort();
    await target.discard();
    expect(state).toMatchObject({ closed: 0, aborted: 1, removed: 1 });
  });

  it("discard leaves an older file with that name as it was", async () => {
    const { handle, state } = fakeHandle(500);
    const target = fileTarget(handle);
    await (await target.open()).abort();
    await target.discard();
    expect(state).toMatchObject({ aborted: 1, removed: 0 });
  });

  it("abort and discard never throw, with or without a way to remove the file", async () => {
    const noRemove = fakeHandle(0, { remove: undefined });
    await expect(fileTarget(noRemove.handle).discard()).resolves.toBeUndefined();
    const broken = fakeHandle(0, {
      createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => { throw new Error("stuck"); } }),
      getFile: async () => { throw new Error("gone"); },
      remove: async () => { throw new Error("denied"); },
    });
    const target = fileTarget(broken.handle);
    await expect((await target.open()).abort()).resolves.toBeUndefined();
    await expect(target.discard()).resolves.toBeUndefined();
  });
});

describe("memory", () => {
  it("collects the bytes and hands over one MP4 blob", async () => {
    const saved: Blob[] = [];
    const target = memoryTarget((blob) => saved.push(blob));
    expect(target.limit).toBe(MEMORY_LIMIT_BYTES);
    expect(MEMORY_LIMIT_BYTES).toBe(512 * 1024 * 1024);
    const sink = await target.open();
    await sink.write(0, new Uint8Array([1, 2]));
    await sink.write(2, new Uint8Array([3]));
    await sink.close();
    expect(saved).toHaveLength(1);
    expect(saved[0].type).toBe("video/mp4");
    expect([...new Uint8Array(await saved[0].arrayBuffer())]).toEqual([1, 2, 3]);
    await expect(target.discard()).resolves.toBeUndefined();
  });

  it("patches bytes it holds, as the muxer does at the end", async () => {
    const saved: Blob[] = [];
    const sink = await memoryTarget((blob) => saved.push(blob)).open();
    await sink.write(0, new Uint8Array([1, 2]));
    await sink.write(2, new Uint8Array([3, 4]));
    await sink.write(1, new Uint8Array([9, 9])); // across the two parts
    await sink.write(4, new Uint8Array([5])); // and on at the end
    await sink.close();
    expect([...new Uint8Array(await saved[0].arrayBuffer())]).toEqual([1, 9, 9, 4, 5]);
  });

  it("patches the end of what it holds and keeps only the rest as new bytes", async () => {
    const saved: Blob[] = [];
    const sink = await memoryTarget((blob) => saved.push(blob)).open();
    await sink.write(0, new Uint8Array([1, 2, 3]));
    await sink.write(2, new Uint8Array([7, 8, 9])); // byte 2 is patched, 8 and 9 run on
    await sink.close();
    expect([...new Uint8Array(await saved[0].arrayBuffer())]).toEqual([1, 2, 7, 8, 9]);
  });

  it("lets go of the bytes on abort, and once it has handed them over", async () => {
    const saved: Blob[] = [];
    const sink = await memoryTarget((blob) => saved.push(blob)).open();
    await sink.write(0, new Uint8Array([1, 2]));
    await sink.abort();
    await sink.write(0, new Uint8Array([3]));
    await sink.close();
    await sink.close();
    expect([...new Uint8Array(await saved[0].arrayBuffer())]).toEqual([3]);
    expect(saved[1].size).toBe(0);
  });

  it("refuses a gap, and refuses past its limit as too long", async () => {
    const saved: Blob[] = [];
    const sink = await memoryTarget((blob) => saved.push(blob), 4).open();
    await sink.write(0, new Uint8Array([1, 2]));
    await expect(sink.write(3, new Uint8Array([1]))).rejects.toThrow(); // a gap: byte 2 was never written
    await expect(sink.write(2, new Uint8Array([3, 4, 5]))).rejects.toMatchObject({ name: "ExportError", code: "too-long" });
    await sink.abort();
    expect(saved).toEqual([]);
  });
});
