import { describe, expect, it } from "vitest";
import {
  ROTATE_SNAP_DEG, ROTATE_STEP, SCALE_MAX, SCALE_MIN, SNAP_CSS_PX, beginCanvasDrag, resolveCanvasDrag,
  type CanvasDragInput, type CanvasDragResult, type Grip,
} from "@/lib/editor/canvas-drag";
import { canvasItems, type CanvasItem } from "@/lib/editor/canvas-geometry";
import type { Sizer } from "@/lib/editor/clip-box";
import type { Point } from "@/lib/editor/board";
import { createEmptyDoc, type Clip, type MediaClip, type TextClip, type TimelineDoc, type Transform } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// Frame 1080 × 1920. Text measures half its font size per character, so "hi" at 64 is 64 wide. "img" is a 200 × 100
// picture and "wide" a 1920 × 1080 one; every other picture is not known (a placeholder, the whole frame).
const sizer: Sizer = {
  source: (clip) => (clip.assetId === "img" ? { width: 200, height: 100 } : clip.assetId === "wide" ? { width: 1920, height: 1080 } : null),
  measure: (clip: TextClip, s: string) => (s.length * clip.style.fontSize) / 2,
};

function patch(doc: TimelineDoc, clipId: string, transform: Partial<Transform>): TimelineDoc {
  for (const track of doc.tracks) {
    track.clips = track.clips.map((c) => (c.id === clipId ? ({ ...c, transform: { ...c.transform, ...transform } } as Clip) : c));
  }
  return doc;
}

// The image: a 200 × 100 source fitted inside the frame, 1080 × 540 about (540, 960).
function imageDoc(transform: Partial<Transform> = {}, assetId = "img", fit: Transform["fit"] = "contain"): TimelineDoc {
  const doc = createEmptyDoc("short_9x16");
  const base = video("i1", 0, 30, { type: "image", assetId }) as MediaClip;
  doc.tracks[0].clips = [{ ...base, transform: { ...base.transform, fit, ...transform } } as Clip];
  return doc;
}

function leftAligned(doc: TimelineDoc): TimelineDoc {
  doc.tracks[1].clips = doc.tracks[1].clips.map((c) => (c.id === "x1" ? ({ ...c, style: { ...(c as TextClip).style, align: "left" } } as Clip) : c));
  return doc;
}

const itemOf = (doc: TimelineDoc, clipId: string, frame = 10): CanvasItem =>
  canvasItems(doc, frame, sizer).find((i) => i.clipId === clipId)!;

type Mods = Partial<Omit<CanvasDragInput, "pointer">>;

const input = (pointer: Point, mods: Mods = {}): CanvasDragInput => ({ pointer, shift: false, alt: false, snapping: false, snapPx: 12, ...mods });

function dragOn(doc: TimelineDoc, clipId: string, grip: Grip, grab: Point, drawn?: Point) {
  const drag = beginCanvasDrag(doc, itemOf(doc, clipId), grip, grab, drawn);
  if (!drag) throw new Error("no drag");
  return (pointer: Point, mods: Mods = {}) => resolveCanvasDrag(drag, input(pointer, mods));
}

const image = (grip: Grip, grab: Point, transform: Partial<Transform> = {}) => dragOn(imageDoc(transform), "i1", grip, grab);

const transformOf = (r: CanvasDragResult) => {
  expect(r.ops).toHaveLength(1);
  const op = r.ops[0] as { op: string; clipId: string; patch: { transform: Record<string, unknown> } };
  expect(op.op).toBe("update_clip");
  expect(Object.keys(op.patch)).toEqual(["transform"]);
  return op.patch.transform;
};

const P = (x: number, y: number): Point => ({ x, y });

// A point r px from (540, 960) at deg degrees, clockwise on screen from the right.
const around = (deg: number, r = 100): Point => ({ x: 540 + r * Math.cos((deg * Math.PI) / 180), y: 960 + r * Math.sin((deg * Math.PI) / 180) });

describe("the drag's limits", () => {
  it("are the plan's numbers", () => {
    expect([SCALE_MIN, SCALE_MAX, ROTATE_STEP, ROTATE_SNAP_DEG, SNAP_CSS_PX]).toEqual([0.01, 10, 15, 3, 6]);
  });
});

