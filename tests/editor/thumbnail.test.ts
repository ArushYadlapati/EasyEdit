import { describe, expect, it, vi, type Mock } from "vitest";
import {
  THUMBNAIL_LONG_SIDE,
  THUMBNAIL_QUALITY,
  THUMBNAIL_SOURCE_MAX_SIDE,
  planThumbnail,
  renderThumbnail,
  thumbnailSize,
  type ThumbnailCanvas,
  type ThumbnailDeps,
} from "@/lib/editor/thumbnail";
import { PROBE_BASE } from "@/lib/export/fonts";
import type { AssetView } from "@/lib/media/types";
import { PLACEHOLDER_FILL, type Ctx2D, type ResolvedSource } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, createEmptyDoc, type TimelineDoc, type Track } from "@/lib/timeline";
import { assetView } from "../helpers/media-services";
import { fakeCtx, type Call } from "../render/fake-ctx";
import { sampleDoc, text, video } from "./fixtures";

const lib = (assets: Record<string, AssetView>, loaded = true) => ({ assets, loaded });
const track = (id: string, kind: Track["kind"], clips: Track["clips"] = []): Track =>
  ({ id, kind, name: id, muted: false, hidden: false, locked: false, clips });

// A 30 fps project with one video clip of asset "a" on v1: frames 0 to 30, so the thumbnail's frame is 15.
function oneVideo(): TimelineDoc {
  const d = createEmptyDoc("short_9x16");
  d.tracks[0].clips = [video("c1", 0, 30)];
  return d;
}

// Two video clips at 0, frames 0 to 30: one of asset first on v1, and one of asset second on a video track v2 after it.
function twoVideos(first: string, second: string): TimelineDoc {
  const d = createEmptyDoc("short_9x16");
  d.tracks[0].clips = [video("c1", 0, 30, { assetId: first })];
  d.tracks.splice(1, 0, track("v2", "video", [video("c2", 0, 30, { assetId: second })]));
  return d;
}

