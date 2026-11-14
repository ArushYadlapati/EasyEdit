import { describe, expect, it } from "vitest";
import { beginCanvasDrag, resolveCanvasDrag, type CanvasDragInput, type CanvasDragResult, type Grip } from "@/lib/editor/canvas-drag";
import { canvasItems } from "@/lib/editor/canvas-geometry";
import type { Sizer } from "@/lib/editor/clip-box";
import type { Point } from "@/lib/editor/board";
import { createEmptyDoc, type Clip, type MediaClip, type TextClip, type TimelineDoc, type Transform } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// A handle drag keeps the shape unless the free key is held; Shift keeps it even then, and Alt crops whatever is held.
// Frame 1080 × 1920. "img" is a 200 × 100 picture, fitted 1080 × 540 about (540, 960); text measures half its font
// size per character, so "hi" at 64 is 64 wide.
const sizer: Sizer = {
  source: (clip) => (clip.assetId === "img" ? { width: 200, height: 100 } : null),
  measure: (clip: TextClip, s: string) => (s.length * clip.style.fontSize) / 2,
};

function imageDoc(transform: Partial<Transform> = {}): TimelineDoc {
  const doc = createEmptyDoc("short_9x16");
  const base = video("i1", 0, 30, { type: "image", assetId: "img" }) as MediaClip;
  doc.tracks[0].clips = [{ ...base, transform: { ...base.transform, fit: "contain", ...transform } } as Clip];
  return doc;
}

type Mods = Partial<Omit<CanvasDragInput, "pointer">>;

const input = (pointer: Point, mods: Mods = {}): CanvasDragInput => ({ pointer, shift: false, alt: false, free: false, snapping: false, snapPx: 12, ...mods });

function dragOn(doc: TimelineDoc, clipId: string, grip: Grip, grab: Point) {
  const item = canvasItems(doc, 10, sizer).find((i) => i.clipId === clipId)!;
  const drag = beginCanvasDrag(doc, item, grip, grab);
  if (!drag) throw new Error("no drag");
  return (pointer: Point, mods: Mods = {}) => resolveCanvasDrag(drag, input(pointer, mods));
}

const image = (grip: Grip, grab: Point, transform: Partial<Transform> = {}) => dragOn(imageDoc(transform), "i1", grip, grab);

const transformOf = (r: CanvasDragResult) => {
  expect(r.ops).toHaveLength(1);
  const op = r.ops[0] as { op: string; clipId: string; patch: { transform: Record<string, unknown> } };
  expect(op.op).toBe("update_clip");
  return op.patch.transform;
};

const P = (x: number, y: number): Point => ({ x, y });

describe("the keys a handle drag reads", () => {
  it("a side handle keeps the shape by default, scaling both about the opposite side's middle", () => {
    expect(transformOf(image("e", P(1080, 960))(P(972, 960)))).toEqual({ x: 0.45, scale: 0.9 });
    expect(transformOf(image("n", P(540, 690))(P(540, 744)))).toEqual({ y: 0.5141, scale: 0.9 });
  });

  it("a corner keeps the shape by default, along the box's diagonal", () => {
    expect(transformOf(image("se", P(1080, 1230))(P(1134, 1230)))).toEqual({ x: 0.52, y: 0.5056, scale: 1.04 });
    expect(transformOf(image("ne", P(1080, 690))(P(1134, 636)))).toEqual({ x: 0.53, y: 0.4916, scale: 1.06 });
  });

  it("text and video keep the shape by default too", () => {
    expect(transformOf(dragOn(sampleDoc(), "x1", "e", P(572, 960))(P(604, 960)))).toEqual({ x: 0.5148, scale: 1.5 });
    // c1 has no known source, so it is the whole frame: e at (1080, 960).
    expect(transformOf(dragOn(sampleDoc(), "c1", "e", P(1080, 960))(P(972, 960)))).toEqual({ x: 0.45, scale: 0.9 });
  });

  it("the free key squashes and stretches", () => {
    expect(transformOf(image("e", P(1080, 960))(P(972, 960), { free: true }))).toEqual({ x: 0.45, stretch: 0.9 });
    expect(transformOf(image("se", P(1080, 1230))(P(1134, 1284), { free: true }))).toEqual({ x: 0.525, y: 0.5141, scale: 1.1, stretch: 0.9545 });
    expect(transformOf(dragOn(sampleDoc(), "x1", "e", P(572, 960))(P(604, 960), { free: true }))).toEqual({ x: 0.5148, stretch: 1.5 });
  });

  it("Shift keeps the shape even with the free key held", () => {
    expect(transformOf(image("e", P(1080, 960))(P(972, 960), { free: true, shift: true }))).toEqual({ x: 0.45, scale: 0.9 });
    expect(transformOf(image("se", P(1080, 1230))(P(1134, 1230), { free: true, shift: true }))).toEqual({ x: 0.52, y: 0.5056, scale: 1.04 });
    expect(transformOf(image("se", P(1080, 1230))(P(1134, 1230), { shift: true }))).toEqual({ x: 0.52, y: 0.5056, scale: 1.04 });
  });

  it("Alt crops whatever else is held, and Alt+Shift keeps the kept part's shape", () => {
    for (const free of [false, true]) {
      expect(transformOf(image("w", P(0, 960))(P(108, 960), { alt: true, free }))).toEqual({ crop: { left: 0.1, top: 0, right: 0, bottom: 0 } });
      expect(transformOf(image("e", P(1080, 960))(P(972, 960), { alt: true, shift: true, free }))).toEqual({
        crop: { left: 0, top: 0.05, right: 0.1, bottom: 0.05 },
      });
    }
  });

  it("the free key is read on every resolve", () => {
    const e = image("e", P(1080, 960));
    expect(transformOf(e(P(972, 960)))).toEqual({ x: 0.45, scale: 0.9 });
    expect(transformOf(e(P(972, 960), { free: true }))).toEqual({ x: 0.45, stretch: 0.9 });
    expect(transformOf(e(P(972, 960)))).toEqual({ x: 0.45, scale: 0.9 });
  });

  it("the free key does not change a move or a turn", () => {
    const move = dragOn(sampleDoc(), "x1", "body", P(540, 960));
    expect(move(P(594, 970), { free: true })).toEqual(move(P(594, 970)));
    const turn = dragOn(sampleDoc(), "x1", "rotate", P(540, 860));
    expect(turn(P(640, 960), { free: true })).toEqual(turn(P(640, 960)));
  });
});
