// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFonts } from "@/components/editor/page-fonts";
import { browserThumbnailDeps } from "@/components/editor/thumbnail-deps";
import { renderThumbnail } from "@/lib/editor/thumbnail";
import { sampleDoc } from "../editor/fixtures";
import { assetView, pretendMediaServices } from "../helpers/media-services";

// happy-dom has no WebCodecs: here every video fails to open.
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  CanvasSink: class {},
  Input: class {
    constructor() {
      throw new Error("no decoder");
    }
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browserThumbnailDeps", () => {
  it("in a page without a 2D canvas a capture reads no file and makes no picture", async () => {
    const media = pretendMediaServices([assetView()]);
    const get = vi.spyOn(media.files, "get");
    expect(await renderThumbnail(sampleDoc(), browserThumbnailDeps(media))).toEqual({ kind: "skip" });
    expect(get).not.toHaveBeenCalled();
  });

  it("readFile gives the blob, or null when the file cannot be read", async () => {
    const media = pretendMediaServices([assetView()]);
    const blob = new Blob(["frame"]);
    vi.spyOn(media.files, "get").mockResolvedValueOnce({ ok: true, blob }).mockResolvedValueOnce({ ok: false, problem: "offline" });
    const deps = browserThumbnailDeps(media);
    expect(await deps.readFile("prev-a")).toBe(blob);
    expect(await deps.readFile("prev-a")).toBeNull();
  });

  it("the library and the fonts are the page's", () => {
    const media = pretendMediaServices([assetView()]);
    const deps = browserThumbnailDeps(media);
    expect(deps.library()).toBe(media.library.getState());
    document.documentElement.style.setProperty("--font-geist-sans", "GeistLoaded");
    try {
      expect(browserThumbnailDeps(media).resolveFont("Geist")).toBe("GeistLoaded");
    } finally {
      document.documentElement.style.removeProperty("--font-geist-sans");
    }
  });

  it("a decode that throws answers null", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.reject(new Error("not an image"))));
    const deps = browserThumbnailDeps(pretendMediaServices([]));
    expect(await deps.decodeImage(new Blob(["x"]))).toBeNull();
    expect(await deps.decodeVideo(new Blob(["x"]), 0.5)).toBeNull();
  });

  it("the canvas is detached and sized", () => {
    const canvas = browserThumbnailDeps(pretendMediaServices([])).makeCanvas(360, 640);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    const element = canvas as HTMLCanvasElement;
    expect(element.width).toBe(360);
    expect(element.height).toBe(640);
    expect(element.isConnected).toBe(false);
  });
});

describe("loadFonts", () => {
  it("loadFonts settles without document.fonts, and when a face fails", async () => {
    expect("fonts" in document).toBe(false);
    await expect(loadFonts(['700 16px "Geist"'])).resolves.toBeUndefined();
    const load = vi.fn(() => Promise.reject(new Error("x")));
    Object.defineProperty(document, "fonts", { configurable: true, value: { load } });
    try {
      await expect(loadFonts(['700 16px "Geist"'])).resolves.toBeUndefined();
      expect(load).toHaveBeenCalledWith('700 16px "Geist"');
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });
});
