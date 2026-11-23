// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Preview } from "@/components/editor/preview";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { createClipboard } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import type { EditorInit } from "@/lib/editor/types";
import { drawFrame } from "@/lib/render/compositor";
import { applyOps, newShapeClip, type ShapeClip, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { fakeCtx } from "../render/fake-ctx";
import { act, fireEvent, render, screen } from "../helpers/dom";
import { rect } from "../helpers/layout";

vi.mock("@/lib/render/compositor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/render/compositor")>();
  return { ...actual, drawFrame: vi.fn() };
});

// A pool that plays nothing and knows no picture, so every video is the frame-sized placeholder.
const { pool } = vi.hoisted(() => ({
  pool: {
    sync: () => {},
    preload: () => {},
    resolveSource: () => null,
    label: () => "",
    onChange: () => () => {},
    dispose: () => {},
  },
}));
vi.mock("@/components/editor/media/media-pool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/editor/media/media-pool")>()),
  createMediaPool: () => pool,
}));

// Where the browser would put things, at k = 0.5 in Fill. The narrow pane is the one preview-canvas.test.tsx uses: the
// pane and the content box at (200, 40), 572 × 992, with the 540 × 960 frame 16 px inside, so the board has 16 px
// round the frame and no room for a handle beside it. The wide pane is 972 × 992 with the frame in its middle, 216 px
// in, as a 9:16 reel shows in a wide window: room at the sides, none above or below. A canvas point (cx, cy) is at
// overlay (cx + 16, cy + 16) in the narrow pane and (cx + 216, cy + 16) in the wide one; client is overlay + (200, 40).
// The visible pane is overlay 0..572 or 0..972 across and 0..992 down, and a handle needs 12 px from its edge.
type Rects = { pane: DOMRect; content: DOMRect; canvas: DOMRect };
const NARROW = { rects: { pane: rect(200, 40, 572, 992), content: rect(200, 40, 572, 992), canvas: rect(216, 56, 540, 960) }, size: { width: 572, height: 992 } };
const WIDE = { rects: { pane: rect(200, 40, 972, 992), content: rect(200, 40, 972, 992), canvas: rect(416, 56, 540, 960) }, size: { width: 972, height: 992 } };
let rects: Rects = NARROW.rects;
let paneSize = NARROW.size;

// A hand-run animation-frame queue.
let frames: Map<number, FrameRequestCallback>;
let lastId: number;

function frame() {
  const due = [...frames.values()];
  frames.clear();
  act(() => {
    for (const cb of due) cb(0);
  });
}

beforeEach(() => {
  rects = NARROW.rects;
  paneSize = NARROW.size;
  frames = new Map();
  lastId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++lastId, cb);
    return lastId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-board") ? paneSize.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-board") ? paneSize.height : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("data-board")) return rects.pane;
    if (this instanceof HTMLCanvasElement) return rects.canvas;
    if (this.hasAttribute("data-canvas-overlay") || this.querySelector(":scope > [data-frame]")) return rects.content;
    return rect(0, 0, 0, 0);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeCtx().ctx as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(drawFrame).mockClear();
});

// A 400 long arrow lying flat across the middle of the 1080 × 1920 frame: tail at project (340, 960), tip at (740, 960).
// In the wide pane at k = 0.5 that is overlay (386, 496) to (586, 496), its middle at overlay (486, 496), client (686, 536).
function arrowDoc(extra: Partial<ShapeClip> = {}): TimelineDoc {
  const clip: ShapeClip = { id: "ar", ...newShapeClip("arrow", { start: 0, duration: 60, x: 0.5, y: 0.5, width: 400, height: 0 }, { width: 1080, height: 1920 }), ...extra };
  return applyOps(sampleDoc(), [
    { op: "add_track", track: { id: "s1", kind: "shape", name: "Shapes 1" }, index: 0 },
    { op: "add_clip", trackId: "s1", clip },
  ]).doc;
}

function show(opts: { doc?: TimelineDoc; over?: Partial<EditorInit> } = {}) {
  rects = WIDE.rects;
  paneSize = WIDE.size;
  const store: EditorStore = makeStore({ doc: opts.doc ?? arrowDoc(), ...opts.over });
  store.getState().seek(10);
  store.getState().select(["ar"]);
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: "fill" } }, { prefs: vi.fn(), keymap: vi.fn() });
  const tree: ReactNode = (
    <EditorProvider store={store} settings={settings} clipboard={createClipboard()}>
      <ContextMenuProvider>
        <Preview />
      </ContextMenuProvider>
    </EditorProvider>
  );
  render(tree);
  frame();
  return { st: () => store.getState(), arrow: () => findClip(viewDoc(store.getState()), "ar")!.clip as ShapeClip };
}

