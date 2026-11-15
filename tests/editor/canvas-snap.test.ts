import { describe, expect, it } from "vitest";
import { SNAP_CSS_PX, beginCanvasDrag, resolveCanvasDrag, type CanvasDragInput, type CanvasDragResult, type Grip } from "@/lib/editor/canvas-drag";
import { canvasItems } from "@/lib/editor/canvas-geometry";
import type { Sizer } from "@/lib/editor/clip-box";
import type { Point } from "@/lib/editor/board";
import type { Clip, TextClip, TimelineDoc, Transform } from "@/lib/timeline";
import { sampleDoc } from "./fixtures";

// Frame 1080 × 1920, shown at k = 0.5: one CSS px is 2 project px, and the snap reaches 12. x1 starts in the middle
// of the frame, on both centre lines.
const sizer: Sizer = { source: () => null, measure: (clip: TextClip, s: string) => (s.length * clip.style.fontSize) / 2 };
const K = 0.5;
const css = (n: number) => n / K;
const W = 1080, H = 1920;

function patch(doc: TimelineDoc, clipId: string, transform: Partial<Transform>): TimelineDoc {
  for (const track of doc.tracks) {
    track.clips = track.clips.map((c) => (c.id === clipId ? ({ ...c, transform: { ...c.transform, ...transform } } as Clip) : c));
  }
  return doc;
}

type Mods = Partial<Omit<CanvasDragInput, "pointer">>;

function dragOn(doc: TimelineDoc, grip: Grip, grab: Point) {
  const item = canvasItems(doc, 10, sizer).find((i) => i.clipId === "x1")!;
  const drag = beginCanvasDrag(doc, item, grip, grab);
  if (!drag) throw new Error("no drag");
  return (pointer: Point, mods: Mods = {}) =>
    resolveCanvasDrag(drag, { pointer, shift: false, crop: false, centre: false, snapping: true, snapPx: SNAP_CSS_PX / K, ...mods });
}

// x1 at (x, y), pressed on its centre.
function moveFrom(x: number, y: number) {
  const doc = patch(sampleDoc(), "x1", { x, y });
  const grab = { x: x * W, y: y * H };
  return { grab, to: dragOn(doc, "body", grab) };
}

const transformOf = (r: CanvasDragResult) => (r.ops[0] as { op: string; clipId: string; patch: { transform: Record<string, unknown> } }).patch.transform;
const round4 = (n: number) => Number(n.toFixed(4));
const NO_GUIDES = { x: null, y: null };

// A point r px from x1's centre at deg degrees, clockwise on screen from the right.
const around = (deg: number, r = 100): Point => ({ x: 540 + r * Math.cos((deg * Math.PI) / 180), y: 960 + r * Math.sin((deg * Math.PI) / 180) });

describe("a centred clip", () => {
  it("dragged 2, 4 or 5 CSS px either way moves by exactly that much, with no guide", () => {
    const { grab, to } = moveFrom(0.5, 0.5);
    for (const d of [2, 4, 5, -2, -4, -5]) {
      const across = to({ x: grab.x + css(d), y: grab.y });
      expect(transformOf(across)).toEqual({ x: round4(0.5 + css(d) / W) });
      expect(across.guides).toEqual(NO_GUIDES);
      const down = to({ x: grab.x, y: grab.y + css(d) });
      expect(transformOf(down)).toEqual({ y: round4(0.5 + css(d) / H) });
      expect(down.guides).toEqual(NO_GUIDES);
    }
  });

  it("dragged back onto the centre gives no ops and no guide", () => {
    const { grab, to } = moveFrom(0.5, 0.5);
    expect(to(grab)).toEqual({ ops: [], label: "position change", guides: NO_GUIDES });
  });
});

