import { describe, expect, it, vi } from "vitest";
import { stripPlan } from "@/components/editor/media/make-looks";
import type { Peaks } from "@/lib/audio/peaks";
import { clipSpanSeconds, createClipLooks, stripGone, stripTiles, type Strip } from "@/lib/media/clip-looks";
import type { MediaFiles } from "@/lib/media/media-files";
import { DEFAULT_TRANSFORM, type MediaClip } from "@/lib/timeline";

const strip = (extra: Partial<Strip> = {}): Strip => ({ image: {} as CanvasImageSource, tiles: 10, columns: 5, tileWidth: 114, tileHeight: 64, first: 0, every: 1, ...extra });
const peaks: Peaks = { perSecond: 50, values: Uint8Array.of(1, 2, 3) };
const clip = (extra: Partial<MediaClip> = {}): MediaClip =>
  ({ id: "c", type: "video", assetId: "a", start: 0, duration: 300, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, ...extra });

// Files that are read when the test says so, and makers that record what they were asked for.
function setup() {
  const waiting = new Map<string, (ok: boolean) => void>();
  const files: MediaFiles = {
    get: (fileId) => new Promise((resolve) => waiting.set(fileId, (ok) => resolve(ok ? { ok: true, blob: new Blob([fileId]) } : { ok: false, problem: "gone" as never }))),
    put: async () => {},
  };
  const made: string[] = [];
  const dropped: Strip[] = [];
  const makeStrip = vi.fn(async (blob: Blob): Promise<Strip | null> => {
    made.push(`strip:${await blob.text()}`);
    return strip();
  });
  const makePeaks = vi.fn(async (blob: Blob) => {
    made.push(`peaks:${await blob.text()}`);
    return peaks;
  });
  const looks = createClipLooks({ files, makeStrip, makePeaks, dropStrip: (s) => dropped.push(s) });
  const changes = vi.fn();
  looks.subscribe(changes);
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const read = async (fileId: string, ok = true) => {
    waiting.get(fileId)?.(ok);
    waiting.delete(fileId);
    await settle();
  };
  return { looks, made, dropped, changes, read, settle, waiting, makeStrip, makePeaks };
}

describe("the looks clips share", () => {
  it("makes a strip once however many clips hold it, and says when it is here", async () => {
    const t = setup();
    t.looks.hold("f1", "strip");
    t.looks.hold("f1", "strip");
    expect(t.looks.strip("f1")).toBeNull();
    await t.read("f1");
    expect(t.made).toEqual(["strip:f1"]);
    expect(t.looks.strip("f1")).toMatchObject({ tiles: 10 });
    expect(t.changes).toHaveBeenCalledTimes(1);
  });

  it("works on one file at a time, in the order asked", async () => {
    const t = setup();
    t.looks.hold("f1", "strip");
    t.looks.hold("f2", "peaks");
    t.looks.hold("f3", "strip");
    await t.settle();
    expect([...t.waiting.keys()]).toEqual(["f1"]); // f2 and f3 are not even read yet
    await t.read("f1");
    expect([...t.waiting.keys()]).toEqual(["f2"]);
    await t.read("f2");
    await t.read("f3");
    expect(t.made).toEqual(["strip:f1", "peaks:f2", "strip:f3"]);
    expect(t.looks.peaks("f2")).toBe(peaks);
  });

  it("frees a strip when its last clip lets go, and makes it again when asked again", async () => {
    const t = setup();
    const a = t.looks.hold("f1", "strip");
    const b = t.looks.hold("f1", "strip");
    await t.read("f1");
    a();
    a(); // letting go twice counts once
    expect(t.looks.strip("f1")).not.toBeNull();
    b();
    expect(t.looks.strip("f1")).toBeNull();
    expect(t.dropped).toHaveLength(1);
    t.looks.hold("f1", "strip");
    await t.read("f1");
    expect(t.made).toEqual(["strip:f1", "strip:f1"]);
  });

  it("keeps peaks once made, since they are small", async () => {
    const t = setup();
    const let_go = t.looks.hold("f1", "peaks");
    await t.read("f1");
    let_go();
    expect(t.looks.peaks("f1")).toBe(peaks);
    t.looks.hold("f1", "peaks");
    await t.settle();
    expect(t.made).toEqual(["peaks:f1"]);
  });

  it("skips a file let go of before its turn, and frees one let go of while it was made", async () => {
    const t = setup();
    t.looks.hold("f1", "strip");
    const second = t.looks.hold("f2", "strip");
    await t.settle();
    second();
    const first = [...t.waiting.keys()];
    expect(first).toEqual(["f1"]);
    await t.read("f1");
    expect(t.waiting.size).toBe(0); // f2 was never read
    const third = t.looks.hold("f3", "strip");
    await t.settle();
    third();
    await t.read("f3");
    expect(t.looks.strip("f3")).toBeNull();
    expect(t.dropped).toHaveLength(1);
  });

  it("a file that cannot be read or made gives nothing, and the next one still gets its turn", async () => {
    const t = setup();
    t.makeStrip.mockResolvedValueOnce(null);
    t.looks.hold("f1", "strip");
    t.looks.hold("f2", "strip");
    t.looks.hold("f3", "strip");
    await t.read("f1", false);
    await t.read("f2"); // made as nothing
    await t.read("f3");
    expect([t.looks.strip("f1"), t.looks.strip("f2")]).toEqual([null, null]);
    expect(t.looks.strip("f3")).not.toBeNull();
    expect(t.changes).toHaveBeenCalledTimes(1);
  });
});

