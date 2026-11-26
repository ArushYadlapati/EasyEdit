import { describe, expect, it, vi } from "vitest";
import { createLocalFolder, localName, withLocalFiles, type FolderHandle, type HandleMemory } from "@/lib/media/local-folder";
import type { MediaFiles } from "@/lib/media/media-files";
import { playbackFileFor } from "@/lib/media/playback";
import { isLocalFile, localFileId, localFileOf } from "@/lib/media/types";
import { fakeFolder } from "../helpers/fake-folder";
import { assetView } from "../helpers/media-services";

const ASSET = { id: "abc123", fileName: "My Shoot: take 2.mp4", sizeBytes: 5 };
const bytes = (text: string) => new Blob([text]);
const textOf = async (blob: Blob | null) => (blob ? await blob.text() : null);
function memory(kept: FolderHandle | null = null): HandleMemory & { kept: FolderHandle | null; saves: number } {
  const m = { kept, saves: 0, load: async () => m.kept, save: async (handle: FolderHandle | null) => void ((m.kept = handle), m.saves++) };
  return m;
}

describe("the ids of files kept on a computer", () => {
  it("name the asset and which of its files", () => {
    expect([localFileId("a1"), localFileId("a1", "preview"), localFileId("a1", "poster")]).toEqual(["local:a1", "local:a1:preview", "local:a1:poster"]);
    expect(localFileOf("local:a1")).toEqual({ assetId: "a1", role: "original" });
    expect(localFileOf("local:a1:poster")).toEqual({ assetId: "a1", role: "poster" });
    expect([localFileOf("1AbCdriveId"), localFileOf(null), localFileOf("local:"), localFileOf("local:a1:other")]).toEqual([null, null, null, null]);
    expect([isLocalFile("local:a1"), isLocalFile("drive-1"), isLocalFile(null)]).toEqual([true, false, false]);
  });
  it("a file's name in the folder keeps its own name, with the asset's id before the ending", () => {
    expect(localName(ASSET)).toBe("My Shoot_ take 2 [abc123].mp4");
    expect(localName({ id: "x", fileName: "README" })).toBe("README [x]");
    expect(localName({ id: "x", fileName: ".hidden.mov" })).toBe("_hidden [x].mov");
    expect(localName({ id: "x", fileName: 'a/b\\c*?"<>|.png' })).toBe("a_b_c______ [x].png");
  });
});

describe("the media folder", () => {
  it("starts with none, takes the one the person picks and remembers it", async () => {
    const kept = memory();
    const folder = createLocalFolder(kept);
    const seen: string[] = [];
    folder.subscribe(() => seen.push(folder.state()));
    await folder.restore();
    expect([folder.state(), folder.name()]).toEqual(["none", null]);
    const picked = fakeFolder("Footage");
    expect(await folder.choose(async () => picked)).toBe(true);
    expect([folder.state(), folder.name(), kept.kept, seen]).toEqual(["ready", "Footage", picked, ["ready"]]);
    // Closing the picker changes nothing.
    expect(await folder.choose(async () => Promise.reject(new DOMException("closed", "AbortError")))).toBe(false);
    expect(folder.name()).toBe("Footage");
  });
  it("on a later visit is locked until the browser is asked again inside a click", async () => {
    const picked = fakeFolder("Footage", { now: "prompt" });
    const folder = createLocalFolder(memory(picked));
    await folder.restore();
    expect([folder.state(), folder.name(), picked.asked]).toEqual(["locked", "Footage", 0]);
    expect(await folder.read(ASSET, "original")).toBeNull();
    await expect(folder.write(ASSET, "original", bytes("x"))).rejects.toThrow("No media folder is open.");
    expect(await folder.unlock()).toBe(true);
    expect([folder.state(), picked.asked]).toEqual(["ready", 1]);
  });
  it("stays locked when the person says no, and is open at once when the browser still allows it", async () => {
    const refused = createLocalFolder(memory(fakeFolder("Footage", { now: "prompt", onAsk: "denied" })));
    await refused.restore();
    expect(await refused.unlock()).toBe(false);
    expect(refused.state()).toBe("locked");
    const allowed = createLocalFolder(memory(fakeFolder("Footage")));
    await allowed.restore();
    expect(allowed.state()).toBe("ready");
  });
  it("is forgotten on request, and a picked folder the person will not open is not taken", async () => {
    const kept = memory();
    const folder = createLocalFolder(kept);
    await folder.choose(async () => fakeFolder());
    await folder.forget();
    expect([folder.state(), kept.kept]).toEqual(["none", null]);
    expect(await folder.choose(async () => fakeFolder("No", { now: "prompt", onAsk: "denied" }))).toBe(false);
    expect(folder.state()).toBe("none");
  });
  it("writes an original under its own name and the copies made from it in a folder of their own", async () => {
    const picked = fakeFolder();
    const folder = createLocalFolder(memory());
    await folder.choose(async () => picked);
    await folder.write(ASSET, "original", bytes("whole"));
    await folder.write(ASSET, "preview", bytes("small"));
    await folder.write(ASSET, "poster", bytes("still"));
    expect(picked.names()).toEqual([".easyedit/abc123.poster.jpg", ".easyedit/abc123.preview.mp4", "My Shoot_ take 2 [abc123].mp4"]);
    expect([await textOf(await folder.read(ASSET, "original")), await textOf(await folder.read(ASSET, "preview")), await textOf(await folder.read(ASSET, "poster"))]).toEqual(["whole", "small", "still"]);
    await folder.remove(ASSET);
    expect(picked.names()).toEqual([]);
    await folder.remove(ASSET); // removing what is not there is no failure
  });
  it("finds the person's own file of the same name and size, so a folder of the original footage works as it is", async () => {
    const picked = fakeFolder();
    picked.files.set(ASSET.fileName, bytes("whole")); // 5 bytes, as the asset says
    picked.files.set("other.mp4", bytes("whole"));
    const folder = createLocalFolder(memory());
    await folder.choose(async () => picked);
    expect(await textOf(await folder.read(ASSET, "original"))).toBe("whole");
    expect(await folder.read({ ...ASSET, sizeBytes: 6 }, "original")).toBeNull(); // another file that only shares the name
    expect(await folder.read({ ...ASSET, fileName: "missing.mp4" }, "original")).toBeNull();
    expect(await folder.read(ASSET, "preview")).toBeNull();
  });
  it("a write that fails leaves no half file behind", async () => {
    const picked = fakeFolder();
    const folder = createLocalFolder(memory());
    await folder.choose(async () => picked);
    picked.failWrites = true;
    await expect(folder.write(ASSET, "original", bytes("whole"))).rejects.toThrow();
    expect(picked.names()).toEqual([]);
  });
});

