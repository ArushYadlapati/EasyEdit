// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Preview } from "@/components/editor/preview";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { createClipboard } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import type { EditorState, EditorStore } from "@/lib/editor/store";
import { drawFrame } from "@/lib/render/compositor";
import type { Tool } from "@/lib/editor/tools";
import type { Guide, TimelineDoc } from "@/lib/timeline";
import { entry, makeStore, noticesOf, sampleDoc } from "../editor/fixtures";
import { fakeCtx } from "../render/fake-ctx";
import { act, fireEvent, render } from "../helpers/dom";
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

// In Fill the pane and the content box are at (200, 40), 572 × 992, and the canvas is the 540 × 960 frame 16 px
// inside, so k = 0.5: a canvas point (cx, cy) is at client (cx + 216, cy + 56), and one CSS px is 2 project px.
const RECTS = { pane: rect(200, 40, 572, 992), content: rect(200, 40, 572, 992), canvas: rect(216, 56, 540, 960) };

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
    return this.hasAttribute("data-board") ? 572 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-board") ? 992 : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("data-board")) return RECTS.pane;
    if (this instanceof HTMLCanvasElement) return RECTS.canvas;
    if (this.hasAttribute("data-canvas-overlay") || this.querySelector(":scope > [data-frame]")) return RECTS.content;
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

// The sample project at frame 10: the video c1 fills the frame, x1's text sits in its middle. guides: the project's.
// A frame share f is at client x 216 + 540f, y 56 + 960f.
function show(opts: { guides?: Guide[]; canEdit?: boolean; tool?: Tool } = {}) {
  const doc: TimelineDoc = { ...sampleDoc(), ...(opts.guides && { guides: opts.guides }) };
  const store: EditorStore = makeStore({ doc, canEdit: opts.canEdit ?? true });
  store.getState().seek(10);
  if (opts.tool) store.getState().setTool(opts.tool);
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: "fill" } }, { prefs: vi.fn(), keymap: vi.fn() });
  render(
    <EditorProvider store={store} settings={settings} clipboard={createClipboard()}>
      <ContextMenuProvider>
        <Preview />
      </ContextMenuProvider>
    </EditorProvider>,
  );
  return { store, st: () => store.getState() };
}

const X = (f: number) => 216 + 540 * f;
const Y = (f: number) => 56 + 960 * f;
const overlay = () => document.querySelector<HTMLElement>("[data-canvas-overlay]")!;
const press = (x: number, y: number) => fireEvent.pointerDown(overlay(), { clientX: x, clientY: y, button: 0, pointerId: 1 });
const move = (x: number, y: number) => fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, pointerId: 1 });
const release = (x: number, y: number) => fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, pointerId: 1 });
const drawnGuides = () => [...overlay().querySelectorAll("[data-project-guide]")].map((l) => l.getAttribute("data-project-guide"));
const labels = (s: EditorState) => s.queue.map((e) => e.label);
const MIDDLE: Guide = { id: "gm", axis: "x", at: 0.5 };

