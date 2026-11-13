import { describe, expect, it, vi } from "vitest";
import {
  canvasItems, corners, createPreviewSurface, fromScreen, hitTest, toLocal, toOverlay, toScreen, toWorld, viewOf, visibleBox,
  type CanvasItem, type View,
} from "@/lib/editor/canvas-geometry";
import type { Sizer } from "@/lib/editor/clip-box";
import { createEmptyDoc, type Clip, type MediaClip, type TextClip, type TimelineDoc, type Transform } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// Text measures half its font size per character, so "hi" at 64 is 64 wide; the 200 × 100 image is known, every
// other picture is not (a placeholder, the whole frame).
const sizer: Sizer = {
  source: (clip) => (clip.assetId === "img" ? { width: 200, height: 100 } : null),
  measure: (clip: TextClip, s: string) => (s.length * clip.style.fontSize) / 2,
};

const FRAME = { width: 1080, height: 1920 };

function patch(doc: TimelineDoc, clipId: string, transform: Partial<Transform>, extra: Partial<Pick<Clip, "start">> = {}): TimelineDoc {
  for (const track of doc.tracks) {
    track.clips = track.clips.map((c) => (c.id === clipId ? ({ ...c, ...extra, transform: { ...c.transform, ...transform } } as Clip) : c));
  }
  return doc;
}

// The 200 × 100 image alone, fitted inside the frame: 1080 × 540.
function imageDoc(transform: Partial<Transform> = {}): TimelineDoc {
  const doc = createEmptyDoc("short_9x16");
  const base = video("i1", 0, 30, { type: "image", assetId: "img" }) as MediaClip;
  doc.tracks[0].clips = [{ ...base, transform: { ...base.transform, fit: "contain", ...transform } } as Clip];
  return doc;
}

const hit = (items: CanvasItem[], x: number, y: number, slop?: number, opts?: Parameters<typeof hitTest>[3]) =>
  hitTest(items, { x, y }, slop, opts)?.clipId ?? null;

function expectPoint(actual: { x: number; y: number }, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x, 6);
  expect(actual.y).toBeCloseTo(y, 6);
}

describe("what the preview draws, as boxes", () => {
  it("lists what is drawn at a frame, back to front", () => {
    const doc = sampleDoc();
    doc.tracks[3].clips = [video("au", 0, 60, { type: "audio" })];
    expect(canvasItems(doc, 10, sizer).map((i) => i.clipId)).toEqual(["c1", "x1"]);
    doc.tracks[1].hidden = true;
    expect(canvasItems(doc, 10, sizer).map((i) => i.clipId)).toEqual(["c1"]);
    // The audio clip under the playhead is never drawn.
    expect(canvasItems(doc, 10, sizer).some((i) => i.clipId === "au")).toBe(false);
  });

  it("an item carries its track, look and box", () => {
    const doc = patch(sampleDoc(), "x1", { x: 0.25, y: 0.75, rotation: 30, opacity: 0.5, scale: 2 });
    doc.tracks[1].locked = true;
    const x1 = canvasItems(doc, 10, sizer)[1];
    expect(x1).toMatchObject({ clipId: "x1", trackId: "t1", type: "text", locked: true, opacity: 0.5, rotation: 30, sx: 2, sy: 2 });
    expectPoint(x1.center, 270, 1440);
    expect(x1.full).toEqual({ left: -32, top: -38.4, right: 32, bottom: 38.4 });
    expect(canvasItems(doc, 10, sizer)[0]).toMatchObject({ clipId: "c1", trackId: "v1", type: "video", locked: false });
  });

  it("a stretched clip is drawn wider", () => {
    const doc = patch(sampleDoc(), "x1", { stretch: 2 });
    const x1 = canvasItems(doc, 10, sizer).find((i) => i.clipId === "x1")!;
    expect(x1.sx).toBe(2);
    expect(x1.sy).toBe(1);
    const [nw, ne, se, sw] = corners(x1);
    expect(nw.x).toBeCloseTo(476, 6);
    expect(ne.x).toBeCloseTo(604, 6);
    expect(se.x).toBeCloseTo(604, 6);
    expect(sw.x).toBeCloseTo(476, 6);
    expectPoint(nw, 476, 921.6);
    expectPoint(se, 604, 998.4);
  });

  it("toLocal and toWorld undo each other on a turned, stretched clip", () => {
    const doc = patch(sampleDoc(), "x1", { rotation: 37, scale: 1.5, stretch: 0.6, x: 0.3 });
    const x1 = canvasItems(doc, 10, sizer)[1];
    const local = { x: 12, y: -7 };
    expectPoint(toLocal(x1, toWorld(x1, local)), 12, -7);
    // A quarter turn clockwise takes the local x axis down the screen.
    const turned = canvasItems(patch(sampleDoc(), "x1", { rotation: 90 }), 10, sizer)[1];
    expectPoint(toWorld(turned, { x: 10, y: 0 }), 540, 970);
  });
});

