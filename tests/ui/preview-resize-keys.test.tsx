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

// The e handle dragged 16 CSS px (32 project px) out: the shape kept, the width alone stretched, or the shape kept about
// the middle, where 32 out of a half-width of 32 doubles it.
const KEPT = { transform: { x: 0.5148, scale: 1.5 } };
const STRETCHED = { transform: { x: 0.5148, stretch: 1.5 } };
const CENTRED = { transform: { scale: 2 } };

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

  it("Shift squashes and stretches", () => {
    const { st } = show();
    dragE({ shiftKey: true });
    expect(patchOf(st())).toEqual(STRETCHED);
  });

  it("Cmd and the Windows key no longer change a resize", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st } = show();
    dragE({ metaKey: true });
    expect(patchOf(st())).toEqual(KEPT);
  });

  it("Alt (Option) resizes about the middle, and with Shift stretches about it", () => {
    let { st } = show();
    dragE({ altKey: true });
    expect(patchOf(st())).toEqual(CENTRED);
    document.body.innerHTML = "";
    ({ st } = show());
    dragE({ altKey: true, shiftKey: true });
    expect(patchOf(st())).toEqual({ transform: { stretch: 2 } });
  });

  it("Ctrl crops, whatever else is held", () => {
    const { st } = show();
    const mods = { ctrlKey: true, altKey: true };
    pressHandle("e", 502, 536, mods);
    move(494, 536, mods);
    frame();
    release(494, 536, mods);
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(patchOf(st())).toEqual({ transform: { crop: { left: 0, top: 0, right: 0.25, bottom: 0 } } });
  });

  it("on a Mac a Ctrl press on a resize handle crops, and its right-click opens no menu", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st } = show();
    pressHandle("e", 502, 536, { ctrlKey: true });
    // The Mac's right-click comes with the press; with the pointer captured it may be aimed at the overlay.
    expect(fireEvent.contextMenu(overlay(), { ctrlKey: true, clientX: 502, clientY: 536 })).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    move(494, 536, { ctrlKey: true });
    frame();
    release(494, 536, { ctrlKey: true });
    expect(labelsOf(st())).toEqual(["crop"]);
    // The next right-click opens the clip's menu as before.
    fireEvent.contextMenu(handle("e"), { clientX: 502, clientY: 536 });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("on a Mac a Ctrl press on the turn handle is still a right-click", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st } = show();
    const turn = handle("rotate");
    fireEvent.pointerDown(turn, { clientX: 486, clientY: 480, button: 0, pointerId: 1, ctrlKey: true });
    move(520, 480, { ctrlKey: true });
    frame();
    expect(st().gesture).toBeNull();
    release(520, 480, { ctrlKey: true });
    expect(st().queue).toEqual([]);
    fireEvent.contextMenu(turn, { ctrlKey: true, clientX: 486, clientY: 480 });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("pressing and letting go of Shift, Alt or Ctrl mid-drag works the drag out again where the pointer is", () => {
    const { st } = show();
    pressHandle("e", 502, 536);
    move(518, 536);
    frame();
    expect(gesturePatch(st())).toEqual(KEPT);
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    frame();
    expect(gesturePatch(st())).toEqual(STRETCHED);
    fireEvent.keyUp(window, { key: "Shift" });
    frame();
    expect(gesturePatch(st())).toEqual(KEPT);
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    frame();
    expect(gesturePatch(st())).toEqual(CENTRED);
    fireEvent.keyUp(window, { key: "Alt" });
    frame();
    expect(gesturePatch(st())).toEqual(KEPT);
    // Ctrl turns it into a crop: out past the whole box that cuts nothing.
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    frame();
    expect(st().gesture).toBeNull();
    release(518, 536, { ctrlKey: true });
    expect(st().queue).toEqual([]);
  });

  it("the inspector's lock does not change what a handle drag does", () => {
    let { st, settings } = show();
    act(() => settings.getState().set({ lockAspect: false }));
    dragE();
    expect(patchOf(st())).toEqual(KEPT);
    document.body.innerHTML = "";
    ({ st, settings } = show());
    expect(settings.getState().lockAspect).toBe(true);
    dragE({ shiftKey: true });
    expect(patchOf(st())).toEqual(STRETCHED);
  });
});
