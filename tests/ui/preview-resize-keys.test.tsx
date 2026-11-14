// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Preview } from "@/components/editor/preview";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { createClipboard } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore, type SettingsStore } from "@/lib/editor/settings";
import type { EditorState, EditorStore } from "@/lib/editor/store";
import { drawFrame } from "@/lib/render/compositor";
import { makeStore } from "../editor/fixtures";
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
// inside, so k = 0.5: a canvas point (cx, cy) is at client (cx + 216, cy + 56).
const PANE = rect(200, 40, 572, 992);
const CANVAS = rect(216, 56, 540, 960);

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
    if (this.hasAttribute("data-board")) return PANE;
    if (this instanceof HTMLCanvasElement) return CANVAS;
    if (this.hasAttribute("data-canvas-overlay") || this.querySelector(":scope > [data-frame]")) return PANE;
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

// x1 ("hi", 64 × 76.8 in the middle of the frame) selected, at frame 10.
function show() {
  const store: EditorStore = makeStore();
  store.getState().seek(10);
  store.getState().select(["x1"]);
  const settings: SettingsStore = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: "fill" } }, { prefs: vi.fn(), keymap: vi.fn() });
  render(
    <EditorProvider store={store} settings={settings} clipboard={createClipboard()}>
      <ContextMenuProvider>
        <Preview />
      </ContextMenuProvider>
    </EditorProvider>,
  );
  return { st: () => store.getState(), settings };
}

const overlay = () => document.querySelector<HTMLElement>("[data-canvas-overlay]")!;

type Mods = { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };
const move = (x: number, y: number, mods: Mods = {}) => fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, pointerId: 1, ...mods });
const release = (x: number, y: number, mods: Mods = {}) => fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, pointerId: 1, ...mods });

// x1's handles at k = 0.5: e is at client (502, 536) and se at (502, 555.2).
const handle = (grip: string) => document.querySelector<HTMLElement>(`[data-canvas-handle="${grip}"]`)!;
const pressHandle = (grip: string, x: number, y: number, mods: Mods = {}) =>
  fireEvent.pointerDown(handle(grip), { clientX: x, clientY: y, button: 0, pointerId: 1, ...mods });

const labelsOf = (s: EditorState) => s.queue.map((q) => q.label);
const patchOf = (s: EditorState) => (s.queue[0].ops[0] as { patch: unknown }).patch;
const gesturePatch = (s: EditorState) => (s.gesture!.ops[0] as { patch: unknown }).patch;

// The e handle dragged 16 CSS px out: the shape kept, or the width alone stretched.
const KEPT = { transform: { x: 0.5148, scale: 1.5 } };
const STRETCHED = { transform: { x: 0.5148, stretch: 1.5 } };

function dragE(mods: Mods = {}) {
  pressHandle("e", 502, 536, mods);
  move(518, 536, mods);
  frame();
  release(518, 536, mods);
}

describe("the keys a handle drag reads on the preview", () => {
  it("a side handle keeps the shape by default", () => {
    const { st } = show();
    dragE();
    expect(labelsOf(st())).toEqual(["size change"]);
    expect(patchOf(st())).toEqual(KEPT);
  });

  it("a corner keeps the shape by default", () => {
    const { st } = show();
    // Off the box's diagonal, so a free resize would stretch it.
    pressHandle("se", 502, 555.2);
    move(518, 555.2);
    frame();
    release(518, 555.2);
    const { transform } = patchOf(st()) as { transform: Record<string, number> };
    expect(transform).not.toHaveProperty("stretch");
    expect(transform.scale).toBeCloseTo(1.2049, 3);
  });

  it("away from a Mac, the Windows key or Ctrl squashes and stretches", () => {
    let { st } = show();
    dragE({ metaKey: true });
    expect(patchOf(st())).toEqual(STRETCHED);
    document.body.innerHTML = "";
    ({ st } = show());
    dragE({ ctrlKey: true });
    expect(patchOf(st())).toEqual(STRETCHED);
  });

  it("on a Mac, Cmd squashes and stretches, and Ctrl does not", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    let { st } = show();
    dragE({ metaKey: true });
    expect(patchOf(st())).toEqual(STRETCHED);
    document.body.innerHTML = "";
    ({ st } = show());
    // A Ctrl press on a Mac is a right-click, so Ctrl is held only from after the press.
    pressHandle("e", 502, 536);
    move(518, 536, { ctrlKey: true });
    frame();
    expect(gesturePatch(st())).toEqual(KEPT);
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    frame();
    expect(gesturePatch(st())).toEqual(KEPT);
    release(518, 536, { ctrlKey: true });
  });

  it("Shift keeps the shape with the free key held", () => {
    const { st } = show();
    dragE({ metaKey: true, shiftKey: true });
    expect(patchOf(st())).toEqual(KEPT);
  });

  it("Alt crops with the free key held", () => {
    const { st } = show();
    const mods = { metaKey: true, altKey: true };
    pressHandle("e", 502, 536, mods);
    move(494, 536, mods);
    frame();
    release(494, 536, mods);
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(patchOf(st())).toEqual({ transform: { crop: { left: 0, top: 0, right: 0.25, bottom: 0 } } });
  });

  it("pressing and letting go of the free key mid-drag works the drag out again where the pointer is", () => {
    const { st } = show();
    pressHandle("e", 502, 536);
    move(518, 536);
    frame();
    expect(gesturePatch(st())).toEqual(KEPT);
    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    frame();
    expect(gesturePatch(st())).toEqual(STRETCHED);
    fireEvent.keyUp(window, { key: "Meta" });
    frame();
    expect(gesturePatch(st())).toEqual(KEPT);
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    frame();
    expect(gesturePatch(st())).toEqual(STRETCHED);
    release(518, 536, { ctrlKey: true });
    expect(patchOf(st())).toEqual(STRETCHED);
  });

  it("the inspector's lock does not change what a handle drag does", () => {
    let { st, settings } = show();
    act(() => settings.getState().set({ lockAspect: false }));
    dragE();
    expect(patchOf(st())).toEqual(KEPT);
    document.body.innerHTML = "";
    ({ st, settings } = show());
    expect(settings.getState().lockAspect).toBe(true);
    dragE({ metaKey: true });
    expect(patchOf(st())).toEqual(STRETCHED);
  });
});