describe("guides on the preview", () => {
  it("draws the project's guides, and none while Show guides is off", () => {
    const { st } = show({ guides: [MIDDLE, { id: "gh", axis: "y", at: 0.25 }] });
    expect(drawnGuides()).toEqual(["gm", "gh"]);
    act(() => st().setShowGuides(false));
    expect(drawnGuides()).toEqual([]);
  });

  it("a press on a guide over a full-frame video picks the guide, not the video", () => {
    const { st } = show({ guides: [MIDDLE] });
    press(X(0.5) + 2, Y(0.2));
    release(X(0.5) + 2, Y(0.2));
    expect(st().guideId).toBe("gm");
    expect(st().selection.clipIds).toEqual([]);
    expect(overlay().querySelector('[data-project-guide="gm"]')?.getAttribute("data-selected")).toBe("true");
    expect(overlay().querySelector("[data-guide-label]")?.textContent).toBe("50%");
  });

  it("dragging a guide moves it once, on release", () => {
    const { st } = show({ guides: [MIDDLE] });
    press(X(0.5), Y(0.2));
    move(X(0.5) + 10, Y(0.2));
    frame();
    move(X(0.7), Y(0.2));
    frame();
    expect(st().queue).toEqual([]);
    release(X(0.7), Y(0.2));
    expect(labels(st())).toEqual(["move guide"]);
    expect(st().doc.guides?.[0].at).toBeCloseTo(0.7, 4);
  });

  it("a guide dragged off the frame is removed", () => {
    const { st } = show({ guides: [MIDDLE] });
    press(X(0.5), Y(0.2));
    move(X(0.5) + 10, Y(0.2));
    frame();
    release(X(-0.1), Y(0.2));
    expect(labels(st())).toEqual(["remove guide"]);
    expect(st().doc.guides).toBeUndefined();
  });

  it("the Guide tool places a vertical guide for a sideways drag", () => {
    const { st } = show({ tool: "guide" });
    press(X(0.3), Y(0.3));
    move(X(0.3) + 12, Y(0.3) + 2);
    frame();
    move(X(0.35), Y(0.3) + 2);
    frame();
    release(X(0.35), Y(0.3) + 2);
    expect(labels(st())).toEqual(["add guide"]);
    expect(st().doc.guides).toEqual([{ id: expect.any(String), axis: "x", at: expect.closeTo(0.35, 4) }]);
    expect(st().guideId).toBe(st().doc.guides?.[0].id);
    expect(st().tool).toBe("guide");
  });

  it("the Guide tool places a horizontal guide for an up-and-down drag, snapping to the centre", () => {
    const { st } = show({ tool: "guide" });
    press(X(0.3), Y(0.4));
    move(X(0.3) + 1, Y(0.4) + 12);
    frame();
    release(X(0.3) + 1, Y(0.5) + 3);
    expect(st().doc.guides).toEqual([{ id: expect.any(String), axis: "y", at: 0.5 }]);
  });

  it("a Guide tool click that never travels adds nothing, and Escape mid-drag adds nothing", () => {
    const { st } = show({ tool: "guide" });
    press(X(0.3), Y(0.3));
    release(X(0.3) + 1, Y(0.3));
    expect(st().queue).toEqual([]);
    press(X(0.3), Y(0.3));
    move(X(0.3) + 20, Y(0.3));
    frame();
    fireEvent.keyDown(window, { key: "Escape" });
    release(X(0.4), Y(0.3));
    expect(st().queue).toEqual([]);
    expect(st().gesture).toBeNull();
    expect(st().doc.guides).toBeUndefined();
  });

  it("a viewer sees the guides but a press picks nothing", () => {
    const { st } = show({ guides: [MIDDLE], canEdit: false });
    expect(drawnGuides()).toEqual(["gm"]);
    press(X(0.5), Y(0.2));
    release(X(0.5), Y(0.2));
    expect(st().guideId).toBeNull();
  });

  it("with Show guides off a press at a guide takes the clip under it", () => {
    const { st } = show({ guides: [MIDDLE] });
    act(() => st().setShowGuides(false));
    press(X(0.5), Y(0.2));
    release(X(0.5), Y(0.2));
    expect(st().guideId).toBeNull();
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("a guide dragged past the frame's edge shows it will be removed, and stops once back inside", () => {
    show({ guides: [MIDDLE] });
    const line = () => overlay().querySelector('[data-project-guide="gm"]')!;
    const label = () => overlay().querySelector("[data-guide-label]")?.textContent;
    press(X(0.5), Y(0.2));
    move(X(0.5) + 10, Y(0.2));
    frame();
    expect(line().hasAttribute("data-removing")).toBe(false);
    move(X(-0.1), Y(0.2));
    frame();
    expect(line().getAttribute("data-removing")).toBe("true");
    expect(line().getAttribute("class")).toMatch(/\bstroke-ed-danger\b/);
    expect(label()).toBe("Remove guide");
    move(X(0.6), Y(0.2));
    frame();
    expect(line().hasAttribute("data-removing")).toBe(false);
    expect(label()).toBe("60%");
  });

  it("a guide a teammate removes mid-drag ends the drag with a guide message, once", () => {
    const { store, st } = show({ guides: [MIDDLE] });
    const notices = noticesOf(store);
    press(X(0.5), Y(0.2));
    move(X(0.5) + 10, Y(0.2));
    frame();
    act(() => void st().applyRemote([entry(6, [{ op: "remove_guide", guideId: "gm" }])]));
    move(X(0.7), Y(0.2));
    frame();
    release(X(0.7), Y(0.2));
    expect(st().queue).toEqual([]);
    expect(st().gesture).toBeNull();
    expect(notices).toEqual(["That guide was removed by someone else."]);
  });

  it("a guide removed before its drag set anything ends it with the guide message too", () => {
    const { store, st } = show({ guides: [MIDDLE] });
    const notices = noticesOf(store);
    press(X(0.5), Y(0.2));
    act(() => void st().applyRemote([entry(6, [{ op: "remove_guide", guideId: "gm" }])]));
    move(X(0.7), Y(0.2));
    frame();
    release(X(0.7), Y(0.2));
    expect(st().queue).toEqual([]);
    expect(notices).toEqual(["That guide was removed by someone else."]);
  });

  it("a guide dragged back to where it started records nothing", () => {
    const { st } = show({ guides: [{ id: "gq", axis: "x", at: 0.3 }] });
    press(X(0.3), Y(0.2));
    move(X(0.3) + 20, Y(0.2));
    frame();
    move(X(0.3), Y(0.2));
    frame();
    release(X(0.3), Y(0.2));
    expect(st().queue).toEqual([]);
    expect(st().undoStack).toEqual([]);
    expect(st().gesture).toBeNull();
    expect(st().guideId).toBe("gq");
  });

  it("the Guide tool on an existing guide moves it rather than adding another", () => {
    const { st } = show({ guides: [MIDDLE], tool: "guide" });
    press(X(0.5) + 1, Y(0.3));
    move(X(0.5) + 1, Y(0.3) + 20); // an up-and-down start would place a horizontal guide if this added one
    frame();
    move(X(0.7), Y(0.3) + 20);
    frame();
    release(X(0.7), Y(0.3) + 20);
    expect(labels(st())).toEqual(["move guide"]);
    expect(st().doc.guides).toEqual([{ id: "gm", axis: "x", at: expect.closeTo(0.7, 4) }]);
    expect(st().guideId).toBe("gm");
    expect(st().tool).toBe("guide");
  });

  it("a double-click with the Guide tool doesn't open text for typing", () => {
    const { st } = show({ tool: "guide" });
    fireEvent.doubleClick(overlay(), { clientX: X(0.5), clientY: Y(0.5) });
    expect(st().textEditId).toBeNull();
    act(() => st().setTool("select"));
    fireEvent.doubleClick(overlay(), { clientX: X(0.5), clientY: Y(0.5) });
    expect(st().textEditId).toBe("x1");
  });
});
