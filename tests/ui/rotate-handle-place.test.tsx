// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Preview } from "@/components/editor/preview";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { createClipboard } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import { findClip, viewDoc, type EditorState, type EditorStore } from "@/lib/editor/store";
import type { EditorInit } from "@/lib/editor/types";
import { drawFrame } from "@/lib/render/compositor";
import type { Clip, TimelineDoc, Transform } from "@/lib/timeline";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { fakeCtx } from "../render/fake-ctx";
import { act, cleanup, fireEvent, render } from "../helpers/dom";
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

function withTransform(doc: TimelineDoc, clipId: string, transform: Partial<Transform>): TimelineDoc {
  for (const track of doc.tracks) {
    track.clips = track.clips.map((c) => (c.id === clipId ? ({ ...c, transform: { ...c.transform, ...transform } } as Clip) : c));
  }
  return doc;
}

function show(opts: { pane?: typeof NARROW; over?: Partial<EditorInit>; selected: string[] }) {
  rects = (opts.pane ?? NARROW).rects;
  paneSize = (opts.pane ?? NARROW).size;
  const store: EditorStore = makeStore(opts.over);
  store.getState().seek(10);
  store.getState().select(opts.selected);
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: "fill" } }, { prefs: vi.fn(), keymap: vi.fn() });
  const tree: ReactNode = (
    <EditorProvider store={store} settings={settings} clipboard={createClipboard()}>
      <ContextMenuProvider>
        <Preview />
      </ContextMenuProvider>
    </EditorProvider>
  );
  render(tree);
  return { st: () => store.getState() };
}

const overlay = () => document.querySelector<HTMLElement>("[data-canvas-overlay]")!;
const handle = (grip: string) => document.querySelector<HTMLElement>(`[data-canvas-handle="${grip}"]`);
const placeOf = (grip: string) => [handle(grip)!.style.left, handle(grip)!.style.top];
const spotOf = (grip: string) => ({ x: parseFloat(handle(grip)!.style.left), y: parseFloat(handle(grip)!.style.top) });
const others = () => [...document.querySelectorAll<HTMLElement>("[data-canvas-handle]")].filter((h) => h.dataset.canvasHandle !== "rotate");
const transformOf = (s: EditorState, clipId: string) => findClip(viewDoc(s), clipId)!.clip.transform;

const pointer = { button: 0, pointerId: 1 };
const pressRotate = (x: number, y: number) => fireEvent.pointerDown(handle("rotate")!, { clientX: x, clientY: y, ...pointer });
const move = (x: number, y: number) => fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, ...pointer });
const release = (x: number, y: number) => fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, ...pointer });