describe("a clip off centre", () => {
  it("20 CSS px right of centre, dragged back to within 6 CSS px of it, snaps with the guide", () => {
    const { grab, to } = moveFrom(0.5 + css(20) / W, 0.3);
    for (const left of [14, 15, 18, 20]) {
      const r = to({ x: grab.x - css(left), y: grab.y });
      expect(transformOf(r)).toEqual({ x: 0.5 });
      expect(r.guides).toEqual({ x: 540, y: null });
    }
    // 7 CSS px from the centre is outside the snap.
    const r = to({ x: grab.x - css(13), y: grab.y });
    expect(transformOf(r)).toEqual({ x: round4(0.5 + css(7) / W) });
    expect(r.guides).toEqual(NO_GUIDES);
  });

  it("4 CSS px off centre, dragged further away, is not held", () => {
    const { grab, to } = moveFrom(0.5 + css(4) / W, 0.5 - css(4) / H);
    const right = to({ x: grab.x + css(1), y: grab.y });
    expect(transformOf(right)).toEqual({ x: round4(0.5 + css(5) / W) });
    expect(right.guides).toEqual(NO_GUIDES);
    const up = to({ x: grab.x, y: grab.y - css(1) });
    expect(transformOf(up)).toEqual({ y: round4(0.5 - css(5) / H) });
    expect(up.guides).toEqual(NO_GUIDES);
  });

  it("dragged through the centre line to just beyond it snaps when it ends closer than it started", () => {
    const { grab, to } = moveFrom(0.5 + css(20) / W, 0.3);
    const r = to({ x: grab.x - css(23), y: grab.y });
    expect(transformOf(r)).toEqual({ x: 0.5 });
    expect(r.guides).toEqual({ x: 540, y: null });
    // From 4 CSS px right, 5 CSS px left of the centre is further than it started.
    const near = moveFrom(0.5 + css(4) / W, 0.3);
    const past = near.to({ x: near.grab.x - css(9), y: near.grab.y });
    expect(transformOf(past)).toEqual({ x: round4(0.5 - css(5) / W) });
    expect(past.guides).toEqual(NO_GUIDES);
  });

  it("Shift still locks the axis: the held one never snaps, the other one does", () => {
    const { grab, to } = moveFrom(0.5 + css(20) / W, 0.5 + css(3) / H);
    const r = to({ x: grab.x - css(18), y: grab.y - css(2) }, { shift: true });
    expect(transformOf(r)).toEqual({ x: 0.5 });
    expect(r.guides).toEqual({ x: 540, y: null });
    // Without Shift both snap.
    const free = to({ x: grab.x - css(18), y: grab.y - css(2) });
    expect(transformOf(free)).toEqual({ x: 0.5, y: 0.5 });
    expect(free.guides).toEqual({ x: 540, y: 960 });
  });
});

describe("a turn", () => {
  it("from 0° by 2° stays at 2", () => {
    expect(transformOf(dragOn(sampleDoc(), "rotate", around(0))(around(2)))).toEqual({ rotation: 2 });
    expect(transformOf(dragOn(sampleDoc(), "rotate", around(0))(around(-2)))).toEqual({ rotation: -2 });
    // Across the pointer's ±180° seam, too.
    expect(transformOf(dragOn(sampleDoc(), "rotate", around(179))(around(181)))).toEqual({ rotation: 2 });
    expect(transformOf(dragOn(patch(sampleDoc(), "x1", { rotation: -90 }), "rotate", around(179))(around(181)))).toEqual({ rotation: -88 });
  });

  it("from 10° to within 3° of 0 snaps to 0", () => {
    const turn = dragOn(patch(sampleDoc(), "x1", { rotation: 10 }), "rotate", around(0));
    expect(transformOf(turn(around(-8)))).toEqual({ rotation: 0 });
    expect(transformOf(turn(around(-7)))).toEqual({ rotation: 0 });
    // Through 0 and just beyond, closer than it started.
    expect(transformOf(turn(around(-12)))).toEqual({ rotation: 0 });
    expect(transformOf(turn(around(-6)))).toEqual({ rotation: 4 });
  });

  it("from 2° turned further away is not held", () => {
    const turn = dragOn(patch(sampleDoc(), "x1", { rotation: 2 }), "rotate", around(0));
    expect(transformOf(turn(around(0.5)))).toEqual({ rotation: 2.5 });
    // Turned back toward 0 it snaps.
    expect(transformOf(turn(around(-1)))).toEqual({ rotation: 0 });
  });

  it("Shift's 15° steps are unchanged", () => {
    const turn = dragOn(patch(sampleDoc(), "x1", { rotation: 10 }), "rotate", around(0));
    expect(transformOf(turn(around(-8), { shift: true }))).toEqual({ rotation: 0 });
    expect(transformOf(turn(around(-2), { shift: true }))).toEqual({ rotation: 15 });
  });
});

describe("guides placed in the project", () => {
  // x1 from a quarter of the way across, its centre dragged to 4 CSS px short of a vertical guide at 0.3.
  function towardGuide(guides: { id: string; axis: "x" | "y"; at: number }[], snapping = true) {
    const doc = patch(sampleDoc(), "x1", { x: 0.25, y: 0.5 });
    const item = canvasItems(doc, 10, sizer).find((i) => i.clipId === "x1")!;
    const grab = { x: 0.25 * W, y: 0.5 * H };
    const drag = beginCanvasDrag(doc, item, "body", grab, undefined, [], guides)!;
    return resolveCanvasDrag(drag, { pointer: { x: 0.3 * W - css(4), y: grab.y }, shift: false, crop: false, centre: false, snapping, snapPx: SNAP_CSS_PX / K });
  }

  it("a moved clip's middle snaps onto a guide", () => {
    const r = towardGuide([{ id: "g", axis: "x", at: 0.3 }]);
    expect(transformOf(r).x).toBeCloseTo(0.3, 6);
    expect(r.guides.x).toBeCloseTo(0.3 * W, 6);
  });

  it("without the guide, or with snapping off, it follows the pointer", () => {
    expect(transformOf(towardGuide([])).x).toBeCloseTo((0.3 * W - css(4)) / W, 3);
    expect(transformOf(towardGuide([{ id: "g", axis: "x", at: 0.3 }], false)).x).toBeCloseTo((0.3 * W - css(4)) / W, 3);
  });
});