describe("reading an editor's files", () => {
  const drive: MediaFiles = { get: vi.fn(async () => ({ ok: true as const, blob: bytes("from drive") })), put: vi.fn(async () => {}) };
  async function setup() {
    const picked = fakeFolder();
    const folder = createLocalFolder(memory());
    await folder.choose(async () => picked);
    const files = withLocalFiles(drive, folder, (id) => (id === ASSET.id ? ASSET : null));
    return { picked, folder, files };
  }
  it("takes a local id from the folder and everything else as before", async () => {
    const { folder, files } = await setup();
    await folder.write(ASSET, "original", bytes("whole"));
    const local = await files.get("local:abc123");
    expect(local.ok && (await local.blob.text())).toBe("whole");
    const other = await files.get("drive-file-1");
    expect(other.ok && (await other.blob.text())).toBe("from drive");
    expect(drive.get).toHaveBeenCalledTimes(1);
    await files.put("local:abc123:preview", bytes("x"));
    await files.put("drive-file-2", bytes("x"));
    expect(drive.put).toHaveBeenCalledTimes(1);
  });
  it("says missing for a file that is not on this computer, an asset it does not know, and a closed folder", async () => {
    const { folder, files } = await setup();
    expect(await files.get("local:abc123")).toEqual({ ok: false, problem: "missing" });
    expect(await files.get("local:unknown")).toEqual({ ok: false, problem: "missing" });
    await folder.write(ASSET, "original", bytes("whole"));
    await folder.forget();
    expect(await files.get("local:abc123")).toEqual({ ok: false, problem: "missing" });
  });
  it("plays the original where the preview copy was made on another computer", async () => {
    const { picked, files } = await setup();
    picked.files.set(ASSET.fileName, bytes("whole"));
    const preview = await files.get("local:abc123:preview");
    expect(preview.ok && (await preview.blob.text())).toBe("whole");
    expect(await files.get("local:abc123:poster")).toEqual({ ok: false, problem: "missing" });
  });
});

describe("which file a clip plays", () => {
  const local = (over = {}) => assetView({ originalFileId: "local:a", sizeBytes: 900_000_000, previewStatus: "pending", previewFileId: null, ...over });
  it("a video kept on this computer plays as it is while its preview copy is made, however large, and the copy once it is", () => {
    expect(playbackFileFor(local())).toEqual({ fileId: "local:a", from: "original" });
    expect(playbackFileFor(local({ previewStatus: "failed" }))).toEqual({ fileId: "local:a", from: "original" });
    expect(playbackFileFor(local({ previewStatus: "ready", previewFileId: "local:a:preview" }))).toEqual({ fileId: "local:a:preview", from: "preview" });
    // One in Drive still waits for its copy.
    expect(playbackFileFor(assetView({ originalFileId: "drive-1", sizeBytes: 900_000_000, previewStatus: "pending", previewFileId: null }))).toEqual({ fileId: null, why: "preparing" });
  });
});