describe("planThumbnail", () => {
  it("draws the frame thumbnailFrame names, from each picture's playback file", () => {
    expect(planThumbnail(sampleDoc(), lib({ a: assetView() }))).toEqual({
      kind: "draw",
      frame: 15,
      sources: [{ clipId: "c1", kind: "video", fileId: "prev-a", seconds: 0.5, stillId: "post-a" }],
    });
  });

  it("a clip partway into its media asks for its exact second", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("c1", 90, 300, { in: 60, speed: 2 })];
    const plan = planThumbnail(d, lib({ a: assetView() }));
    expect(plan).toMatchObject({ kind: "draw", frame: 120, sources: [{ clipId: "c1", seconds: 4 }] });
  });

  it("an image plays its original", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("i1", 0, 30, { type: "image", assetId: "i" })];
    const image = assetView({ id: "i", kind: "image", originalFileId: "orig-i", previewStatus: "none", previewFileId: null, posterFileId: "post-i" });
    expect(planThumbnail(d, lib({ i: image }))).toEqual({
      kind: "draw",
      frame: 15,
      sources: [{ clipId: "i1", kind: "image", fileId: "orig-i", seconds: 0, stillId: "post-i" }],
    });
  });

  it("a video with no preview copy uses its still, and a small original plays as it is", () => {
    const large = assetView({ previewStatus: "failed", previewFileId: null, sizeBytes: 300 * 1024 * 1024 });
    expect(planThumbnail(oneVideo(), lib({ a: large }))).toMatchObject({
      kind: "draw",
      sources: [{ clipId: "c1", fileId: null, stillId: "post-a" }],
    });
    const small = assetView({ previewStatus: "failed", previewFileId: null, sizeBytes: 1000 });
    expect(planThumbnail(oneVideo(), lib({ a: small }))).toMatchObject({
      kind: "draw",
      sources: [{ clipId: "c1", fileId: "orig-a", stillId: "post-a" }],
    });
  });

  it("waits while media uploads, its preview is being made, or the library has not loaded", () => {
    expect(planThumbnail(oneVideo(), lib({ a: assetView({ status: "uploading" }) }))).toEqual({ kind: "wait" });
    expect(planThumbnail(oneVideo(), lib({ a: assetView({ previewStatus: "pending", previewFileId: null }) }))).toEqual({ kind: "wait" });
    expect(planThumbnail(oneVideo(), lib({}, false))).toEqual({ kind: "wait" });
  });

  it("skips a removed or missing asset, and one with neither a file nor a still", () => {
    expect(planThumbnail(oneVideo(), lib({ a: assetView({ removed: true }) }))).toEqual({ kind: "skip" });
    expect(planThumbnail(oneVideo(), lib({}))).toEqual({ kind: "skip" });
    const noStill = assetView({ previewStatus: "failed", previewFileId: null, sizeBytes: 300 * 1024 * 1024, posterFileId: null });
    expect(planThumbnail(oneVideo(), lib({ a: noStill }))).toEqual({ kind: "skip" });
    const assets = { u: assetView({ id: "u", status: "uploading" }), r: assetView({ id: "r", removed: true }) };
    expect(planThumbnail(twoVideos("u", "r"), lib(assets))).toEqual({ kind: "skip" });
    expect(planThumbnail(twoVideos("r", "u"), lib(assets))).toEqual({ kind: "skip" });
  });

  it("only clips under the frame count", () => {
    const d = sampleDoc();
    d.tracks[0].clips[1] = video("c2", 30, 30, { assetId: "b" });
    const plan = planThumbnail(d, lib({ a: assetView(), b: assetView({ id: "b", removed: true }) }));
    expect(plan).toMatchObject({ kind: "draw" });
  });

  // A video clip c1 of asset "a" at the given opacity on v1, and text x1 on t1, both frames 0 to 60: the frame is 30,
  // from x1, and c1 is under it.
  function clipUnderText(opacity: number): TimelineDoc {
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("c1", 0, 60, { transform: { ...DEFAULT_TRANSFORM, opacity } })];
    d.tracks[1].clips = [text("x1", 0, 60)];
    return d;
  }

  it("an invisible clip of a removed, unknown or uploading asset neither skips nor waits", () => {
    const invisible = clipUnderText(0);
    const drawn = { kind: "draw", frame: 30, sources: [] };
    expect(planThumbnail(invisible, lib({ a: assetView({ removed: true }) }))).toEqual(drawn);
    expect(planThumbnail(invisible, lib({}))).toEqual(drawn);
    expect(planThumbnail(invisible, lib({ a: assetView({ status: "uploading" }) }))).toEqual(drawn);
    expect(planThumbnail(invisible, lib({ a: assetView({ previewStatus: "pending", previewFileId: null }) }))).toEqual(drawn);
    expect(planThumbnail(invisible, lib({}, false))).toEqual(drawn);
  });

  it("a clip that shows at all, of a removed asset, still skips", () => {
    expect(planThumbnail(clipUnderText(0.5), lib({ a: assetView({ removed: true }) }))).toEqual({ kind: "skip" });
  });

  it("text alone needs no file", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks[1].clips = [text("x1", 0, 60)];
    expect(planThumbnail(d, lib({}))).toEqual({ kind: "draw", frame: 30, sources: [] });
  });

  it("each picture under the frame is a source, in the order the frame draws them", () => {
    const d = twoVideos("a", "i");
    d.tracks[1].clips = [video("c2", 0, 30, { type: "image", assetId: "i" })];
    const image = assetView({ id: "i", kind: "image", originalFileId: "orig-i", previewStatus: "none", previewFileId: null, posterFileId: "post-i" });
    const plan = planThumbnail(d, lib({ a: assetView(), i: image }));
    expect(plan).toMatchObject({ kind: "draw", sources: [{ clipId: "c1", kind: "video" }, { clipId: "c2", kind: "image" }] });
  });

  it("thumbnailSize keeps the shape at 640 on the long side", () => {
    expect(thumbnailSize({ width: 1080, height: 1920 })).toEqual({ width: 360, height: 640 });
    expect(thumbnailSize({ width: 1920, height: 1080 })).toEqual({ width: 640, height: 360 });
    expect(thumbnailSize({ width: 816, height: 1056 })).toEqual({ width: 495, height: 640 });
    expect(thumbnailSize({ width: 16, height: 16 })).toEqual({ width: 640, height: 640 });
    expect(thumbnailSize({ width: 4096, height: 2024 })).toEqual({ width: 640, height: 316 });
  });

  it("thumbnailSize never rounds a side to nothing", () => {
    expect(thumbnailSize({ width: 2000, height: 1 })).toEqual({ width: 640, height: 1 });
  });

  it("the picture's constants", () => {
    expect(THUMBNAIL_LONG_SIDE).toBe(640);
    expect(THUMBNAIL_QUALITY).toBe(0.8);
    expect(THUMBNAIL_SOURCE_MAX_SIDE).toBe(1280);
  });
});

