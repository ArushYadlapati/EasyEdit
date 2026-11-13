import { describe, expect, it } from "vitest";
import {
  BOARD_PADDING_PX, ZOOM_PRESETS, boardLayout, boardScale, centreOf, scrollFor, zoomLabel, zoomName, type BoardLayout, type Size,
} from "@/lib/editor/board";
import type { BoardZoom } from "@/lib/editor/settings";

const DOC: Size = { width: 1080, height: 1920 };
const K4: Size = { width: 3840, height: 2160 };
const PANE: Size = { width: 572, height: 992 };

function layoutAt(zoom: BoardZoom, doc = DOC, pane = PANE): BoardLayout {
  return boardLayout(boardScale(zoom, doc, pane), doc, pane);
}

function expectLayout(layout: BoardLayout, k: number, frame: [number, number], content: [number, number], offset: [number, number]) {
  expect(layout.k).toBeCloseTo(k, 6);
  expect(layout.frame.width).toBeCloseTo(frame[0], 6);
  expect(layout.frame.height).toBeCloseTo(frame[1], 6);
  expect(layout.content.width).toBeCloseTo(content[0], 6);
  expect(layout.content.height).toBeCloseTo(content[1], 6);
  expect(layout.offset.x).toBeCloseTo(offset[0], 6);
  expect(layout.offset.y).toBeCloseTo(offset[1], 6);
}

describe("the board's sizes", () => {
  it("has the presets and a 16 px margin", () => {
    expect(ZOOM_PRESETS).toEqual([25, 50, 75, 100, 150, 200]);
    expect(BOARD_PADDING_PX).toBe(16);
  });

  it("Fill fits the frame inside the margin", () => {
    expectLayout(layoutAt("fill"), 0.5, [540, 960], [572, 992], [16, 16]);
  });

  it("Fill on a shorter pane", () => {
    expectLayout(layoutAt("fill", DOC, { width: 572, height: 592 }), 0.2916666666666667, [315, 560], [572, 592], [128.5, 16]);
  });

  it("25% sits in the middle of the pane", () => {
    expectLayout(layoutAt(25), 0.25, [270, 480], [572, 992], [151, 256]);
  });

  it("100% is one project pixel per CSS pixel, with the margin around it", () => {
    expectLayout(layoutAt(100), 1, [1080, 1920], [1112, 1952], [16, 16]);
  });

  it("200%", () => {
    expectLayout(layoutAt(200), 2, [2160, 3840], [2192, 3872], [16, 16]);
  });

  it("4K at 200%", () => {
    expectLayout(layoutAt(200, K4), 2, [7680, 4320], [7712, 4352], [16, 16]);
  });

  it("Fill never goes below zero on a pane smaller than the margin", () => {
    expect(boardScale("fill", DOC, { width: 0, height: 0 })).toBe(0);
    expect(boardScale("fill", DOC, { width: 20, height: 900 })).toBe(0);
  });
});

describe("keeping the middle in view", () => {
  it("Fill → 100% keeps the middle in view", () => {
    const centre = centreOf(layoutAt("fill"), PANE, { left: 0, top: 0 });
    expect(centre.x).toBeCloseTo(540, 6);
    expect(centre.y).toBeCloseTo(960, 6);
    expect(scrollFor(centre, layoutAt(100), PANE)).toEqual({ left: 270, top: 480 });
  });

  it("100% → 200%", () => {
    const centre = centreOf(layoutAt(100), PANE, { left: 270, top: 480 });
    expect(scrollFor(centre, layoutAt(200), PANE)).toEqual({ left: 810, top: 1440 });
  });

  it("200% → 25%", () => {
    const centre = centreOf(layoutAt(200), PANE, { left: 810, top: 1440 });
    expect(scrollFor(centre, layoutAt(25), PANE)).toEqual({ left: 0, top: 0 });
  });

  it("4K Fill → 200%", () => {
    const centre = centreOf(layoutAt("fill", K4), PANE, { left: 0, top: 0 });
    expect(centre.x).toBeCloseTo(1920, 6);
    expect(centre.y).toBeCloseTo(1080, 6);
    expect(scrollFor(centre, layoutAt(200, K4), PANE)).toEqual({ left: 3570, top: 1680 });
  });

  it("a scroll is clamped to the content's far edge", () => {
    expect(scrollFor({ x: 1080, y: 1920 }, layoutAt(100), PANE)).toEqual({ left: 1112 - 572, top: 1952 - 992 });
  });
});

describe("the zoom's names", () => {
  it("reads Fill or a percentage", () => {
    expect(zoomLabel("fill")).toBe("Fill");
    expect(zoomLabel(150)).toBe("150%");
    expect(zoomName("fill")).toBe("Preview zoom: Fill to size");
    expect(zoomName(150)).toBe("Preview zoom: 150%");
  });
});
