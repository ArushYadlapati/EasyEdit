import { describe, expect, it } from "vitest";
import { gatherMedia, type ExportMediaDeps } from "@/lib/export/gather-media";
import type { AssetView } from "@/lib/media/types";
import { createEmptyDoc } from "@/lib/timeline";
import { sampleDoc, text, video } from "../editor/fixtures";
import { assetView } from "../helpers/media-services";
import { SONG, Z, soundDoc } from "./sound-fixtures";

function setup(assets: AssetView[] = [assetView()], over: Partial<ExportMediaDeps> = {}, loaded = true) {
  const order: string[] = [];
  const library = { assets: Object.fromEntries(assets.map((a) => [a.id, a])), loaded };
  const deps: ExportMediaDeps = {
    library: () => library,
    ensure: async (ids) => { order.push(`ensure ${ids.join(",")}`); },
    readFile: async (fileId) => { order.push(`read ${fileId}`); return new File([fileId], fileId); },
    ...over,
  };
  const reading: [number, number][] = [];
  const abort = new AbortController();
  const options = { signal: abort.signal, onReading: (filesRead: number, totalFiles: number) => reading.push([filesRead, totalFiles]), sound: true };
  return { deps, order, reading, abort, options };
}
const withImage = () => {
  const d = sampleDoc();
  d.tracks[0].clips[1] = video("c2", 30, 30, { type: "image", assetId: "b" });
  return d;
};
const IMAGE = assetView({ id: "b", kind: "image", originalFileId: "orig-b", previewStatus: "none", previewFileId: null });

describe("reading the media", () => {
  it("makes sure the library knows each asset, reads each file once, and says how far it has got", async () => {
    const { deps, order, reading, options } = setup();
    const media = await gatherMedia(sampleDoc(), deps, options);
    expect(order).toEqual(["ensure a", "read prev-a"]);
    expect(Object.keys(media.files)).toEqual(["prev-a"]);
    expect((media.files["prev-a"] as File).name).toBe("prev-a");
    expect(media.clips).toEqual({ c1: { fileId: "prev-a" }, c2: { fileId: "prev-a" } });
    expect(reading).toEqual([[0, 1], [1, 1]]);
  });

  it("reads the files in the order the timeline uses them", async () => {
    const { deps, order, reading, options } = setup([assetView(), IMAGE]);
    await gatherMedia(withImage(), deps, options);
    expect(order).toEqual(["ensure a,b", "read prev-a", "read orig-b"]);
    expect(reading).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it("a removed asset reads nothing and draws its placeholder", async () => {
    const { deps, order, options } = setup([assetView({ removed: true })]);
    expect(await gatherMedia(sampleDoc(), deps, options)).toEqual({ files: {}, clips: { c1: { label: "Media removed" }, c2: { label: "Media removed" } }, sounds: {} });
    expect(order).toEqual(["ensure a"]);
  });

  it("a project with no media reads nothing and says nothing", async () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[1].clips = [text("x1", 0, 30)];
    const { deps, order, reading, options } = setup();
    expect(await gatherMedia(d, deps, options)).toEqual({ files: {}, clips: {}, sounds: {} });
    expect([order, reading]).toEqual([[], []]);
  });
});

describe("what stops it", () => {
  it("refuses while media is uploading or being prepared", async () => {
    for (const asset of [assetView({ status: "uploading" }), assetView({ previewStatus: "pending" })]) {
      const { deps, order, options } = setup([asset]);
      await expect(gatherMedia(sampleDoc(), deps, options)).rejects.toMatchObject({ code: "waiting", detail: "c1" });
      expect(order).toEqual(["ensure a"]);
    }
  });

  it("an asset the library still does not know, before it ever loaded, is a media failure", async () => {
    const { deps, options } = setup([], {}, false);
    await expect(gatherMedia(sampleDoc(), deps, options)).rejects.toMatchObject({ code: "media", detail: "c1" });
    const offline = setup([], { ensure: async () => { throw new Error("offline"); } });
    await expect(gatherMedia(sampleDoc(), offline.deps, offline.options)).rejects.toMatchObject({ code: "media", detail: "offline" });
  });

  it("media being prepared is named before an asset the library does not know, whatever the drawing order", async () => {
    const d = sampleDoc();
    d.tracks[0].clips[0] = video("c1", 0, 30, { assetId: "z" });
    const { deps, options } = setup([assetView({ previewStatus: "pending" })], {}, false);
    await expect(gatherMedia(d, deps, options)).rejects.toMatchObject({ code: "waiting", detail: "c2" });
  });

  it("a file that cannot be read stops it, and nothing after it is read", async () => {
    const { deps, order, options } = setup([assetView(), IMAGE], {
      readFile: async (fileId) => { order.push(`read ${fileId}`); return null; },
    });
    await expect(gatherMedia(withImage(), deps, options)).rejects.toMatchObject({ code: "media", detail: "prev-a" });
    expect(order).toEqual(["ensure a,b", "read prev-a"]);
  });

  it("a cancel stops it between files", async () => {
    const run = setup([assetView(), IMAGE]);
    run.deps.readFile = async (fileId) => { run.abort.abort(); return new File([fileId], fileId); };
    await expect(gatherMedia(withImage(), run.deps, run.options)).rejects.toMatchObject({ name: "AbortError" });
    expect(run.reading).toEqual([[0, 2]]);
  });

  it("a cancel during the library check reads nothing", async () => {
    const run = setup();
    run.deps.ensure = async () => { run.abort.abort(); };
    await expect(gatherMedia(sampleDoc(), run.deps, run.options)).rejects.toMatchObject({ name: "AbortError" });
    expect([run.order, run.reading]).toEqual([[], []]);
  });
});

describe("reading the sound", () => {
  const SOUND_ASSETS = [assetView(), Z, SONG];

  it("reads each file once for its pictures and its sound: an audio clip's original and an invisible video's copy", async () => {
    const { deps, order, reading, options } = setup(SOUND_ASSETS);
    const media = await gatherMedia(soundDoc(), deps, options);
    expect(order).toEqual(["ensure a,z,song", "read prev-a", "read prev-z", "read orig-song"]);
    expect(media.sounds).toEqual({ c1: "prev-a", c2: "prev-a", c3: "prev-z", m1: "orig-song" });
    expect(media.clips).toEqual({ c1: { fileId: "prev-a" }, c2: { fileId: "prev-a" } });
    expect(reading.at(-1)).toEqual([3, 3]);
  });

  it("asks for, waits for and reads no sound when the file will have no sound track", async () => {
    const { deps, order, options } = setup([assetView(), Z, assetView({ ...SONG, status: "uploading" })]);
    const media = await gatherMedia(soundDoc(), deps, { ...options, sound: false });
    expect(order).toEqual(["ensure a", "read prev-a"]);
    expect(media.sounds).toEqual({});
  });

  it("refuses while sound media is uploading, and stops at a sound file that cannot be read", async () => {
    const waiting = setup([assetView(), Z, assetView({ ...SONG, status: "uploading" })]);
    await expect(gatherMedia(soundDoc(), waiting.deps, waiting.options)).rejects.toMatchObject({ code: "waiting", detail: "m1" });
    const unreadable = setup(SOUND_ASSETS, { readFile: async (fileId) => (fileId === "orig-song" ? null : new File([fileId], fileId)) });
    await expect(gatherMedia(soundDoc(), unreadable.deps, unreadable.options)).rejects.toMatchObject({ code: "media", detail: "orig-song" });
  });
});