const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
const VIDEO_FRAME = { tag: "video frame" } as unknown as CanvasImageSource;
const STILL = { tag: "still" } as unknown as CanvasImageSource;

type TestDeps = {
  library: ThumbnailDeps["library"];
  readFile: Mock<ThumbnailDeps["readFile"]>;
  decodeVideo: Mock<ThumbnailDeps["decodeVideo"]>;
  decodeImage: Mock<ThumbnailDeps["decodeImage"]>;
  loadFonts: Mock<ThumbnailDeps["loadFonts"]>;
  resolveFont: ThumbnailDeps["resolveFont"];
  makeCanvas: Mock<ThumbnailDeps["makeCanvas"]>;
};

// What the fake canvas recorded: every call on its context, and the arguments of each toBlob.
let calls: Call[] = [];
let encoded: [type: string, quality: number][] = [];

// A canvas whose context records its calls, and whose toBlob answers jpeg.
function fakeCanvas(jpeg: Blob | null = JPEG, ctx?: Ctx2D | null): ThumbnailCanvas {
  const made = fakeCtx();
  calls = made.calls;
  encoded = [];
  return {
    getContext: () => (ctx === undefined ? made.ctx : ctx),
    toBlob: (done, type, quality) => {
      encoded.push([type, quality]);
      done(jpeg);
    },
  };
}

function deps(over: Partial<TestDeps> = {}): TestDeps {
  calls = [];
  encoded = [];
  return {
    library: () => ({ assets: { a: assetView() }, loaded: true }),
    readFile: vi.fn(async (fileId: string) => new Blob([fileId])),
    decodeVideo: vi.fn(async () => ({ image: VIDEO_FRAME, width: 1280, height: 720 })),
    decodeImage: vi.fn(async () => ({ image: STILL, width: 1280, height: 720 })),
    loadFonts: vi.fn(async () => {}),
    resolveFont: (f) => `"${f}"`,
    makeCanvas: vi.fn(() => fakeCanvas()),
    ...over,
  };
}

const drew = (image: unknown) => calls.some(([name, first]) => name === "drawImage" && first === image);
const placeholderFill = () =>
  calls.some(([name, value]) => name === "set fillStyle" && (value === PLACEHOLDER_FILL.video || value === PLACEHOLDER_FILL.image));
const blobText = (value: unknown) => (value as Blob).text();

// An image clip of asset "i" at 0 on v1, frames 0 to 30.
function oneImage(): TimelineDoc {
  const d = createEmptyDoc("short_9x16");
  d.tracks[0].clips = [video("i1", 0, 30, { type: "image", assetId: "i" })];
  return d;
}
const imageAsset = () =>
  assetView({ id: "i", kind: "image", originalFileId: "orig-i", previewStatus: "none", previewFileId: null, posterFileId: "post-i" });
const bitmap = () => {
  const close = vi.fn();
  return { close, decoded: { image: { close } as unknown as CanvasImageSource, width: 800, height: 600 } };
};