const overlay = () => document.querySelector<HTMLElement>("[data-canvas-overlay]")!;
const grips = () => [...document.querySelectorAll<HTMLElement>("[data-shape-end]")].map((h) => h.dataset.shapeEnd);
const grip = (name: string) => document.querySelector<HTMLElement>(`[data-shape-end="${name}"]`)!;
const placeOf = (name: string) => [grip(name).style.left, grip(name).style.top];

const pointer = { button: 0, pointerId: 1 };
const press = (name: string, x: number, y: number) => fireEvent.pointerDown(grip(name), { clientX: x, clientY: y, ...pointer });
const move = (x: number, y: number) => fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, ...pointer });
const release = (x: number, y: number) => fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, ...pointer });
function drag(name: string, from: [number, number], to: [number, number]) {
  press(name, ...from);
  move(...to);
  frame();
  release(...to);
  frame();
}

describe("an arrow's points on the preview", () => {
  it("a straight arrow shows its two ends and one small handle in its middle", () => {
    show();
    expect(grips()).toEqual(["add:0", "tail", "tip"]);
    expect(placeOf("tail")).toEqual(["386px", "496px"]);
    expect(placeOf("tip")).toEqual(["586px", "496px"]);
    expect(placeOf("add:0")).toEqual(["486px", "496px"]);
    expect(grip("add:0").dataset.kind).toBe("add");
    expect(grip("tail").dataset.kind).toBe("end");
  });

  it("dragging the middle handle anywhere puts a point there, and the line passes through it", () => {
    const { st, arrow } = show();
    // 50 px right and 100 px up on screen: 100 and 200 project pixels, a quarter and a half of the arrow's length.
    drag("add:0", [686, 536], [736, 436]);
    expect(arrow().points).toEqual([{ x: 0.25, y: -0.5 }]);
    expect(st().queue.map((q) => q.label)).toEqual(["bend arrow"]);
    // The point has a handle where it was dropped, with a small one in each half of the line beside it.
    expect(grips()).toEqual(["add:0", "add:1", "tail", "point:0", "tip"]);
    expect(placeOf("point:0")).toEqual(["536px", "396px"]);
    expect(grip("point:0").dataset.kind).toBe("point");
    // The ends did not move.
    expect(placeOf("tail")).toEqual(["386px", "496px"]);
    expect(placeOf("tip")).toEqual(["586px", "496px"]);
  });

  it("a point can be dragged again, off to the side and past the arrow's tip", () => {
    const { arrow } = show({ doc: arrowDoc({ points: [{ x: 0, y: 0.25 }] }) });
    expect(placeOf("point:0")).toEqual(["486px", "546px"]);
    drag("point:0", [686, 586], [886, 636]); // overlay (686, 596): project (940, 1160), 200 px past the tip
    expect(arrow().points).toEqual([{ x: 1, y: 0.5 }]);
    expect(placeOf("point:0")).toEqual(["686px", "596px"]);
  });

  it("moving an end leaves the points where they are", () => {
    const { arrow } = show({ doc: arrowDoc({ points: [{ x: 0, y: 0.25 }] }) });
    drag("tip", [786, 536], [786, 636]); // the tip goes 200 project pixels down
    // The arrow's turn is kept to a hundredth of a degree, so places are within a fraction of a pixel.
    const near = (name: string, x: number, y: number) => {
      expect(parseFloat(grip(name).style.left), name).toBeCloseTo(x, 0);
      expect(parseFloat(grip(name).style.top), name).toBeCloseTo(y, 0);
    };
    near("tip", 586, 596);
    near("tail", 386, 496);
    near("point:0", 486, 546);
    expect(arrow().points).toHaveLength(1);
  });

  it("Escape during a drag puts the line back", () => {
    const { st, arrow } = show();
    press("add:0", 686, 536);
    move(736, 436);
    expect(arrow().points).toEqual([{ x: 0.25, y: -0.5 }]);
    fireEvent.keyDown(window, { key: "Escape" });
    frame();
    expect(arrow().points ?? []).toEqual([]);
    expect(st().queue).toEqual([]);
    expect(grips()).toEqual(["add:0", "tail", "tip"]);
  });

  it("a double-click on a point takes it off the line", () => {
    const { st, arrow } = show({ doc: arrowDoc({ points: [{ x: -0.2, y: 0.25 }, { x: 0.2, y: -0.25 }] }) });
    expect(grips()).toEqual(["add:0", "add:1", "add:2", "tail", "point:0", "point:1", "tip"]);
    fireEvent.doubleClick(grip("point:0"));
    frame();
    expect(arrow().points).toEqual([{ x: 0.2, y: -0.25 }]);
    expect(st().queue.map((q) => q.label)).toEqual(["bend arrow"]);
    expect(grips()).toEqual(["add:0", "add:1", "tail", "point:0", "tip"]);
    // A double-click on an end or a small handle removes nothing.
    fireEvent.doubleClick(grip("tip"));
    fireEvent.doubleClick(grip("add:0"));
    expect(arrow().points).toHaveLength(1);
  });

  it("a double-click told to the layer itself, as a held pointer makes it, still finds the point under it", () => {
    const { arrow } = show({ doc: arrowDoc({ points: [{ x: -0.2, y: 0.25 }, { x: 0.2, y: -0.25 }] }) });
    const under = vi.spyOn(document, "elementFromPoint").mockReturnValue(grip("point:1").firstElementChild);
    fireEvent.doubleClick(overlay(), { clientX: 726, clientY: 486 });
    frame();
    expect(under).toHaveBeenCalledWith(726, 486);
    expect(arrow().points).toEqual([{ x: -0.2, y: 0.25 }]);
    // Away from any handle, a double-click removes nothing.
    under.mockReturnValue(overlay());
    fireEvent.doubleClick(overlay(), { clientX: 300, clientY: 300 });
    expect(arrow().points).toHaveLength(1);
  });

  it("a right-click on a point offers to remove it or straighten the line", () => {
    const { arrow } = show({ doc: arrowDoc({ points: [{ x: -0.2, y: 0.25 }, { x: 0.2, y: -0.25 }] }) });
    fireEvent.contextMenu(grip("point:1"), { clientX: 700, clientY: 500 });
    expect(screen.getByRole("menu", { name: "Point" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove point" }));
    frame();
    expect(arrow().points).toEqual([{ x: -0.2, y: 0.25 }]);
    fireEvent.contextMenu(grip("point:0"), { clientX: 700, clientY: 500 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Straighten line" }));
    frame();
    expect(arrow().points).toEqual([]);
    expect(grips()).toEqual(["add:0", "tail", "tip"]);
  });

  it("an arrow with twelve points has no room for another, so it shows no small handles", () => {
    show({ doc: arrowDoc({ points: Array.from({ length: 12 }, (_, i) => ({ x: -0.4 + i * 0.07, y: i % 2 ? 0.2 : -0.2 })) }) });
    expect(grips().filter((g) => g!.startsWith("add:"))).toEqual([]);
    expect(grips().filter((g) => g!.startsWith("point:"))).toHaveLength(12);
  });

  it("someone who can't edit sees no handles", () => {
    show({ over: { canEdit: false } });
    expect(grips()).toEqual([]);
  });
});

// A drag on the preview with a drawing tool, from project (200, 200) to (400, 400): client (516, 156) to (616, 256).
describe("the Shape, Line and Arrow tools on the preview", () => {
  function drawWith(pick: (s: ReturnType<EditorStore["getState"]>) => void) {
    const shown = show({ doc: sampleDoc() });
    act(() => {
      shown.st().select([]);
      pick(shown.st());
    });
    fireEvent.pointerDown(overlay(), { clientX: 516, clientY: 156, ...pointer });
    move(616, 256);
    frame();
    release(616, 256);
    frame();
    const drawn = shown.st().doc.tracks.find((t) => t.kind === "shape")?.clips[0] as ShapeClip | undefined;
    return { ...shown, drawn };
  }

  it("the Line tool draws a line from the press to the release, then hands back to Selection", () => {
    const { st, drawn } = drawWith((s) => s.setTool("line"));
    expect(drawn).toMatchObject({ shape: "arrow", heads: "none", height: 0 });
    expect(drawn!.width).toBeCloseTo(282.84, 1);
    expect(drawn!.transform.rotation).toBe(45);
    expect(st().tool).toBe("select");
    expect(st().selection.clipIds).toEqual([drawn!.id]);
    expect(st().queue.map((q) => q.label)).toEqual(["add shape"]);
    // Selected, it shows its ends and the small handle that curves it.
    expect(grips()).toEqual(["add:0", "tail", "tip"]);
  });

  it("the Arrow tool draws an arrow with a head at its tip", () => {
    const { drawn } = drawWith((s) => s.setTool("arrow"));
    expect(drawn).toMatchObject({ shape: "arrow", heads: "end", height: 0 });
  });

  it("the Shape tool draws the shape picked from its list, never a line", () => {
    const { drawn } = drawWith((s) => {
      s.setTool("shape");
      s.setShapeTool("star");
    });
    expect(drawn).toMatchObject({ shape: "star", width: 200, height: 200 });
    expect(drawn!.heads).toBeUndefined();
  });

  it("the Line and Arrow tools show a crosshair over the preview", () => {
    const { st } = show({ doc: sampleDoc() });
    act(() => void st().setTool("line"));
    expect(overlay().className).toContain("cursor-crosshair");
    act(() => void st().setTool("arrow"));
    expect(overlay().className).toContain("cursor-crosshair");
    act(() => void st().setTool("select"));
    expect(overlay().className).not.toContain("cursor-crosshair");
  });
});
