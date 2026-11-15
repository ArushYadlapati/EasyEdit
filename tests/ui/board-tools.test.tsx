// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Preview } from "@/components/editor/preview";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { createClipboard } from "@/lib/editor/clipboard";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import type { EditorState, EditorStore } from "@/lib/editor/store";
import { drawFrame } from "@/lib/render/compositor";
import { addText } from "@/lib/editor/actions";
import { TEXT_PRESETS } from "@/lib/editor/text-presets";
import type { Tool } from "@/lib/editor/tools";
import type { Guide, TimelineDoc } from "@/lib/timeline";
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
  return { st: () => store.getState() };
}

const X = (f: number) => 216 + 540 * f;
const Y = (f: number) => 56 + 960 * f;
const overlay = () => document.querySelector<HTMLElement>("[data-canvas-overlay]")!;
const press = (x: number, y: number) => fireEvent.pointerDown(overlay(), { clientX: x, clientY: y, button: 0, pointerId: 1 });
const move = (x: number, y: number) => fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, pointerId: 1 });
const release = (x: number, y: number) => fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, pointerId: 1 });
const drawnGuides = () => [...overlay().querySelectorAll("[data-project-guide]")].map((l) => l.getAttribute("data-project-guide"));
const labels = (s: EditorState) => s.queue.map((e) => e.label);

const textClips = (s: EditorState) => s.doc.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text");

describe("addText at a point", () => {
  it("puts the text's centre where it is asked, kept inside the frame, and gives back its id", () => {
    const store = makeStore();
    store.getState().seek(10);
    const id = addText(store, TEXT_PRESETS.find((p) => p.id === "body")!, 3, undefined, { x: 0.2, y: 0.8 });
    const clip = store.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
    expect(clip.transform).toMatchObject({ x: 0.2, y: 0.8 });
    expect(clip.start).toBe(10);
    const outside = addText(store, TEXT_PRESETS[0], 3, undefined, { x: 1.4, y: -1 });
    const far = store.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === outside)!;
    expect(far.transform).toMatchObject({ x: 1, y: 0 });
  });

  it("gives back null for a viewer", () => {
    expect(addText(makeStore({ canEdit: false }), TEXT_PRESETS[0])).toBeNull();
  });
});

describe("the Text tool on the preview", () => {
  it("a click adds body text where it lands, opens it for typing, and goes back to Selection", () => {
    const { st } = show({ tool: "text" });
    const before = textClips(st()).length;
    press(X(0.25), Y(0.25));
    release(X(0.25), Y(0.25));
    const added = textClips(st()).filter((c) => !sampleDoc().tracks.some((t) => t.clips.some((o) => o.id === c.id)));
    expect(textClips(st())).toHaveLength(before + 1);
    expect(added[0]).toMatchObject({ text: "Your text", start: 10, transform: { x: 0.25, y: 0.25 } });
    expect(st().textEditId).toBe(added[0].id);
    expect(st().tool).toBe("select");
  });

  it("a click on a text clip opens that clip instead of adding one", () => {
    const { st } = show({ tool: "text" });
    press(X(0.5), Y(0.5)); // x1 sits in the middle
    release(X(0.5), Y(0.5));
    expect(textClips(st())).toHaveLength(textClips({ doc: sampleDoc() } as EditorState).length);
    expect(st().textEditId).toBe("x1");
    expect(st().tool).toBe("select");
  });

  it("shows a text cursor", () => {
    show({ tool: "text" });
    expect(overlay().className).toMatch(/\bcursor-text\b/);
  });
});

describe("the Crop tool on the preview", () => {
  it("a corner handle crops instead of resizing", () => {
    const { st } = show({ tool: "crop" });
    act(() => st().select(["x1"]));
    const handle = () => document.querySelector<HTMLElement>('[data-canvas-handle="se"]')!;
    expect(handle()).not.toBeNull();
    const r = handle().getBoundingClientRect();
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    fireEvent.pointerDown(handle(), { clientX: x, clientY: y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: x - 10, clientY: y - 10, pointerId: 1 });
    frame();
    fireEvent.pointerUp(handle(), { clientX: x - 10, clientY: y - 10, pointerId: 1 });
    const patch = (st().queue[0].ops[0] as unknown as { patch: { transform: Record<string, unknown> } }).patch.transform;
    expect(patch.crop).toBeDefined();
    expect(patch.scale).toBeUndefined();
  });

  it("the Guide tool shows a crosshair", () => {
    show({ tool: "guide" });
    expect(overlay().className).toMatch(/\bcursor-crosshair\b/);
  });
});
