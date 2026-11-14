// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Preview } from "@/components/editor/preview";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { createClipboard } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import type { EditorState, EditorStore } from "@/lib/editor/store";
import { drawFrame } from "@/lib/render/compositor";
import type { Clip, TimelineDoc, Transform } from "@/lib/timeline";
import { makeStore, sampleDoc } from "../editor/fixtures";
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

// x1 ("hi", 64 × 76.8) with its transform changed, selected, at frame 10; at: its centre, in client pixels.
function show(transform: Partial<Transform> = {}) {
  const doc: TimelineDoc = sampleDoc();
  for (const track of doc.tracks) {
    track.clips = track.clips.map((c) => (c.id === "x1" ? ({ ...c, transform: { ...c.transform, ...transform } } as Clip) : c));
  }
  const store: EditorStore = makeStore({ doc });
  store.getState().seek(10);
  store.getState().select(["x1"]);
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: "fill" } }, { prefs: vi.fn(), keymap: vi.fn() });
  render(
    <EditorProvider store={store} settings={settings} clipboard={createClipboard()}>
      <ContextMenuProvider>
        <Preview />
      </ContextMenuProvider>
    </EditorProvider>,
  );
  const t = { x: 0.5, y: 0.5, ...transform };
  return { st: () => store.getState(), at: [216 + t.x * 540, 56 + t.y * 960] as const };
}

const overlay = () => document.querySelector<HTMLElement>("[data-canvas-overlay]")!;

type Mods = { shiftKey?: boolean };
const press = (x: number, y: number, mods: Mods = {}) => fireEvent.pointerDown(overlay(), { clientX: x, clientY: y, button: 0, pointerId: 1, ...mods });
const move = (x: number, y: number, mods: Mods = {}) => fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, pointerId: 1, ...mods });
const release = (x: number, y: number, mods: Mods = {}) => fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, pointerId: 1, ...mods });
const pressHandle = (grip: string, x: number, y: number) =>
  fireEvent.pointerDown(document.querySelector(`[data-canvas-handle="${grip}"]`)!, { clientX: x, clientY: y, button: 0, pointerId: 1 });

const guides = () => [...overlay().querySelectorAll("[data-canvas-guide]")].map((l) => l.getAttribute("data-canvas-guide"));
const patchOf = (s: EditorState) => (s.queue[0].ops[0] as { patch: unknown }).patch;
const round4 = (n: number) => Number(n.toFixed(4));

// x1's rotate handle, turned deg degrees about its centre on the frame's middle at client (486, 536), 43.2 CSS px out.
const atTurn = (deg: number): [number, number] => [486 + 43.2 * Math.sin((deg * Math.PI) / 180), 536 - 43.2 * Math.cos((deg * Math.PI) / 180)];

// A body drag from the clip's centre by (dx, dy) CSS px, passing the click slop on the way; what it saved and the
// guides shown just before the release.
function drag({ st, at }: ReturnType<typeof show>, dx: number, dy: number, mods: Mods = {}) {
  press(...at, mods);
  move(at[0] + 10, at[1] + 10, mods);
  frame();
  move(at[0] + dx, at[1] + dy, mods);
  frame();
  const shown = guides();
  release(at[0] + dx, at[1] + dy, mods);
  return { patch: st().queue.length ? patchOf(st()) : null, shown };
}

describe("snapping on the preview", () => {
  it("a centred clip dragged 2, 4 or 5 CSS px either way moves by exactly that much, with no guide", () => {
    for (const d of [2, 4, 5, -2, -4, -5]) {
      expect(drag(show(), d, 0)).toEqual({ patch: { transform: { x: round4(0.5 + (2 * d) / 1080) } }, shown: [] });
      document.body.innerHTML = "";
      expect(drag(show(), 0, d)).toEqual({ patch: { transform: { y: round4(0.5 + (2 * d) / 1920) } }, shown: [] });
      document.body.innerHTML = "";
    }
  });

  it("a clip 20 CSS px right of centre dragged back to within 6 CSS px of it snaps with the guide", () => {
    expect(drag(show({ x: 0.5 + 40 / 1080, y: 0.3 }), -15, 0)).toEqual({ patch: { transform: { x: 0.5 } }, shown: ["x"] });
  });

  it("a clip 4 CSS px off centre dragged further away is not held", () => {
    expect(drag(show({ x: 0.5 + 8 / 1080 }), 1, 0)).toEqual({ patch: { transform: { x: round4(0.5 + 10 / 1080) } }, shown: [] });
  });

  it("a drag through the centre line that stops just beyond it, closer than it started, snaps", () => {
    expect(drag(show({ x: 0.5 + 40 / 1080, y: 0.3 }), -23, 0)).toEqual({ patch: { transform: { x: 0.5 } }, shown: ["x"] });
  });

  it("Shift still locks the axis: the held one never snaps", () => {
    const clip = show({ x: 0.5 + 40 / 1080, y: 0.5 + 6 / 1920 });
    expect(drag(clip, -18, -2, { shiftKey: true })).toEqual({ patch: { transform: { x: 0.5 } }, shown: ["x"] });
  });

  it("a turn from 0° by 2° stays at 2", () => {
    const { st } = show();
    pressHandle("rotate", ...atTurn(0));
    move(...atTurn(10));
    frame();
    move(...atTurn(2));
    frame();
    release(...atTurn(2));
    expect(patchOf(st())).toEqual({ transform: { rotation: 2 } });
  });

  it("a turn from 10° to within 3° of 0 snaps to 0", () => {
    const { st } = show({ rotation: 10 });
    pressHandle("rotate", ...atTurn(0));
    move(...atTurn(-8));
    frame();
    release(...atTurn(-8));
    expect(patchOf(st())).toEqual({ transform: { rotation: 0 } });
  });
});
