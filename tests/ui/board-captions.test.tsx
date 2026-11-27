// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Preview } from "@/components/editor/preview";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { createClipboard } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import { viewDoc, type EditorState, type EditorStore } from "@/lib/editor/store";
import { drawFrame } from "@/lib/render/compositor";
import { DEFAULT_TRANSFORM, captionStyleOf, type TimelineDoc } from "@/lib/timeline";
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

// The sample project at frame 10, with captions: c1 fills the frame and says "hello there." from its start, and the
// caption clip k1 covers it, so "hello there." shows low on the frame. A frame share f is at client x 216 + 540f,
// y 56 + 960f.
function show(opts: { canEdit?: boolean; captionClip?: boolean } = {}) {
  const doc: TimelineDoc = sampleDoc();
  const cap = doc.tracks.find((t) => t.kind === "caption")!;
  if (opts.captionClip !== false) cap.clips = [{ id: "k1", type: "caption", assetId: "a", start: 0, duration: 30, transform: { ...DEFAULT_TRANSFORM } }];
  else (doc.tracks[0].clips[0] as { captions?: boolean }).captions = true;
  doc.captions = { transcripts: { a: [{ t: "hello", s: 0, e: 400 }, { t: "there.", s: 450, e: 900 }] } };
  const store: EditorStore = makeStore({ doc, canEdit: opts.canEdit ?? true });
  store.getState().seek(10);
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: "fill" } }, { prefs: vi.fn(), keymap: vi.fn() });
  render(
    <EditorProvider store={store} settings={settings} clipboard={createClipboard()}>
      <ContextMenuProvider>
        <Preview />
      </ContextMenuProvider>
    </EditorProvider>,
  );
  frame();
  return { store, st: () => store.getState() };
}

const X = (f: number) => 216 + 540 * f;
const Y = (f: number) => 56 + 960 * f;
const overlay = () => document.querySelector<HTMLElement>("[data-canvas-overlay]")!;
const press = (x: number, y: number) => fireEvent.pointerDown(overlay(), { clientX: x, clientY: y, button: 0, pointerId: 1 });
const move = (x: number, y: number) => fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, pointerId: 1 });
const release = (x: number, y: number) => fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, pointerId: 1 });
const labels = (s: EditorState) => s.queue.map((e) => e.label);

describe("captions on the board", () => {
  it("a press on the captions selects their caption clip, alone, outlined and with no handles", () => {
    const { st } = show();
    const y = captionStyleOf(st().doc).y;
    press(X(0.5), Y(y));
    release(X(0.5), Y(y));
    expect(st().selection.clipIds).toEqual(["k1"]);
    frame();
    expect(overlay().querySelectorAll("polygon.stroke-ed-accent")).toHaveLength(1);
    expect(overlay().querySelectorAll("[data-canvas-handle]")).toHaveLength(0);
    // Above them is the video, which has handles when selected.
    press(X(0.5), Y(0.1));
    release(X(0.5), Y(0.1));
    expect(st().selection.clipIds).toEqual(["c1"]);
    frame();
    expect(overlay().querySelectorAll("[data-canvas-handle]").length).toBeGreaterThan(0);
  });

  it("dragging the captions moves every caption up or down, as one change", () => {
    const { st } = show();
    const y = captionStyleOf(st().doc).y;
    press(X(0.5), Y(y));
    move(X(0.6), Y(y - 0.1));
    expect(captionStyleOf(viewDoc(st())).y).toBeCloseTo(y - 0.1, 3);
    release(X(0.6), Y(y - 0.1));
    expect(labels(st())).toEqual(["move captions"]);
    expect(st().doc.captions?.style?.y).toBeCloseTo(y - 0.1, 3);
    st().undo();
    expect(captionStyleOf(st().doc).y).toBeCloseTo(y, 5);
  });

  it("a viewer can select the captions but not move them", () => {
    const { st } = show({ canEdit: false });
    const y = captionStyleOf(st().doc).y;
    press(X(0.5), Y(y));
    move(X(0.5), Y(y - 0.2));
    release(X(0.5), Y(y - 0.2));
    expect(st().selection.clipIds).toEqual(["k1"]);
    expect(st().queue).toEqual([]);
  });
});
