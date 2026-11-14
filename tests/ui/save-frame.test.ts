// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { exportMediaDeps } from "@/components/editor/export/browser-deps";
import { savePageFrame, type SaveFrameIO } from "@/components/editor/export/save-frame";
import type { MediaFiles } from "@/lib/media/media-files";
import type { AssetView } from "@/lib/media/types";
import type { Clip } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";
import { assetView, pretendMediaServices, unreachableLibrary } from "../helpers/media-services";
import { fakeCtx } from "../render/fake-ctx";

const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
const TALL = { width: 1080, height: 1920 };
const NAME = "Qual recap frame 000045.png";

function setup(assets: AssetView[] = [assetView()], over: Partial<SaveFrameIO> = {}, get?: MediaFiles["get"]) {
  const services = pretendMediaServices(assets);
  services.files = { get: get ?? (async (fileId) => ({ ok: true, blob: new File([fileId], fileId) })), put: async () => {} };
  const io = {
    decodeVideoFrame: vi.fn(async () => ({ image: {} as CanvasImageSource, width: 720, height: 1280 })),
    decodeImage: vi.fn(async () => ({ image: { close() {} } as unknown as ImageBitmap, width: 400, height: 300 })),
    loadFonts: vi.fn(async () => {}),
    makeCanvas: vi.fn(() => ({ getContext: () => fakeCtx().ctx, toBlob: (done: (blob: Blob | null) => void) => done(PNG) })),
    download: vi.fn(),
    ...over,
  } satisfies SaveFrameIO;
  return { save: savePageFrame(exportMediaDeps(services), io), io };
}

describe("saving a frame from the page", () => {
  it("decodes each picture at the size asked for, and saves the PNG under the name given", async () => {
    const { save, io } = setup();
    await save(sampleDoc(), 45, TALL, NAME);
    expect(io.decodeVideoFrame).toHaveBeenCalledWith(expect.any(Blob), 0.5, 1920);
    expect(io.makeCanvas).toHaveBeenCalledWith(1080, 1920);
    expect(io.loadFonts).toHaveBeenCalledTimes(1);
    expect(io.download).toHaveBeenCalledWith(PNG, NAME);
  });

  it.each([
    ["a picture that cannot be decoded", { decodeVideoFrame: vi.fn(async () => null) }, "decode"],
    ["a decoder that throws", { decodeVideoFrame: vi.fn(async () => { throw new Error("bad"); }) }, "decode"],
    ["no canvas", { makeCanvas: vi.fn(() => { throw new Error("no canvas"); }) }, "unknown"],
    ["a font that does not load", { loadFonts: vi.fn(async () => { throw new Error("font"); }) }, "font"],
  ] as const)("names what stopped it: %s", async (_name, over, code) => {
    const { save, io } = setup([assetView()], over as Partial<SaveFrameIO>);
    await expect(save(sampleDoc(), 45, TALL, NAME)).rejects.toMatchObject({ name: "ExportError", code });
    expect(io.download).not.toHaveBeenCalled();
  });

  it("refuses while media waits, and when a file or the library cannot be read", async () => {
    await expect(setup([assetView({ status: "uploading" })]).save(sampleDoc(), 45, TALL, NAME)).rejects.toMatchObject({ code: "waiting" });
    const offline = setup([assetView()], {}, async () => ({ ok: false, problem: "offline" }));
    await expect(offline.save(sampleDoc(), 45, TALL, NAME)).rejects.toMatchObject({ code: "media" });
    const unasked = savePageFrame(exportMediaDeps({ ...pretendMediaServices([]), library: unreachableLibrary() }), setup().io);
    await expect(unasked(sampleDoc(), 45, TALL, NAME)).rejects.toMatchObject({ code: "media" });
  });
});

// Beyond the brief: rules the tests above do not catch when they are removed.
describe("saving a frame from the page: what it draws with", () => {
  it("decodes an image no larger than the frame's long side, and draws the text in the page's fonts", async () => {
    const doc = sampleDoc();
    doc.tracks[0].clips = [video("c1", 0, 120, { type: "image", assetId: "i" }) as Clip];
    const { ctx, calls } = fakeCtx();
    const { save, io } = setup([assetView({ id: "i", kind: "image", originalFileId: "orig-i" })], {
      makeCanvas: vi.fn(() => ({ getContext: () => ctx, toBlob: (done: (blob: Blob | null) => void) => done(PNG) })),
    });
    document.documentElement.style.setProperty("--font-geist-sans", "GeistLoaded");
    try {
      await save(doc, 45, TALL, NAME);
    } finally {
      document.documentElement.style.removeProperty("--font-geist-sans");
    }
    expect(io.decodeImage).toHaveBeenCalledWith(expect.any(Blob), 1920);
    expect(calls.some(([name, value]) => name === "set font" && String(value).includes("GeistLoaded"))).toBe(true);
    expect(io.download).toHaveBeenCalledWith(PNG, NAME);
  });

  it("calls a fault while drawing no font failure", async () => {
    const broken = new Proxy(fakeCtx().ctx, {
      get: (target, key) => (key === "fillRect" ? () => { throw new Error("draw"); } : Reflect.get(target, key)),
    });
    const { save, io } = setup([assetView()], {
      makeCanvas: vi.fn(() => ({ getContext: () => broken, toBlob: (done: (blob: Blob | null) => void) => done(PNG) })),
    });
    await expect(save(sampleDoc(), 45, TALL, NAME)).rejects.toMatchObject({ name: "ExportError", code: "unknown" });
    expect(io.download).not.toHaveBeenCalled();
  });
});