describe("the hit test", () => {
  it("the hit test finds the top-most clip", () => {
    const items = canvasItems(sampleDoc(), 10, sizer);
    expect(hit(items, 540, 960)).toBe("x1");
    expect(hit(items, 40, 40)).toBe("c1");
    const locked = sampleDoc();
    locked.tracks[1].locked = true;
    expect(hit(canvasItems(locked, 10, sizer), 540, 960)).toBe("c1");
    expect(hit(canvasItems(locked, 10, sizer), 540, 960, 0, { includeLocked: true })).toBe("x1");
    expect(hit(canvasItems(patch(sampleDoc(), "x1", { opacity: 0 }), 10, sizer), 540, 960)).toBe("c1");
    expect(hit(items, 574, 960)).toBe("c1");
    expect(hit(items, 574, 960, 4)).toBe("x1");
    expect(hit(canvasItems(sampleDoc(), 70, sizer), 540, 960)).toBeNull();
  });

  it("the slop is in screen terms: it shrinks with the clip's own scale on each axis", () => {
    const items = canvasItems(patch(sampleDoc(), "x1", { scale: 2, stretch: 2 }), 10, sizer);
    // x1 spans 412..668 across and 883.2..1036.8 down; a slop of 4 reaches 4 past each edge, not 4 × the scale.
    expect(hit(items, 671, 960, 4)).toBe("x1");
    expect(hit(items, 673, 960, 4)).toBe("c1");
    expect(hit(items, 540, 1039.8, 4)).toBe("x1");
    expect(hit(items, 540, 1041.8, 4)).toBe("c1");
  });

  it("a turned clip is hit inside its turned box", () => {
    const turned = canvasItems(imageDoc({ rotation: 90 }), 0, sizer);
    expect(hit(turned, 940, 960)).toBeNull();
    expect(hit(turned, 540, 1360)).toBe("i1");
    const upright = canvasItems(imageDoc(), 0, sizer);
    expect(hit(upright, 940, 960)).toBe("i1");
    expect(hit(upright, 540, 1360)).toBeNull();
  });

  it("a stretched or cropped clip is hit only where it is drawn", () => {
    expect(hit(canvasItems(patch(sampleDoc(), "x1", { stretch: 2 }), 10, sizer), 600, 960)).toBe("x1");
    expect(hit(canvasItems(sampleDoc(), 10, sizer), 600, 960)).toBe("c1");
    const cropped = canvasItems(imageDoc({ crop: { left: 0.1, top: 0, right: 0.2, bottom: 0 } }), 0, sizer);
    expect(hit(cropped, 100, 960)).toBeNull();
    expect(hit(cropped, 600, 960)).toBe("i1");
    const half = canvasItems(patch(sampleDoc(), "x1", { crop: { left: 0.5, top: 0, right: 0, bottom: 0 } }), 10, sizer);
    expect(hit(half, 530, 960)).toBe("c1");
    expect(hit(half, 560, 960)).toBe("x1");
    expect(half[1].full).toEqual({ left: -32, top: -38.4, right: 32, bottom: 38.4 });
    expect(half[1].rect).toEqual({ left: 0, top: -38.4, right: 32, bottom: 38.4 });
  });

  it("outside the frame only kept clips are hit", () => {
    const items = canvasItems(patch(sampleDoc(), "c1", { scale: 3 }), 10, sizer);
    expect(hit(items, -20, 960)).toBe("c1");
    expect(hit(items, -20, 960, 0, { frame: FRAME, keep: [] })).toBeNull();
    expect(hit(items, -20, 960, 0, { frame: FRAME, keep: ["c1"] })).toBe("c1");
    // Each edge of the frame is inside it.
    expect(hit(items, 0, 0, 0, { frame: FRAME, keep: [] })).toBe("c1");
    expect(hit(items, 1080, 1920, 0, { frame: FRAME, keep: [] })).toBe("c1");
    expect(hit(items, 540, 1921, 0, { frame: FRAME, keep: [] })).toBeNull();
    expect(hit(items, 1081, 960, 0, { frame: FRAME })).toBeNull();
    // Inside the frame the selection does not matter.
    expect(hit(items, 540, 960, 0, { frame: FRAME, keep: [] })).toBe("x1");
  });
});