describe("renderThumbnail", () => {
  it("draws one frame of the saved doc on a 360 × 640 canvas and encodes a JPEG at 0.8", async () => {
    const d = deps();
    expect(await renderThumbnail(sampleDoc(), d)).toEqual({ kind: "picture", jpeg: JPEG });
    expect(d.makeCanvas).toHaveBeenCalledWith(360, 640);
    expect(d.decodeVideo).toHaveBeenCalledTimes(1);
    expect(await blobText(d.decodeVideo.mock.calls[0][0])).toBe("prev-a");
    expect(d.decodeVideo.mock.calls[0][1]).toBe(0.5);
    expect(calls.filter(([name]) => name === "setTransform")).toEqual([["setTransform", 1 / 3, 0, 0, 1 / 3, 0, 0]]);
    expect(calls.filter(([name, ...args]) => name === "fillRect" && args.join() === "0,0,1080,1920")).toHaveLength(1);
    expect(drew(VIDEO_FRAME)).toBe(true);
    expect(calls.some(([name, value]) => name === "fillText" && value === "hi")).toBe(true);
    expect(placeholderFill()).toBe(false);
    expect(encoded).toEqual([["image/jpeg", 0.8]]);
  });

  it("waits for the text's fonts before drawing, and decodes meanwhile", async () => {
    let settle!: () => void;
    const d = deps({ loadFonts: vi.fn(() => new Promise<void>((resolve) => (settle = resolve))) });
    const done = renderThumbnail(sampleDoc(), d);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.loadFonts.mock.calls[0][0]).toEqual([{ font: '700 100px "Geist"', text: `${PROBE_BASE}h` }]);
    expect(d.decodeVideo).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    settle();
    expect(await done).toMatchObject({ kind: "picture" });
    expect(calls.some(([name]) => name === "fillText")).toBe(true);
  });

  it("an image is drawn from its original, and its bitmap is closed afterwards", async () => {
    const { close, decoded } = bitmap();
    const d = deps({ library: () => ({ assets: { i: imageAsset() }, loaded: true }), decodeImage: vi.fn(async () => decoded) });
    expect(await renderThumbnail(oneImage(), d)).toMatchObject({ kind: "picture" });
    expect(d.readFile).toHaveBeenCalledWith("orig-i");
    expect(drew(decoded.image)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a video that cannot be decoded is drawn from its library still", async () => {
    const failures: Array<() => Promise<ResolvedSource | null>> = [
      async () => null,
      async () => {
        throw new Error("no decoder");
      },
      async () => ({ image: VIDEO_FRAME, width: 0, height: 720 }),
      async () => ({ image: VIDEO_FRAME, width: 1280, height: 0 }),
    ];
    for (const failure of failures) {
      const d = deps({ decodeVideo: vi.fn(failure) });
      expect(await renderThumbnail(sampleDoc(), d)).toMatchObject({ kind: "picture" });
      expect(d.readFile).toHaveBeenCalledWith("post-a");
      expect(d.decodeImage).toHaveBeenCalledTimes(1);
      expect(await blobText(d.decodeImage.mock.calls[0][0])).toBe("post-a");
      expect(drew(STILL)).toBe(true);
      expect(drew(VIDEO_FRAME)).toBe(false);
    }
  });

  it("a file that cannot be read is drawn from its still", async () => {
    const d = deps({ readFile: vi.fn(async (fileId: string) => (fileId === "prev-a" ? null : new Blob([fileId]))) });
    expect(await renderThumbnail(sampleDoc(), d)).toMatchObject({ kind: "picture" });
    expect(d.decodeVideo).not.toHaveBeenCalled();
    expect(await blobText(d.decodeImage.mock.calls[0][0])).toBe("post-a");
    expect(drew(STILL)).toBe(true);
  });

  it("a video with no preview copy is drawn from its still", async () => {
    const d = deps({ library: () => ({ assets: { a: assetView({ previewStatus: "failed", sizeBytes: 300 * 1024 * 1024 }) }, loaded: true }) });
    expect(await renderThumbnail(sampleDoc(), d)).toMatchObject({ kind: "picture" });
    expect(d.readFile.mock.calls).toEqual([["post-a"]]);
    expect(d.decodeVideo).not.toHaveBeenCalled();
    expect(calls.some(([name, value]) => name === "set fillStyle" && value === PLACEHOLDER_FILL.video)).toBe(false);
  });

  it("with no still to fall back on, nothing is encoded", async () => {
    const d = deps({
      library: () => ({ assets: { a: assetView({ posterFileId: null }) }, loaded: true }),
      decodeVideo: vi.fn(async () => null),
    });
    expect(await renderThumbnail(sampleDoc(), d)).toEqual({ kind: "skip" });
    expect(encoded).toEqual([]);
  });

  it("a clip whose file and still cannot be read skips the capture", async () => {
    const d = deps({ readFile: vi.fn(async () => null) });
    expect(await renderThumbnail(sampleDoc(), d)).toEqual({ kind: "skip" });
  });

  it("a skipped capture still closes what it decoded", async () => {
    const doc = oneImage();
    doc.tracks.splice(1, 0, track("v2", "video", [video("c2", 0, 30)]));
    const { close, decoded } = bitmap();
    const d = deps({
      library: () => ({ assets: { i: imageAsset(), a: assetView({ posterFileId: null }) }, loaded: true }),
      decodeImage: vi.fn(async () => decoded),
      decodeVideo: vi.fn(async () => null),
    });
    expect(await renderThumbnail(doc, d)).toEqual({ kind: "skip" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a bitmap is closed when drawing throws", async () => {
    const { close, decoded } = bitmap();
    const { ctx } = fakeCtx();
    const throwing = new Proxy(ctx, {
      get: (target, key) =>
        key === "drawImage"
          ? () => {
              throw new Error("draw failed");
            }
          : Reflect.get(target, key),
    });
    const d = deps({
      library: () => ({ assets: { i: imageAsset() }, loaded: true }),
      decodeImage: vi.fn(async () => decoded),
      makeCanvas: vi.fn(() => fakeCanvas(JPEG, throwing)),
    });
    await expect(renderThumbnail(oneImage(), d)).rejects.toThrow("draw failed");
    expect(close).toHaveBeenCalledTimes(1);
    expect(encoded).toEqual([]);
  });

  it("a capture that stops being current reads no further file", async () => {
    let current = true;
    const d = deps({
      readFile: vi.fn(async (fileId: string) => {
        current = false;
        return new Blob([fileId]);
      }),
    });
    expect(await renderThumbnail(sampleDoc(), d, () => current)).toEqual({ kind: "stopped" });
    expect(d.readFile).toHaveBeenCalledTimes(1);
    expect(d.decodeVideo).not.toHaveBeenCalled();
    expect(drew(VIDEO_FRAME)).toBe(false);
    expect(calls.some(([name]) => name === "drawImage")).toBe(false);
    expect(encoded).toEqual([]);

    const never = deps();
    expect(await renderThumbnail(sampleDoc(), never, () => false)).toEqual({ kind: "stopped" });
    expect(never.readFile).not.toHaveBeenCalled();
  });

  it("the sources decode one after another, and a skip decodes nothing more", async () => {
    // A video of asset "a" on v1, then an image of asset "i" on v2, both at 0.
    const doc = oneVideo();
    doc.tracks.splice(1, 0, track("v2", "video", [video("i1", 0, 30, { type: "image", assetId: "i" })]));
    const library = () => ({ assets: { a: assetView(), i: imageAsset() }, loaded: true });
    let decodedVideo!: (value: ResolvedSource | null) => void;
    const d = deps({ library, decodeVideo: vi.fn(() => new Promise<ResolvedSource | null>((resolve) => (decodedVideo = resolve))) });
    const done = renderThumbnail(doc, d);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.readFile.mock.calls).toEqual([["prev-a"]]);
    decodedVideo({ image: VIDEO_FRAME, width: 1280, height: 720 });
    expect(await done).toMatchObject({ kind: "picture" });
    expect(d.readFile.mock.calls).toEqual([["prev-a"], ["orig-i"]]);

    const noStill = () => ({ assets: { a: assetView({ posterFileId: null }), i: imageAsset() }, loaded: true });
    const skipped = deps({ library: noStill, decodeVideo: vi.fn(async () => null) });
    expect(await renderThumbnail(doc, skipped)).toEqual({ kind: "skip" });
    expect(skipped.readFile.mock.calls).toEqual([["prev-a"]]);
    expect(skipped.decodeImage).not.toHaveBeenCalled();
  });

  it("a still, and a decode with no size, are closed too", async () => {
    const closeFrame = vi.fn();
    const { close, decoded } = bitmap();
    const d = deps({
      decodeVideo: vi.fn(async () => ({ image: { close: closeFrame } as unknown as CanvasImageSource, width: 0, height: 720 })),
      decodeImage: vi.fn(async () => decoded),
    });
    expect(await renderThumbnail(sampleDoc(), d)).toMatchObject({ kind: "picture" });
    expect(drew(decoded.image)).toBe(true);
    expect(closeFrame).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a stopped capture closes what it decoded", async () => {
    const doc = oneImage();
    doc.tracks.splice(1, 0, track("v2", "video", [video("c2", 0, 30)]));
    let current = true;
    const { close, decoded } = bitmap();
    const d = deps({
      library: () => ({ assets: { i: imageAsset(), a: assetView() }, loaded: true }),
      decodeImage: vi.fn(async () => {
        current = false;
        return decoded;
      }),
    });
    expect(await renderThumbnail(doc, d, () => current)).toEqual({ kind: "stopped" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(d.readFile.mock.calls).toEqual([["orig-i"]]);
  });

  it("a capture stops before drawing, and before encoding", async () => {
    const textOnly = createEmptyDoc("short_9x16");
    textOnly.tracks[1].clips = [text("x1", 0, 60)];
    const d = deps();
    expect(await renderThumbnail(textOnly, d, () => false)).toEqual({ kind: "stopped" });
    expect(calls).toEqual([]);

    let asked = 0;
    const late = deps();
    expect(await renderThumbnail(textOnly, late, () => ++asked < 2)).toEqual({ kind: "stopped" });
    expect(calls.some(([name]) => name === "fillText")).toBe(true);
    expect(encoded).toEqual([]);
  });

  it("a capture stops on the way to a still too", async () => {
    const noPreview = () => ({ assets: { a: assetView({ previewStatus: "failed", sizeBytes: 300 * 1024 * 1024 }) }, loaded: true });
    const d = deps({ library: noPreview });
    expect(await renderThumbnail(sampleDoc(), d, () => false)).toEqual({ kind: "stopped" });
    expect(d.readFile).not.toHaveBeenCalled();

    let current = true;
    const read = deps({
      library: noPreview,
      readFile: vi.fn(async (fileId: string) => {
        current = false;
        return new Blob([fileId]);
      }),
    });
    expect(await renderThumbnail(sampleDoc(), read, () => current)).toEqual({ kind: "stopped" });
    expect(read.readFile.mock.calls).toEqual([["post-a"]]);
    expect(read.decodeImage).not.toHaveBeenCalled();
  });

  it("waits or skips before making a canvas", async () => {
    for (const [asset, kind] of [
      [assetView({ status: "uploading" }), "wait"],
      [assetView({ removed: true }), "skip"],
    ] as const) {
      const d = deps({ library: () => ({ assets: { a: asset }, loaded: true }) });
      expect(await renderThumbnail(sampleDoc(), d)).toEqual({ kind });
      expect(d.makeCanvas).not.toHaveBeenCalled();
      expect(d.readFile).not.toHaveBeenCalled();
      expect(d.loadFonts).not.toHaveBeenCalled();
    }
  });

  it("without a 2D context nothing is read or drawn", async () => {
    const throwingContext: ThumbnailCanvas = {
      getContext: () => {
        throw new Error("no canvas");
      },
      toBlob: (done) => done(JPEG),
    };
    for (const canvas of [() => fakeCanvas(JPEG, null), () => throwingContext]) {
      const d = deps({ makeCanvas: vi.fn(canvas) });
      expect(await renderThumbnail(sampleDoc(), d)).toEqual({ kind: "skip" });
      expect(d.readFile).not.toHaveBeenCalled();
      expect(d.loadFonts).not.toHaveBeenCalled();
    }
  });

  it("an empty or missing JPEG is never returned", async () => {
    for (const jpeg of [new Blob([]), null]) {
      const d = deps({ makeCanvas: vi.fn(() => fakeCanvas(jpeg)) });
      expect(await renderThumbnail(sampleDoc(), d)).toEqual({ kind: "skip" });
    }
  });

  it("a project with nothing showing is drawn black", async () => {
    const d = deps();
    expect(await renderThumbnail(createEmptyDoc("long_16x9"), d)).toMatchObject({ kind: "picture" });
    expect(d.makeCanvas).toHaveBeenCalledWith(640, 360);
    expect(calls).toContainEqual(["set fillStyle", "#000000"]);
    expect(calls).toContainEqual(["fillRect", 0, 0, 1920, 1080]);
    expect(d.readFile).not.toHaveBeenCalled();
  });
});
