import { describe, expect, it, vi } from "vitest";
import {
  HANDLE_SIGNS, canvasItems, clampInto, corners, createPreviewSurface, cursorFor, fromScreen, handlePoints, hitTest, outsetCorners, toLocal,
  toOverlay, toScreen, toWorld, viewOf, visibleBox, type CanvasItem, type Handle, type View,
} from "@/lib/editor/canvas-geometry";
import type { Sizer } from "@/lib/editor/clip-box";
import { DEFAULT_TRANSFORM, captionStyleOf, createEmptyDoc, type Clip, type MediaClip, type TextClip, type TimelineDoc, type Transform } from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";
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

  it("a keyframed clip's box follows its keyframes", () => {
    const doc = patch(sampleDoc(), "c2", {});
    const c2 = doc.tracks[0].clips[1];
    doc.tracks[0].clips[1] = { ...c2, keyframes: { x: [{ at: 0, value: 0 }, { at: 10, value: 1 }] } } as Clip;
    const at = (frame: number) => canvasItems(doc, frame, sizer).find((i) => i.clipId === "c2")!.center;
    expectPoint(at(c2.start + 5), 0.5 * FRAME.width, 0.5 * FRAME.height);
    expectPoint(at(c2.start + 2), 0.2 * FRAME.width, 0.5 * FRAME.height); // the rest x is 0.5, so this one shows it moved
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

describe("teammates' outlines", () => {
  // How far each outset corner lies from the kept box's corner along the clip's own axes, in screen pixels at k.
  const outBy = (item: CanvasItem, cssPx: number, k: number) => {
    const a = (item.rotation * Math.PI) / 180;
    return outsetCorners(item, cssPx, k).map((p, i) => {
      const c = corners(item)[i];
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      return { x: (dx * Math.cos(a) + dy * Math.sin(a)) * k, y: (-dx * Math.sin(a) + dy * Math.cos(a)) * k };
    });
  };
  const OUT = [[-3, -3], [3, -3], [3, 3], [-3, 3]];

  it("outsetCorners grows the box by N screen px at 0° and 30°, with stretch and with crop", () => {
    // x1 spans 508..572 across and 921.6..998.4 down; at k = 0.5, 3 screen px is 6 project px.
    const [nw, ne, se, sw] = outsetCorners(canvasItems(sampleDoc(), 10, sizer)[1], 3, 0.5);
    expectPoint(nw, 502, 915.6);
    expectPoint(ne, 578, 915.6);
    expectPoint(se, 578, 1004.4);
    expectPoint(sw, 502, 1004.4);

    const cases = [
      patch(sampleDoc(), "x1", { rotation: 30 }),
      patch(sampleDoc(), "x1", { scale: 2, stretch: 1.5 }),
      patch(sampleDoc(), "x1", { rotation: 30, scale: 0.5, stretch: 3 }),
      patch(sampleDoc(), "x1", { rotation: 30, crop: { left: 0.5, top: 0.2, right: 0, bottom: 0 } }),
    ];
    for (const doc of cases) {
      const x1 = canvasItems(doc, 10, sizer)[1];
      outBy(x1, 3, 0.5).forEach((d, i) => expectPoint(d, OUT[i][0], OUT[i][1]));
    }
    // A crop grows from the kept box, not the whole one.
    const cropped = canvasItems(imageDoc({ crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }), 0, sizer)[0];
    expectPoint(outsetCorners(cropped, 4, 1)[0], 104, 686);
    // The same distance on screen whatever the board's zoom.
    const turned = canvasItems(patch(sampleDoc(), "x1", { rotation: 30, stretch: 2 }), 10, sizer)[1];
    outBy(turned, 6, 2).forEach((d, i) => expectPoint(d, OUT[i][0] * 2, OUT[i][1] * 2));
  });

  it("a clip scaled to nothing keeps its corners", () => {
    const flat = canvasItems(patch(sampleDoc(), "x1", { scale: 0 }), 10, sizer)[1];
    expect(outsetCorners(flat, 3, 0.5)).toEqual(corners(flat));
  });
});

describe("handles", () => {
  const grips = (item: CanvasItem, offset = 48, push?: { ew: number; ns: number }) =>
    Object.fromEntries(handlePoints(item, offset, push).map((h) => [h.grip, h.at]));

  it("the eight handles sit on the kept box", () => {
    const image = canvasItems(imageDoc(), 0, sizer)[0];
    const at = grips(image);
    expect(Object.keys(at)).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w", "rotate"]);
    expectPoint(at.e, 1080, 960);
    expectPoint(at.w, 0, 960);
    expectPoint(at.se, 1080, 1230);
    expectPoint(at.nw, 0, 690);
    expectPoint(at.ne, 1080, 690);
    expectPoint(at.sw, 0, 1230);
    expectPoint(at.n, 540, 690);
    expectPoint(at.s, 540, 1230);
    expectPoint(at.rotate, 540, 642);

    const cropped = grips(canvasItems(imageDoc({ crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }), 0, sizer)[0]);
    expectPoint(cropped.w, 108, 960);
    expectPoint(cropped.nw, 108, 690);
    expectPoint(cropped.n, 594, 690);
  });

  it("a turned box's handles and rotate point turn with it", () => {
    const at = grips(canvasItems(imageDoc({ rotation: 90 }), 0, sizer)[0], 48);
    expectPoint(at.e, 540, 1500);
    expectPoint(at.n, 810, 960);
    // The box's up is the screen's right after a quarter turn clockwise.
    expectPoint(at.rotate, 858, 960);
  });

  it("text is handled like a picture, on its own box", () => {
    const x1 = canvasItems(patch(sampleDoc(), "x1", { scale: 2, stretch: 1.5 }), 10, sizer)[1];
    const at = grips(x1, 10);
    expectPoint(at.e, 636, 960);
    expectPoint(at.nw, 444, 883.2);
    expectPoint(at.rotate, 540, 873.2);
  });

  it("pushed side handles sit outside the box", () => {
    const image = canvasItems(imageDoc(), 0, sizer)[0];
    const at = grips(image, 48, { ew: 24, ns: 0 });
    expectPoint(at.e, 1104, 960);
    expectPoint(at.w, -24, 960);
    expectPoint(at.n, 540, 690);
    expectPoint(at.s, 540, 1230);
    // Corners never move.
    expectPoint(at.se, 1080, 1230);
    const ns = grips(image, 48, { ew: 0, ns: 10 });
    expectPoint(ns.n, 540, 680);
    expectPoint(ns.s, 540, 1240);
    expectPoint(ns.e, 1080, 960);
    expectPoint(ns.rotate, 540, 642);
    expectPoint(ns.se, 1080, 1230);
    // Along the box's own axes when turned.
    const turned = grips(canvasItems(imageDoc({ rotation: 90 }), 0, sizer)[0], 48, { ew: 24, ns: 10 });
    expectPoint(turned.e, 540, 1524);
    expectPoint(turned.w, 540, 396);
    expectPoint(turned.n, 820, 960);
    expectPoint(turned.s, 260, 960);
  });

  it("HANDLE_SIGNS points each handle outward", () => {
    expect(HANDLE_SIGNS).toEqual({
      nw: { hx: -1, hy: -1 }, n: { hx: 0, hy: -1 }, ne: { hx: 1, hy: -1 }, e: { hx: 1, hy: 0 },
      se: { hx: 1, hy: 1 }, s: { hx: 0, hy: 1 }, sw: { hx: -1, hy: 1 }, w: { hx: -1, hy: 0 },
    });
  });

  it("clampInto moves only a point outside the box", () => {
    const box = { left: 270, top: 480, right: 842, bottom: 1472 };
    expect(clampInto({ x: 1096, y: 1936 }, box, 12)).toEqual({ x: 830, y: 1460 });
    expect(clampInto({ x: 500, y: 700 }, box, 12)).toEqual({ x: 500, y: 700 });
    // Inside but nearer an edge than the inset: it stays.
    expect(clampInto({ x: 275, y: 1465 }, box, 12)).toEqual({ x: 275, y: 1465 });
    expect(clampInto({ x: 100, y: 300 }, box, 12)).toEqual({ x: 282, y: 492 });
    // Each axis on its own; an edge is inside.
    expect(clampInto({ x: 842, y: 100 }, box, 12)).toEqual({ x: 842, y: 492 });
  });

  it("cursorFor follows the turn", () => {
    expect(cursorFor("se", 0)).toBe("nwse-resize");
    expect(cursorFor("e", 0)).toBe("ew-resize");
    expect(cursorFor("e", 90)).toBe("ns-resize");
    expect(cursorFor("n", 45)).toBe("nesw-resize");
    expect(cursorFor("n", 0)).toBe("ns-resize");
    expect(cursorFor("ne", 0)).toBe("nesw-resize");
    expect(cursorFor("w", -90)).toBe("ns-resize");
    expect(cursorFor("sw", 0)).toBe("nesw-resize");
    expect(cursorFor("nw", 0)).toBe("nwse-resize");
    expect(cursorFor("e", 200)).toBe("ew-resize");
    const all: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    for (const h of all) expect(cursorFor(h, 360)).toBe(cursorFor(h, 0));
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

describe("captions on the board", () => {
  // c1 plays "hello there." from frame 0; the caption clip covers it. Every character is 10 px wide in any font.
  const W = [
    { t: "hello", s: 0, e: 400 },
    { t: "there.", s: 450, e: 900 },
  ];
  const measured: Sizer = { source: () => null, measure: (_c, s) => s.length * 10, measureFont: (_f, s) => s.length * 10 };
  function captioned(locked = false): TimelineDoc {
    const doc = docWithCaptions("short_9x16");
    doc.tracks[0].clips = [{ id: "c1", type: "video", assetId: "a", start: 0, duration: 60, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM } }];
    const cap = doc.tracks.find((t) => t.kind === "caption")!;
    cap.locked = locked;
    cap.clips = [{ id: "k1", type: "caption", assetId: "a", start: 0, duration: 60, transform: { ...DEFAULT_TRANSFORM } }];
    doc.captions = { transcripts: { a: W } };
    return doc;
  }

  it("the lines showing are an item of their caption clip, centred across the frame on the style's y", () => {
    const doc = captioned();
    const style = captionStyleOf(doc);
    const item = canvasItems(doc, 5, measured).find((i) => i.type === "caption")!;
    expect(item.clipId).toBe("k1");
    expect(item.center.x).toBe(doc.width / 2);
    expect(item.center.y).toBeCloseTo(style.y * doc.height, 5);
    // "hello there." is 12 characters, so 120 px, and the outline adds a little.
    expect(item.rect.right - item.rect.left).toBeGreaterThanOrEqual(120);
    expect(item.rect.bottom - item.rect.top).toBeGreaterThan(style.fontSize);
    // A press on it finds the caption clip; one off it does not.
    expect(hitTest(canvasItems(doc, 5, measured), item.center)?.clipId).toBe("k1");
    expect(hitTest(canvasItems(doc, 5, measured), { x: item.center.x, y: 10 })?.type).not.toBe("caption");
  });

  it("nothing when no line shows, when the Captions track is hidden, or for captions switched on the old way", () => {
    expect(canvasItems(captioned(), 50, measured).some((i) => i.type === "caption")).toBe(false);
    const hidden = captioned();
    hidden.tracks.find((t) => t.kind === "caption")!.hidden = true;
    expect(canvasItems(hidden, 5, measured).some((i) => i.type === "caption")).toBe(false);
    const old = captioned();
    old.tracks.find((t) => t.kind === "caption")!.clips = [];
    (old.tracks[0].clips[0] as { captions?: boolean }).captions = true;
    expect(canvasItems(old, 5, measured).some((i) => i.type === "caption")).toBe(false);
  });

  it("is locked with its track, and sits above the tracks before the Captions track", () => {
    expect(canvasItems(captioned(true), 5, measured).find((i) => i.type === "caption")!.locked).toBe(true);
    const items = canvasItems(captioned(), 5, measured);
    const at = items.findIndex((i) => i.type === "caption");
    expect(items.findIndex((i) => i.clipId === "c1")).toBeLessThan(at);
  });
});