// The rotate handle keeps off the clip's picture while the pane has room past one of its sides: past the top first,
// then the bottom, the right and the left, along the clip's own axes.
describe("where the rotate handle goes", () => {
  it("a full-frame clip in a pane with room only at the sides has its rotate handle beside it, off the picture", () => {
    // c1 fills the frame, overlay 216..756 × 16..976. Above and below are 16 px of board, too little.
    const { st } = show({ pane: WIDE, selected: ["c1"] });
    expect(placeOf("rotate")).toEqual(["780px", "496px"]);
    const at = spotOf("rotate");
    expect(at.x > 756 || at.x < 216 || at.y < 16 || at.y > 976).toBe(true);
    // A drag from it still turns the clip about its centre, client (686, 536): a quarter turn clockwise.
    pressRotate(980, 536);
    move(686, 830);
    frame();
    release(686, 830);
    expect(transformOf(st(), "c1").rotation).toBe(90);
  });

  it("a short drag where the rotate handle used to sit moves the picture", () => {
    // That was 36 px inside the top edge, overlay (486, 52), client (686, 92).
    const { st } = show({ pane: WIDE, selected: ["c1"] });
    expect(placeOf("rotate")).not.toEqual(["486px", "52px"]);
    fireEvent.pointerDown(overlay(), { clientX: 686, clientY: 92, ...pointer });
    move(696, 92);
    frame();
    release(696, 92);
    expect(st().queue.map((q) => q.label)).toEqual(["position change"]);
    expect(transformOf(st(), "c1").x).toBe(0.5185);
    expect(transformOf(st(), "c1").rotation).toBe(0);
  });

  it("a clip with room above keeps its rotate handle 24 px above, even with room at the sides", () => {
    // x1's box is overlay 470..502 × 476.8..515.2 in the wide pane, and 270..302 in the narrow one.
    show({ pane: WIDE, selected: ["x1"] });
    expect(placeOf("n")).toEqual(["486px", "476.8px"]);
    expect(placeOf("rotate")).toEqual(["486px", "452.8px"]);
    document.body.innerHTML = "";
    show({ selected: ["x1"] });
    expect(placeOf("rotate")).toEqual(["286px", "452.8px"]);
  });

  it("a clip with no room above but room below has its rotate handle 24 px below", () => {
    // Near the top, x1's box is overlay 35.2..73.6 down: 24 px above is within 12 px of the pane's edge.
    show({ over: { doc: withTransform(sampleDoc(), "x1", { y: 0.04 }) }, selected: ["x1"] });
    expect(placeOf("n")).toEqual(["286px", "35.2px"]);
    expect(placeOf("s")).toEqual(["286px", "73.6px"]);
    expect(placeOf("rotate")).toEqual(["286px", "97.6px"]);
  });

  it("below wins over the sides", () => {
    show({ pane: WIDE, over: { doc: withTransform(sampleDoc(), "x1", { y: 0.04 }) }, selected: ["x1"] });
    expect(placeOf("rotate")).toEqual(["486px", "97.6px"]);
  });

  it("with no room past the right side either, the rotate handle goes past the left", () => {
    // c1 moved right is overlay 432..972 across in the wide pane: past its right side is off the pane.
    show({ pane: WIDE, over: { doc: withTransform(sampleDoc(), "c1", { x: 0.9 }) }, selected: ["c1"] });
    expect(placeOf("w")).toEqual(["432px", "496px"]);
    expect(placeOf("rotate")).toEqual(["408px", "496px"]);
  });

  it("a small clip's rotate handle goes 36 px past the bottom when n and s are pushed out", () => {
    // x1 at half size is 16 × 19.2, overlay 278..294 × 16..35.2 near the top: n and s sit 12 px out.
    show({ over: { doc: withTransform(sampleDoc(), "x1", { scale: 0.5, y: 0.01 }) }, selected: ["x1"] });
    expect(placeOf("s")).toEqual(["286px", "47.2px"]);
    expect(placeOf("rotate")).toEqual(["286px", "71.2px"]);
  });

  it("a thin clip's rotate handle goes 36 px past the right when e and w are pushed out", () => {
    // A pane 80 px tall has room for a handle only 12..68 down. x1 squashed to 64 × 19.2 is overlay 454..518 ×
    // 30.4..49.6, with e and w 12 px out: 24 px above or below is off the pane, 36 px past the right is not.
    const SHORT = { rects: { ...WIDE.rects, pane: rect(200, 40, 972, 80) }, size: { width: 972, height: 80 } };
    show({ pane: SHORT, over: { doc: withTransform(sampleDoc(), "x1", { scale: 0.5, stretch: 4, y: 0.025 }) }, selected: ["x1"] });
    expect(placeOf("e")).toEqual(["530px", "40px"]);
    expect(placeOf("rotate")).toEqual(["554px", "40px"]);
  });

  it("a clip bigger than the pane on every side keeps its rotate handle 36 px inside from n", () => {
    show({ pane: WIDE, over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    expect(placeOf("n")).toEqual(["486px", "12px"]);
    expect(placeOf("rotate")).toEqual(["486px", "48px"]);
    document.body.innerHTML = "";
    // In the narrow pane even a full-frame clip has no room past any side.
    show({ selected: ["c1"] });
    expect(placeOf("rotate")).toEqual(["286px", "52px"]);
  });

  it("a turned clip's rotate handle goes past its own sides", () => {
    // A quarter turn clockwise lays c1 across the wide pane, overlay 6..966 × 226..766. Its top is now on the right
    // and its right side at the bottom, so past its top and bottom is off the pane, and past its right is below it.
    show({ pane: WIDE, over: { doc: withTransform(sampleDoc(), "c1", { rotation: 90 }) }, selected: ["c1"] });
    expect(placeOf("e")).toEqual(["486px", "766px"]);
    expect(placeOf("rotate")).toEqual(["486px", "790px"]);
    document.body.innerHTML = "";
    // A quarter turn the other way puts its right side at the top: past it is above the picture.
    show({ pane: WIDE, over: { doc: withTransform(sampleDoc(), "c1", { rotation: -90 }) }, selected: ["c1"] });
    expect(placeOf("e")).toEqual(["486px", "226px"]);
    expect(placeOf("rotate")).toEqual(["486px", "202px"]);
  });

  it("a turned clip's rotate handle follows a slanted side", () => {
    // Turned 30°, x1's right side faces down-right: 24 px past its middle along the clip's across axis.
    show({ over: { doc: withTransform(sampleDoc(), "x1", { rotation: 30, y: 0.03 }) }, selected: ["x1"] });
    const n = spotOf("n");
    const s = spotOf("s");
    const e = spotOf("e");
    const r = spotOf("rotate");
    // Above n is off the pane; past s is the first spot with room.
    expect(n.y - 24 * Math.cos(Math.PI / 6)).toBeLessThan(12);
    expect(r.x).toBeCloseTo(s.x - 24 * Math.sin(Math.PI / 6), 1);
    expect(r.y).toBeCloseTo(s.y + 24 * Math.cos(Math.PI / 6), 1);
    expect(Math.hypot(r.x - e.x, r.y - e.y)).toBeGreaterThan(12);
  });

  it("the rotate handle never sits within 12 px of another handle shown", () => {
    // x1 at the pane's corners, edges and middle, turned several ways.
    for (const rotation of [0, 30, 45, 90, 135, 180, -60]) {
      for (const [x, y] of [[0.02, 0.01], [0.98, 0.01], [0.02, 0.99], [0.98, 0.99], [0.5, 0.03], [0.5, 0.5]]) {
        show({ over: { doc: withTransform(sampleDoc(), "x1", { rotation, x, y }) }, selected: ["x1"] });
        const r = spotOf("rotate");
        for (const h of others()) {
          const d = Math.hypot(parseFloat(h.style.left) - r.x, parseFloat(h.style.top) - r.y);
          expect(d, `${h.dataset.canvasHandle} at rotation ${rotation}, x ${x}, y ${y}`).toBeGreaterThanOrEqual(12);
        }
        cleanup();
      }
    }
  });
});