describe("a strip that was let go of", () => {
  it("is known by its emptied picture, so a clip that still has it draws nothing instead of failing", () => {
    // What freeing does to the strip's canvas in the browser (dropStrip in make-looks.ts).
    const canvas = { width: 570, height: 128 };
    const kept = strip({ image: canvas as unknown as CanvasImageSource });
    expect(stripGone(kept)).toBe(false);
    canvas.width = canvas.height = 0;
    expect(stripGone(kept)).toBe(true);
  });

  it("is what a split's wide piece is left holding for one drawing when its narrow piece lets go first", async () => {
    // One clip holds the file's strip. A split redraws both pieces: the wide piece reads the strip, then the piece
    // now too narrow for one lets go (the only hold), which frees it, and only then does the wide piece take hold.
    const canvas = { width: 570, height: 128 };
    const t = setup();
    t.makeStrip.mockImplementationOnce(async () => strip({ image: canvas as unknown as CanvasImageSource }));
    const looks = createClipLooks({ files: { get: async () => ({ ok: true, blob: new Blob(["f1"]) }), put: async () => {} }, makeStrip: t.makeStrip, makePeaks: t.makePeaks, dropStrip: (s) => Object.assign(s.image, { width: 0, height: 0 }) });
    const narrowLetsGo = looks.hold("f1", "strip");
    await t.settle();
    const read = looks.strip("f1")!;
    expect(stripGone(read)).toBe(false);
    narrowLetsGo();
    expect(stripGone(read)).toBe(true);
    // The wide piece's own hold has the strip made again.
    looks.hold("f1", "strip");
    await t.settle();
    expect(looks.strip("f1")).not.toBeNull();
    expect(looks.strip("f1")).not.toBe(read);
  });
});

describe("a strip's tiles across a clip", () => {
  // Tiles are 114 × 64, so in a clip 32 tall each is 57 wide. At one frame a pixel and 30 fps, a tile is 1.9 s.
  it("sit side by side from the left edge, each the frame its left edge plays", () => {
    const tiles = stripTiles(clip(), 30, 1, 200, 32, strip());
    expect(tiles.map((t) => t.x)).toEqual([0, 57, 114, 171]);
    expect(tiles.map((t) => t.tile)).toEqual([0, 2, 4, 6]); // 0 s, 1.9 s, 3.8 s, 5.7 s
    expect(tiles.every((t) => t.width === 57)).toBe(true);
  });
  it("follow the clip's in point, speed and way round", () => {
    expect(stripTiles(clip({ in: 90 }), 30, 1, 100, 32, strip()).map((t) => t.tile)).toEqual([3, 5]);
    expect(stripTiles(clip({ speed: 2 }), 30, 1, 100, 32, strip()).map((t) => t.tile)).toEqual([0, 4]);
    expect(stripTiles(clip({ in: 270, speed: -1 }), 30, 1, 100, 32, strip()).map((t) => t.tile)).toEqual([9, 7]);
    expect(stripTiles(clip({ in: 150, speed: 0 }), 30, 1, 100, 32, strip()).map((t) => t.tile)).toEqual([5, 5]);
  });
  it("stay inside the strip, and a strip of one tile shows it everywhere", () => {
    expect(stripTiles(clip({ in: 3000 }), 30, 1, 60, 32, strip()).map((t) => t.tile)).toEqual([9, 9]);
    expect(stripTiles(clip(), 30, 1, 60, 32, strip({ tiles: 1, every: 0 })).map((t) => t.tile)).toEqual([0, 0]);
  });
  it("zoomed out, each tile covers more of the clip", () => {
    expect(stripTiles(clip(), 30, 3, 100, 32, strip()).map((t) => t.tile)).toEqual([0, 6]); // 57 px is 171 frames, 5.7 s
  });
});

describe("the part of a file a clip plays", () => {
  it("runs from its in point for its length at its speed", () => {
    expect(clipSpanSeconds(clip({ in: 30, duration: 60 }), 30)).toEqual({ from: 1, to: 3 });
    expect(clipSpanSeconds(clip({ in: 30, duration: 60, speed: 2 }), 30)).toEqual({ from: 1, to: 5 });
    expect(clipSpanSeconds(clip({ in: 90, duration: 60, speed: -1 }), 30)).toEqual({ from: 3, to: 1 });
  });
});

describe("how many tiles a video gets", () => {
  it("one a second, up to 120, then further apart", () => {
    expect(stripPlan(10)).toEqual({ tiles: 10, every: 1 });
    expect(stripPlan(0.4)).toEqual({ tiles: 1, every: 0 });
    expect(stripPlan(600)).toEqual({ tiles: 120, every: 5 });
    expect(stripPlan(0)).toEqual({ tiles: 1, every: 0 });
  });
});
