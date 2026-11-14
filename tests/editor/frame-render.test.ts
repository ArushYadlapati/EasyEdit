import { describe, expect, it, vi } from "vitest";
import { renderFrame, saveFrameRequest, type FrameCanvas, type FrameDeps } from "@/lib/editor/frame-render";
import { PROBE_BASE } from "@/lib/export/fonts";
import { planExportMedia } from "@/lib/export/media-sources";
import type { AssetView } from "@/lib/media/types";
import { PLACEHOLDER_FILL } from "@/lib/render/compositor";
import type { MediaClip } from "@/lib/timeline";
import { assetView } from "../helpers/media-services";
import { fakeCtx } from "../render/fake-ctx";
import { sampleDoc, video } from "./fixtures";

const lib = (assets: AssetView[] = [assetView()]) => ({ assets: Object.fromEntries(assets.map((a) => [a.id, a])), loaded: true });
const VIDEO_FRAME = { tag: "video frame" } as unknown as CanvasImageSource;
const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
const TALL = { width: 720, height: 1280 };

function setup(over: Partial<FrameDeps> = {}) {
  const made = fakeCtx();
  const encoded: [string, number | undefined][] = [];
  const closed: string[] = [];
  const canvas: FrameCanvas = { getContext: () => made.ctx, toBlob: (done, type, quality) => { encoded.push([type, quality]); done(PNG); } };
  const deps = {
    readFile: vi.fn(async (fileId: string) => new Blob([fileId])),
    decodeVideo: vi.fn(async () => ({ image: VIDEO_FRAME, width: 720, height: 1280 })),
    decodeImage: vi.fn(async () => ({ image: { close: () => closed.push("image") } as unknown as ImageBitmap, width: 400, height: 300 })),
    loadFonts: vi.fn(async () => {}),
    resolveFont: (f: string) => `"${f}"`,
    makeCanvas: vi.fn(() => canvas),
    ...over,
  } satisfies FrameDeps;
  return { deps, calls: made.calls, encoded, closed };
}

describe("which pictures a saved frame needs", () => {
  it("each clip under the frame that draws from a file, at its moment", () => {
    expect(saveFrameRequest(sampleDoc(), 45, TALL, planExportMedia(sampleDoc(), lib()))).toMatchObject({
      frame: 45, size: TALL, type: "image/png",
      sources: [{ clipId: "c2", kind: "video", fileId: "prev-a", seconds: 0.5, stillId: null }], // (0 + 15) / 30
    });
  });

  it("a clip whose media was removed draws the preview's placeholder, with its label", async () => {
    const request = saveFrameRequest(sampleDoc(), 10, TALL, planExportMedia(sampleDoc(), lib([assetView({ removed: true })])));
    expect(request.sources).toEqual([]);
    expect(request.placeholderLabel?.(video("c1", 0, 30) as MediaClip)).toBe("Media removed");
    const { deps, calls } = setup();
    expect(await renderFrame(sampleDoc(), request, deps)).toMatchObject({ kind: "picture" });
    expect(calls.some(([name, value]) => name === "fillText" && value === "Media removed")).toBe(true);
    expect(calls.some(([name, value]) => name === "set fillStyle" && value === PLACEHOLDER_FILL.video)).toBe(true);
  });
});

