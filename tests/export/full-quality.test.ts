import { describe, expect, it } from "vitest";
import { gatherMedia, type ExportMediaDeps } from "@/lib/export/gather-media";
import { planExportMedia } from "@/lib/export/media-sources";
import type { AssetView } from "@/lib/media/types";
import { sampleDoc, video } from "../editor/fixtures";
import { assetView } from "../helpers/media-services";

// The sample project draws c1 and c2 from asset "a", whose preview copy is "prev-a" and whose original is "orig-a".
const A = assetView();
const IMAGE = assetView({ id: "b", kind: "image", originalFileId: "orig-b", previewStatus: "none", previewFileId: null });

function setup(assets: AssetView[] = [A], over: Partial<ExportMediaDeps> = {}) {
  const order: string[] = [];
  const library = { assets: Object.fromEntries(assets.map((a) => [a.id, a])), loaded: true };
  const deps: ExportMediaDeps = {
    library: () => library,
    ensure: async () => {},
    readFile: async (fileId) => {
      order.push(`read ${fileId}`);
      return new File([fileId], fileId);
    },
    ...over,
  };
  const options = (sound = false) => ({ signal: new AbortController().signal, onReading: () => {}, sound, originals: true });
  return { deps, order, library, options };
}

describe("planning a full-quality export", () => {
  it("draws each video from its original, with its copy to fall back on", () => {
    const { library } = setup();
    expect(A.originalFileId).toBe("orig-a");
    const plan = planExportMedia(sampleDoc(), library, false, true);
    expect(plan.clips.c1).toEqual({ kind: "use", fileId: "orig-a", from: "original", fallback: "prev-a" });
    expect(plan.fileIds).toEqual(["orig-a"]);
    // Without it, nothing changes.
    expect(planExportMedia(sampleDoc(), library).clips.c1).toEqual({ kind: "use", fileId: "prev-a", from: "preview" });
  });

  it("leaves images and sound on the files they already use", () => {
    const d = sampleDoc();
    d.tracks[0].clips[1] = video("c2", 30, 30, { type: "image", assetId: "b" });
    const { library } = setup([A, IMAGE]);
    const plan = planExportMedia(d, library, true, true);
    expect(plan.clips.c2).toEqual({ kind: "use", fileId: "orig-b", from: "original" });
    // c1's sound still comes from the copy the editor plays, which is read beside its original.
    expect(plan.sounds.c1).toEqual({ kind: "use", fileId: "prev-a", from: "preview" });
    expect(plan.fileIds).toEqual(["orig-a", "orig-b", "prev-a"]);
  });

  it("a video with no copy, or one still being made, is planned as it always was", () => {
    const direct = assetView({ previewStatus: "none", previewFileId: null });
    expect(planExportMedia(sampleDoc(), setup([direct]).library, false, true).clips.c1).toEqual({ kind: "use", fileId: "orig-a", from: "original" });
    const pending = assetView({ previewStatus: "pending", previewFileId: null });
    expect(planExportMedia(sampleDoc(), setup([pending]).library, false, true).clips.c1).toEqual({ kind: "wait", why: "preparing" });
  });
});

describe("reading a full-quality export's media", () => {
  it("reads the originals and tells the worker to draw from them", async () => {
    const { deps, order, options } = setup();
    const media = await gatherMedia(sampleDoc(), deps, options());
    expect(order).toEqual(["read orig-a"]);
    expect(media.clips).toEqual({ c1: { fileId: "orig-a" }, c2: { fileId: "orig-a" } });
    expect(Object.keys(media.files)).toEqual(["orig-a"]);
  });

  it("an original this browser cannot draw exports from its copy instead", async () => {
    const { deps, order, options } = setup([A], { decodable: async () => false });
    const media = await gatherMedia(sampleDoc(), deps, options());
    expect(order).toEqual(["read orig-a", "read prev-a"]);
    expect(media.clips).toEqual({ c1: { fileId: "prev-a" }, c2: { fileId: "prev-a" } });
    expect(Object.keys(media.files)).toEqual(["prev-a"]); // the original is not sent to the worker
  });

  it("an original that cannot be read at all falls back the same way, and only it", async () => {
    const d = sampleDoc();
    d.tracks[0].clips[1] = video("c2", 30, 30, { assetId: "z" });
    const Z = assetView({ id: "z", originalFileId: "orig-z", previewFileId: "prev-z" });
    const order: string[] = [];
    const { deps, options } = setup([A, Z], {
      readFile: async (fileId) => {
        order.push(`read ${fileId}`);
        return fileId === "orig-a" ? null : new File([fileId], fileId);
      },
    });
    const media = await gatherMedia(d, deps, options());
    expect(media.clips).toEqual({ c1: { fileId: "prev-a" }, c2: { fileId: "orig-z" } });
    expect(order).toEqual(["read orig-a", "read prev-a", "read orig-z"]);
  });

  it("the copy is read once when the sound needs it too", async () => {
    const { deps, order, options } = setup([A], { decodable: async () => false });
    const media = await gatherMedia(sampleDoc(), deps, options(true));
    expect(order).toEqual(["read orig-a", "read prev-a"]);
    expect(media.sounds).toEqual({ c1: "prev-a", c2: "prev-a" });
    expect(Object.keys(media.files)).toEqual(["prev-a"]);
  });

  it("a copy that cannot be read either stops the export, as any unreadable file does", async () => {
    const { deps, options } = setup([A], { readFile: async () => null });
    await expect(gatherMedia(sampleDoc(), deps, options())).rejects.toMatchObject({ code: "media" });
  });

  it("without full quality the originals are never asked about", async () => {
    let asked = 0;
    const { deps, order } = setup([A], { decodable: async () => (asked += 1) > 0 });
    await gatherMedia(sampleDoc(), deps, { signal: new AbortController().signal, onReading: () => {}, sound: false });
    expect(order).toEqual(["read prev-a"]);
    expect(asked).toBe(0);
  });
});

describe("how many bits the picture gets", () => {
  it("is the standard for its size unless more or fewer are asked for, and never past what the format allows", async () => {
    const { EXPORT_QUALITIES, videoSettings } = await import("@/lib/export/presets");
    const size = { width: 1080, height: 1920 };
    expect(EXPORT_QUALITIES.map((q) => [q.id, q.label])).toEqual([["small", "Smaller file"], ["standard", "Standard"], ["high", "High"]]);
    expect(videoSettings(size, 30)!.bitrate).toBe(8_000_000);
    expect(videoSettings(size, 30, "standard")).toEqual(videoSettings(size, 30));
    expect(videoSettings(size, 30, "small")!.bitrate).toBe(4_000_000);
    expect(videoSettings(size, 30, "high")!.bitrate).toBe(12_800_000);
    // Only the bitrate changes.
    expect({ ...videoSettings(size, 30, "high"), bitrate: 0 }).toEqual({ ...videoSettings(size, 30), bitrate: 0 });
    // 720p's level allows 17.5 Mbit/s: high stays under it.
    expect(videoSettings({ width: 1280, height: 720 }, 30, "high")!.bitrate).toBe(4_000_000);
    // A 60 fps project picks the level that fits it.
    expect(videoSettings(size, 60, "high")).toMatchObject({ fps: 60, bitrate: 12_800_000 });
  });
});