describe("screen and project pixels", () => {
  it("a 4K frame shown 960 px wide maps screen to project pixels", () => {
    const v = viewOf({ left: 100, top: 50, width: 960 }, 3840);
    expect(v.k).toBeCloseTo(0.25, 6);
    expect(v.left).toBe(100);
    expect(v.top).toBe(50);
    expectPoint(fromScreen(v, 580, 320), 1920, 1080);
    expectPoint(toScreen(v, { x: 1920, y: 1080 }), 580, 320);
    const p = fromScreen(v, 123.4, 567.8);
    expectPoint(toScreen(v, p), 123.4, 567.8);
  });

  it("at 100%, scrolled, the pane's middle is the frame's middle", () => {
    expectPoint(fromScreen(viewOf({ left: -54, top: -424, width: 1080 }, 1080), 486, 536), 540, 960);
  });

  it("toOverlay measures from the overlay's corner", () => {
    const v: View = viewOf({ left: 216, top: 56, width: 540 }, 1080);
    expectPoint(toOverlay(v, { left: 200, top: 40 }, { x: 540, y: 960 }), 286, 496);
  });

  it("visibleBox is the pane in overlay pixels", () => {
    expect(visibleBox({ left: 200, top: 40, width: 572, height: 992 }, { left: -70, top: -440 })).toEqual({
      left: 270,
      top: 480,
      right: 842,
      bottom: 1472,
    });
  });
});

describe("the preview's surface", () => {
  it("a surface gives nothing until it is attached", () => {
    const surface = createPreviewSurface();
    expect(surface.items()).toEqual([]);
    expect(surface.view()).toBeNull();
    expect(surface.visible()).toBeNull();

    const items = canvasItems(sampleDoc(), 10, sizer);
    const view = { left: 1, top: 2, k: 0.5 };
    const box = { left: 0, top: 0, right: 10, bottom: 10 };
    const detach = surface.attach({ items: () => items, view: () => view, visible: () => box });
    expect(surface.items()).toBe(items);
    expect(surface.view()).toBe(view);
    expect(surface.visible()).toBe(box);

    const a = vi.fn();
    const b = vi.fn();
    const stopA = surface.onChange(a);
    surface.onChange(b);
    surface.changed();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    surface.changed();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    detach();
    expect(surface.items()).toEqual([]);
    expect(surface.view()).toBeNull();
    expect(surface.visible()).toBeNull();
  });

  it("an old detach leaves a newer attachment in place", () => {
    const surface = createPreviewSurface();
    const detachOld = surface.attach({ items: () => [], view: () => ({ left: 0, top: 0, k: 1 }), visible: () => null });
    const view = { left: 5, top: 5, k: 2 };
    surface.attach({ items: () => [], view: () => view, visible: () => null });
    detachOld();
    expect(surface.view()).toBe(view);
  });
});