describe("drawing one frame", () => {
  it("draws the frame at the asked size and type, with each decoded picture, after its fonts load", async () => {
    const { deps, calls, encoded } = setup();
    const request = saveFrameRequest(sampleDoc(), 45, TALL, planExportMedia(sampleDoc(), lib()));
    expect(await renderFrame(sampleDoc(), request, deps)).toEqual({ kind: "picture", blob: PNG });
    expect(deps.makeCanvas).toHaveBeenCalledWith(720, 1280);
    expect(deps.readFile).toHaveBeenCalledWith("prev-a");
    expect(deps.decodeVideo).toHaveBeenCalledWith(expect.any(Blob), 0.5);
    expect(deps.loadFonts).toHaveBeenCalledWith([{ font: '700 100px "Geist"', text: `${PROBE_BASE}h` }]);
    expect(calls.filter(([name]) => name === "setTransform")).toEqual([["setTransform", 720 / 1080, 0, 0, 1280 / 1920, 0, 0]]);
    expect(calls.some(([name, first]) => name === "drawImage" && first === VIDEO_FRAME)).toBe(true);
    expect(encoded).toEqual([["image/png", undefined]]);
  });

  it("scales each axis on its own, so a rounded size is filled exactly", async () => {
    const { deps, calls } = setup();
    const page = { ...sampleDoc(), width: 816, height: 1056 };
    await renderFrame(page, { frame: 0, size: { width: 495, height: 640 }, sources: [], type: "image/jpeg", quality: 0.8 }, deps);
    expect(calls.filter(([name]) => name === "setTransform")).toEqual([["setTransform", 495 / 816, 0, 0, 640 / 1056, 0, 0]]);
  });

  it("names what failed: the canvas, a file that could not be read, or a picture that could not be decoded", async () => {
    const request = saveFrameRequest(sampleDoc(), 45, TALL, planExportMedia(sampleDoc(), lib()));
    expect(await renderFrame(sampleDoc(), request, setup({ readFile: vi.fn(async () => null) }).deps)).toEqual({ kind: "failed", why: "read" });
    expect(await renderFrame(sampleDoc(), request, setup({ decodeVideo: vi.fn(async () => null) }).deps)).toEqual({ kind: "failed", why: "decode" });
    const broken = setup({ makeCanvas: vi.fn(() => { throw new Error("no canvas"); }) });
    expect(await renderFrame(sampleDoc(), request, broken.deps)).toEqual({ kind: "failed", why: "canvas" });
    expect(broken.deps.readFile).not.toHaveBeenCalled();
  });

  it("a canvas that gives no picture, or an empty one, is a canvas failure", async () => {
    for (const blob of [null, new Blob([])]) {
      const { ctx } = fakeCtx();
      const { deps } = setup({ makeCanvas: vi.fn((): FrameCanvas => ({ getContext: () => ctx, toBlob: (done) => done(blob) })) });
      expect(await renderFrame(sampleDoc(), { frame: 0, size: TALL, sources: [], type: "image/png" }, deps)).toEqual({ kind: "failed", why: "canvas" });
    }
  });

  it("rejects when the fonts do not load, after closing every decoded picture", async () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("i1", 0, 30, { type: "image", assetId: "b" })];
    const image = assetView({ id: "b", kind: "image", originalFileId: "orig-b", previewStatus: "none", previewFileId: null });
    const request = saveFrameRequest(d, 10, { width: 1080, height: 1920 }, planExportMedia(d, lib([image])));
    const closed: string[] = [];
    // the image takes a turn of the event loop, so the font rejection lands while it is still decoding
    const slowImage = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { image: { close: () => closed.push("image") } as unknown as ImageBitmap, width: 400, height: 300 };
    });
    const { deps } = setup({ loadFonts: vi.fn(async () => { throw new Error("font"); }), decodeImage: slowImage });
    await expect(renderFrame(d, request, deps)).rejects.toThrow("font");
    expect(closed).toEqual(["image"]);
  });

  it("leaves no font rejection unhandled while the pictures decode", async () => {
    // Vitest forgives a rejection handled later, and a vi.fn handles its own result, so this listens for Node's own
    // report of it, and the fonts are loaded by a plain function.
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listen);
    try {
      const slowVideo = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { image: VIDEO_FRAME, width: 720, height: 1280 };
      });
      const { deps } = setup({ loadFonts: async () => { throw new Error("font"); }, decodeVideo: slowVideo });
      const request = saveFrameRequest(sampleDoc(), 45, TALL, planExportMedia(sampleDoc(), lib()));
      await expect(renderFrame(sampleDoc(), request, deps)).rejects.toThrow("font");
    } finally {
      process.off("unhandledRejection", listen);
    }
    expect(unhandled).toEqual([]);
  });
});