describe("moves and turns", () => {
  it("a 54 px drag moves x by 0.05", () => {
    const r = dragOn(sampleDoc(), "x1", "body", P(540, 960))(P(594, 960), { snapping: true });
    expect(r.ops).toEqual([{ op: "update_clip", clipId: "x1", patch: { transform: { x: 0.55 } } }]);
    expect(r.label).toBe("position change");
    // The centre stays on the middle line across, and says so.
    expect(r.guides).toEqual({ x: null, y: 960 });
  });

  it("a drag moves both ways by the frame's size", () => {
    const r = dragOn(sampleDoc(), "x1", "body", P(540, 960))(P(486, 1152));
    expect(transformOf(r)).toEqual({ x: 0.45, y: 0.6 });
    expect(r.guides).toEqual({ x: null, y: null });
  });

  it("Shift keeps the larger movement", () => {
    const move = dragOn(sampleDoc(), "x1", "body", P(540, 960));
    expect(transformOf(move(P(594, 970), { shift: true }))).toEqual({ x: 0.55 });
    expect(transformOf(move(P(550, 1152), { shift: true }))).toEqual({ y: 0.6 });
    expect(transformOf(move(P(594, 970)))).toEqual({ x: 0.55, y: 0.5052 });
  });

  it("Shift keeps the other axis off its centre line too", () => {
    const doc = patch(sampleDoc(), "x1", { y: 0.503 });
    const r = dragOn(doc, "x1", "body", P(540, 965.76))(P(594, 967.76), { shift: true, snapping: true });
    expect(transformOf(r)).toEqual({ x: 0.55 });
    expect(r.guides).toEqual({ x: null, y: null });
    // Without Shift the centre snaps onto the line.
    expect(transformOf(dragOn(doc, "x1", "body", P(540, 965.76))(P(594, 967.76), { snapping: true }))).toEqual({ x: 0.55, y: 0.5 });
  });

  it("the centre snaps to the middle with a guide", () => {
    const doc = patch(sampleDoc(), "x1", { x: 0.3, y: 0.3 });
    const move = dragOn(doc, "x1", "body", P(324, 576));
    const snapped = move(P(530, 576), { snapping: true });
    expect(transformOf(snapped)).toEqual({ x: 0.5 });
    expect(snapped.guides).toEqual({ x: 540, y: null });
    const free = move(P(530, 576));
    expect(transformOf(free)).toEqual({ x: 0.4907 });
    expect(free.guides).toEqual({ x: null, y: null });
    // Just outside snapPx it does not snap; the down axis snaps alike.
    expect(transformOf(move(P(527, 576), { snapping: true }))).toEqual({ x: 0.4880 });
    const down = move(P(324, 970), { snapping: true });
    expect(transformOf(down)).toEqual({ y: 0.5 });
    expect(down.guides).toEqual({ x: null, y: 960 });
    expect(transformOf(move(P(324, 970), { snapping: true, snapPx: 5 }))).toEqual({ y: 0.5052 });
    expect(transformOf(move(P(530, 576), { snapping: true, snapPx: 5 }))).toEqual({ x: 0.4907 });
  });

  it("Shift never snaps the held axis", () => {
    const doc = patch(sampleDoc(), "x1", { x: 0.503 });
    const r = dragOn(doc, "x1", "body", P(543.24, 960))(P(545.24, 1152), { shift: true, snapping: true });
    expect(transformOf(r)).toEqual({ y: 0.6 });
    expect(r.guides).toEqual({ x: null, y: null });
  });

  it("a centre a hair past the frame's left edge rounds to 0, never −0", () => {
    const x = transformOf(dragOn(patch(sampleDoc(), "x1", { x: 0.3 }), "x1", "body", P(324, 960))(P(-0.00001, 960))).x;
    expect(Object.is(x, 0)).toBe(true);
  });

  it("back where it started gives no ops", () => {
    const move = dragOn(patch(sampleDoc(), "x1", { x: 0.123456 }), "x1", "body", P(133, 960));
    const r = move(P(133, 960));
    expect(r).toEqual({ ops: [], label: "position change", guides: { x: null, y: null } });
    expect(move(P(133.01, 960)).ops).toEqual([]);
    expect(dragOn(sampleDoc(), "x1", "rotate", P(540, 860))(P(540, 860)).ops).toEqual([]);
    expect(image("e", P(1080, 960))(P(1080, 960)).ops).toEqual([]);
    expect(image("e", P(1080, 960))(P(1080, 960), { alt: true }).ops).toEqual([]);
    expect(image("e", P(1080, 960))(P(1080, 960), { alt: true, shift: true }).ops).toEqual([]);
    expect(image("se", P(1080, 1230))(P(1080, 1230), { shift: true }).ops).toEqual([]);
  });

  it("a quarter turn clockwise adds 90°", () => {
    const turn = dragOn(sampleDoc(), "x1", "rotate", P(540, 860));
    const r = turn(P(640, 960));
    expect(r.ops).toEqual([{ op: "update_clip", clipId: "x1", patch: { transform: { rotation: 90 } } }]);
    expect(r.label).toBe("position change");
    expect(r.guides).toEqual({ x: null, y: null });
    // Shift turns 47° into 45.
    const fromRight = dragOn(sampleDoc(), "x1", "rotate", around(0));
    expect(transformOf(fromRight(around(47), { shift: true }))).toEqual({ rotation: 45 });
    expect(transformOf(fromRight(around(53), { shift: true }))).toEqual({ rotation: 60 });
    expect(transformOf(fromRight(around(47)))).toEqual({ rotation: 47 });
    // From 359 a 2° turn gives 1.
    expect(transformOf(dragOn(patch(sampleDoc(), "x1", { rotation: 359 }), "x1", "rotate", around(0))(around(2)))).toEqual({ rotation: 1 });
    // With snapping, 88° becomes 90 and 86° stays.
    expect(transformOf(fromRight(around(88), { snapping: true }))).toEqual({ rotation: 90 });
    expect(transformOf(fromRight(around(86), { snapping: true }))).toEqual({ rotation: 86 });
    expect(transformOf(fromRight(around(-92), { snapping: true }))).toEqual({ rotation: -90 });
    expect(transformOf(fromRight(around(88)))).toEqual({ rotation: 88 });
    // Normalized into (−180, 180], to a tenth of a degree.
    expect(transformOf(fromRight(around(180)))).toEqual({ rotation: 180 });
    expect(transformOf(fromRight(around(-180)))).toEqual({ rotation: 180 });
    expect(transformOf(fromRight(around(190)))).toEqual({ rotation: -170 });
    expect(transformOf(fromRight(around(12.34)))).toEqual({ rotation: 12.3 });
    // −179.96 rounds to −180, which is 180.
    expect(transformOf(fromRight(around(180.04)))).toEqual({ rotation: 180 });
  });

  it("nothing begins on a locked track or a missing clip", () => {
    const doc = sampleDoc();
    const x1 = itemOf(doc, "x1");
    doc.tracks[1].locked = true;
    for (const grip of ["body", "rotate", "e"] as const) expect(beginCanvasDrag(doc, x1, grip, P(540, 960))).toBeNull();
    const gone = sampleDoc();
    gone.tracks[1].clips = [];
    expect(beginCanvasDrag(gone, x1, "body", P(540, 960))).toBeNull();
  });

  it("a drag records where it began", () => {
    const doc = patch(imageDoc({ x: 0.3, y: 0.6, rotation: 20, scale: 2, stretch: 1.5, crop: { left: 0.1, top: 0, right: 0, bottom: 0.2 } }), "i1", {});
    const item = itemOf(doc, "i1", 0);
    expect(beginCanvasDrag(doc, item, "body", P(1, 2))).toEqual({ type: "move", clipId: "i1", grab: P(1, 2), from: { x: 0.3, y: 0.6 }, frame: { width: 1080, height: 1920 } });
    expect(beginCanvasDrag(doc, item, "rotate", P(1, 2))).toEqual({ type: "rotate", clipId: "i1", grab: P(1, 2), center: item.center, from: 20 });
    expect(beginCanvasDrag(doc, item, "sw", P(1, 2), P(3, 4))).toEqual({
      type: "resize", clipId: "i1", handle: "sw", grab: P(1, 2), item, frame: { width: 1080, height: 1920 },
      from: { scale: 2, stretch: 1.5, crop: { left: 0.1, top: 0, right: 0, bottom: 0.2 } }, drawn: P(3, 4),
    });
    const plain = imageDoc();
    expect(beginCanvasDrag(plain, itemOf(plain, "i1", 0), "e", P(1, 2))).toMatchObject({ from: { scale: 1, stretch: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } }, drawn: null });
  });
});

describe("the image resized and cropped", () => {
  it.each([
    ["1: e in", "e", P(1080, 960), P(972, 960), {}, {}, { x: 0.45, stretch: 0.9 }, "size change"],
    ["2: e into the margin", "e", P(1080, 960), P(1188, 960), {}, {}, { x: 0.55, stretch: 1.1 }, "size change"],
    ["3: turned 90°", "e", P(540, 1500), P(540, 1446), { rotation: 90 }, {}, { y: 0.4859, stretch: 0.95 }, "size change"],
    ["4: se free", "se", P(1080, 1230), P(1134, 1284), {}, {}, { x: 0.525, y: 0.5141, scale: 1.1, stretch: 0.9545 }, "size change"],
    ["5: se Shift", "se", P(1080, 1230), P(1134, 1230), {}, { shift: true }, { x: 0.52, y: 0.5056, scale: 1.04 }, "size change"],
    ["6: se across", "se", P(1080, 1230), P(1134, 1230), {}, {}, { x: 0.525, stretch: 1.05 }, "size change"],
    ["7: e Shift", "e", P(1080, 960), P(972, 960), {}, { shift: true }, { x: 0.45, scale: 0.9 }, "size change"],
    ["8: e past the anchor", "e", P(1080, 960), P(-200, 960), {}, {}, { x: 0.005, stretch: 0.01 }, "size change"],
    ["9: w Alt", "w", P(0, 960), P(108, 960), {}, { alt: true }, { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }, "crop"],
    ["10: w Alt at scale 2", "w", P(-540, 960), P(-432, 960), { scale: 2 }, { alt: true }, { crop: { left: 0.05, top: 0, right: 0, bottom: 0 } }, "crop"],
    ["11: w Alt far in with right 0.5", "w", P(0, 960), P(2000, 960), { crop: { left: 0, top: 0, right: 0.5, bottom: 0 } }, { alt: true }, { crop: { left: 0.45, top: 0, right: 0.5, bottom: 0 } }, "crop"],
    ["12: nw Alt+Shift", "nw", P(0, 690), P(108, 690), {}, { alt: true, shift: true }, { crop: { left: 0.08, top: 0.08, right: 0, bottom: 0 } }, "crop"],
    ["13: e Alt+Shift", "e", P(1080, 960), P(972, 960), {}, { alt: true, shift: true }, { crop: { left: 0, top: 0.05, right: 0.1, bottom: 0.05 } }, "crop"],
    ["14: e on a cropped image", "e", P(1080, 960), P(972, 960), { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }, {}, { x: 0.4556, stretch: 0.8889 }, "size change"],
    ["16: e Shift at scale 20", "e", P(11340, 960), P(11330, 960), { scale: 20 }, { shift: true }, { x: 0.4954, scale: 19.9907 }, "size change"],
    ["ruling: nw Alt free", "nw", P(0, 690), P(108, 744), {}, { alt: true }, { crop: { left: 0.1, top: 0.1, right: 0, bottom: 0 } }, "crop"],
    ["ruling: se Shift far past the anchor", "se", P(1080, 1230), P(-2000, -2000), {}, { shift: true }, { x: 0.005, y: 0.3608, scale: 0.01 }, "size change"],
  ] as const)("%s", (_, grip, grab, pointer, transform, mods, expected, label) => {
    const r = image(grip, grab, transform)(pointer, mods);
    expect(transformOf(r)).toEqual(expected);
    expect(r.label).toBe(label);
    expect(r.guides).toEqual({ x: null, y: null });
    expect(r.ops[0]).toMatchObject({ clipId: "i1" });
  });

  it("15: turned 30°, e dragged 50 px along its axis", () => {
    const a = Math.PI / 6;
    const u = P(Math.cos(a), Math.sin(a));
    const e = P(540 + 540 * u.x, 960 + 540 * u.y);
    expect(transformOf(image("e", e, { rotation: 30 })(P(e.x + 50 * u.x, e.y + 50 * u.y)))).toEqual({ x: 0.52, y: 0.5065, stretch: 1.0463 });
  });

  it("a drag across a side's axis changes nothing", () => {
    expect(image("e", P(1080, 960))(P(1080, 1200)).ops).toEqual([]);
    expect(image("n", P(540, 690))(P(800, 690)).ops).toEqual([]);
  });

  it("n and s change the height and keep the opposite side", () => {
    expect(transformOf(image("s", P(540, 1230))(P(540, 1284)))).toEqual({ y: 0.5141, scale: 1.1, stretch: 0.9091 });
    expect(transformOf(image("n", P(540, 690))(P(540, 744)))).toEqual({ y: 0.5141, scale: 0.9, stretch: 1.1111 });
    expect(transformOf(image("n", P(540, 690))(P(540, 744), { shift: true }))).toEqual({ y: 0.5141, scale: 0.9 });
  });

  it("w and sw keep the opposite side", () => {
    expect(transformOf(image("w", P(0, 960))(P(108, 960)))).toEqual({ x: 0.55, stretch: 0.9 });
    expect(transformOf(image("sw", P(0, 1230))(P(-54, 1284)))).toEqual({ x: 0.475, y: 0.5141, scale: 1.1, stretch: 0.9545 });
    expect(transformOf(image("ne", P(1080, 690))(P(1134, 636), { shift: true }))).toEqual({ x: 0.53, y: 0.4916, scale: 1.06 });
  });

  it("a drawn factor never passes 10 when it starts below", () => {
    expect(transformOf(image("e", P(1080, 960))(P(20000, 960)))).toEqual({ x: 5, stretch: 10 });
    expect(transformOf(image("se", P(1080, 1230))(P(20000, 20000), { shift: true }))).toEqual({ x: 5, y: 1.7656, scale: 10 });
  });

  it("a factor already below the minimum does not jump up to it", () => {
    // Drawn 0.005 wide: a drag inward keeps that, it is not pulled up to 0.01.
    expect(image("e", P(542.7, 960), { stretch: 0.005 })(P(541.7, 960)).ops).toEqual([]);
    expect(transformOf(image("e", P(542.7, 960), { stretch: 0.005 })(P(543.78, 960)))).toEqual({ x: 0.5005, stretch: 0.006 });
  });

  it("n or s past the anchor stops at the minimum", () => {
    expect(transformOf(image("s", P(540, 1230))(P(540, -2000)))).toEqual({ y: 0.3608, scale: 0.01, stretch: 100 });
  });

  it("Shift clamps k by the height's range too", () => {
    // Stretched to a quarter: the height reaches 10 when the width is only 2.5.
    expect(transformOf(image("se", P(675, 1230), { stretch: 0.25 })(P(30000, 30000), { shift: true }))).toEqual({ x: 1.625, y: 1.7656, scale: 10 });
  });

  it("Shift clamps one factor so both stay in range", () => {
    // Stretched 4 wide: the width reaches 10 when the height is only 2.5.
    const r = image("se", P(2700, 1230), { stretch: 4 })(P(30000, 30000), { shift: true });
    expect(transformOf(r)).toEqual({ x: 3.5, y: 0.7109, scale: 2.5 });
  });

  it("text squashes and stretches about its own box", () => {
    expect(transformOf(dragOn(sampleDoc(), "x1", "e", P(572, 960))(P(604, 960)))).toEqual({ x: 0.5148, stretch: 1.5 });
    const left = leftAligned(sampleDoc());
    expect(itemOf(left, "x1").full).toMatchObject({ left: -486, right: -422 });
    expect(transformOf(dragOn(left, "x1", "e", P(118, 960))(P(150, 960)))).toEqual({ x: 0.725, stretch: 1.5 });
  });

  it("a clamped handle starts the cut where it is drawn", () => {
    const doc = imageDoc({}, "wide", "cover");
    expect(itemOf(doc, "i1", 0).full.right).toBeCloseTo(1706.6667, 3);
    const w = itemOf(doc, "i1", 0).full.left + 540;
    const crop = dragOn(doc, "i1", "w", P(w, 960), P(-8, 960));
    expect(transformOf(crop(P(w + 10, 960), { alt: true }))).toEqual({ crop: { left: 0.3424, top: 0, right: 0, bottom: 0 } });
    // Only once the pointer moves.
    expect(crop(P(w, 960), { alt: true }).ops).toEqual([]);
    // A resize ignores it.
    expect(transformOf(crop(P(w + 10, 960)))).toEqual({ x: 0.5046, stretch: 0.9971 });
  });

  it("a drawn point inside the current cut keeps the press value", () => {
    const doc = imageDoc({ crop: { left: 0.4, top: 0, right: 0, bottom: 0 } }, "wide", "cover");
    const w = itemOf(doc, "i1", 0).rect.left + 540;
    const crop = dragOn(doc, "i1", "w", P(w, 960), P(-8, 960));
    expect(transformOf(crop(P(w + 10, 960), { alt: true }))).toEqual({ crop: { left: 0.4029, top: 0, right: 0, bottom: 0 } });
  });

  it("a drawn corner starts both its sides", () => {
    // The image's ne corner drawn 100 px in from each side it moves.
    const crop = dragOn(imageDoc(), "i1", "ne", P(1080, 690), P(980, 790));
    expect(transformOf(crop(P(1081, 689), { alt: true }))).toEqual({ crop: { left: 0, top: 0.1833, right: 0.0917, bottom: 0 } });
  });

  it("crop sides stay in range", () => {
    // Out past the full box: never below 0.
    expect(image("e", P(1080, 960))(P(1300, 960), { alt: true }).ops).toEqual([]);
    expect(transformOf(image("e", P(972, 960), { crop: { left: 0, top: 0, right: 0.1, bottom: 0 } })(P(1300, 960), { alt: true }))).toEqual({
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    });
    // In past the opposite side: 5% kept.
    expect(transformOf(image("s", P(540, 1230))(P(540, 0), { alt: true }))).toEqual({ crop: { left: 0, top: 0, right: 0, bottom: 0.95 } });
    expect(transformOf(image("n", P(540, 690), { crop: { left: 0, top: 0, right: 0, bottom: 0.3 } })(P(540, 5000), { alt: true }))).toEqual({
      crop: { left: 0, top: 0.65, right: 0, bottom: 0.3 },
    });
  });

  it("a crop on a turned clip follows its axes", () => {
    // Turned 90°: the image's w side is at the top of the screen; moving it down crops the left.
    expect(transformOf(image("w", P(540, 420), { rotation: 90 })(P(540, 528), { alt: true }))).toEqual({ crop: { left: 0.1, top: 0, right: 0, bottom: 0 } });
  });

  it("Alt+Shift keeps the kept part's shape and range", () => {
    // A side pulled in far: the kept width stops at 5%, the height shrinks about its middle with it.
    expect(transformOf(image("e", P(1080, 960))(P(-5000, 960), { alt: true, shift: true }))).toEqual({
      crop: { left: 0, top: 0.475, right: 0.95, bottom: 0.475 },
    });
    // Out past the full box: the kept part cannot grow past it.
    expect(image("se", P(1080, 1230))(P(1500, 1500), { alt: true, shift: true }).ops).toEqual([]);
    // Off-middle: the side stops when the other axis reaches its edge.
    const r = image("e", P(540, 879), { crop: { left: 0, top: 0.05, right: 0.5, bottom: 0.35 } })(P(5000, 879), { alt: true, shift: true });
    expect(transformOf(r)).toEqual({ crop: { left: 0, top: 0, right: 0.4167, bottom: 0.3 } });
    // A side on the down axis.
    expect(transformOf(image("s", P(540, 1230))(P(540, 1176), { alt: true, shift: true }))).toEqual({
      crop: { left: 0.05, top: 0, right: 0.05, bottom: 0.1 },
    });
    // A corner pulled past its opposite corner: 5% kept each way.
    expect(transformOf(image("se", P(1080, 1230))(P(-3000, -3000), { alt: true, shift: true }))).toEqual({
      crop: { left: 0, top: 0, right: 0.95, bottom: 0.95 },
    });
  });

  it("a drawn point past the far side still keeps 5%", () => {
    const crop = dragOn(imageDoc(), "i1", "w", P(0, 960), P(1100, 960));
    expect(transformOf(crop(P(1, 960), { alt: true, shift: true }))).toEqual({ crop: { left: 0.95, top: 0, right: 0, bottom: 0 } });
  });

  it("Alt+Shift on a corner uses the kept part's own diagonal", () => {
    // Kept nw at (108, 690), se at (1080, 1230): D = (972, 540); a tenth of D back gives k 0.9.
    const r = image("se", P(1080, 1230), { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } })(P(982.8, 1176), { alt: true, shift: true });
    expect(transformOf(r)).toEqual({ crop: { left: 0.1, top: 0, right: 0.09, bottom: 0.1 } });
  });

  it("Alt+Shift stops where the first side reaches the full box", () => {
    // A corner: the bottom stops when the right reaches 0.
    expect(transformOf(image("se", P(1080, 1068), { crop: { left: 0, top: 0, right: 0.1, bottom: 0.3 } })(P(3000, 3000), { alt: true, shift: true }))).toEqual({
      crop: { left: 0, top: 0, right: 0, bottom: 0.2222 },
    });
    // A side on the across axis: the dragged side reaches the full box first.
    expect(transformOf(image("e", P(864, 960), { crop: { left: 0, top: 0.3, right: 0.2, bottom: 0.3 } })(P(5000, 960), { alt: true, shift: true }))).toEqual({
      crop: { left: 0, top: 0.25, right: 0, bottom: 0.25 },
    });
    // A side on the down axis: the other axis reaches the full box first.
    expect(transformOf(image("s", P(540, 960), { crop: { left: 0.05, top: 0, right: 0.05, bottom: 0.5 } })(P(540, 5000), { alt: true, shift: true }))).toEqual({
      crop: { left: 0, top: 0, right: 0, bottom: 0.4444 },
    });
  });

  it("Alt+Shift keeps 5% of the narrower share", () => {
    expect(transformOf(image("e", P(1080, 960), { crop: { left: 0, top: 0.3, right: 0, bottom: 0.3 } })(P(-5000, 960), { alt: true, shift: true }))).toEqual({
      crop: { left: 0, top: 0.475, right: 0.875, bottom: 0.475 },
    });
  });

  it("Alt+Shift on w and n", () => {
    expect(transformOf(image("w", P(0, 960))(P(108, 960), { alt: true, shift: true }))).toEqual({ crop: { left: 0.1, top: 0.05, right: 0, bottom: 0.05 } });
    expect(transformOf(image("n", P(540, 690))(P(540, 744), { alt: true, shift: true }))).toEqual({ crop: { left: 0.05, top: 0.1, right: 0.05, bottom: 0 } });
  });

  it("text crops by hand about its own box", () => {
    const r = dragOn(sampleDoc(), "x1", "w", P(508, 960))(P(524, 960), { alt: true });
    expect(r.ops).toEqual([{ op: "update_clip", clipId: "x1", patch: { transform: { crop: { left: 0.25, top: 0, right: 0, bottom: 0 } } } }]);
    expect(r.label).toBe("crop");
    expect(transformOf(dragOn(leftAligned(sampleDoc()), "x1", "e", P(118, 960))(P(102, 960), { alt: true }))).toEqual({
      crop: { left: 0, top: 0, right: 0.25, bottom: 0 },
    });
  });

  it("Shift and Alt are read on every resolve", () => {
    const se = image("se", P(1080, 1230));
    const pointer = P(1134, 1230);
    expect(transformOf(se(pointer, { shift: true }))).toEqual({ x: 0.52, y: 0.5056, scale: 1.04 });
    expect(transformOf(se(pointer))).toEqual({ x: 0.525, stretch: 1.05 });
    // Alt out past the full box cuts nothing, and is still a crop.
    expect(se(pointer, { alt: true })).toEqual({ ops: [], label: "crop", guides: { x: null, y: null } });
    expect(transformOf(se(pointer, { shift: true }))).toEqual({ x: 0.52, y: 0.5056, scale: 1.04 });
    const inward = P(1026, 1176);
    expect(transformOf(se(inward, { alt: true }))).toEqual({ crop: { left: 0, top: 0, right: 0.05, bottom: 0.1 } });
    expect(transformOf(se(inward))).toEqual({ x: 0.475, y: 0.4859, scale: 0.9, stretch: 1.0556 });
  });
});
