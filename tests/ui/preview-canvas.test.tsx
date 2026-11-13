// @vitest-environment happy-dom
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { Preview } from "@/components/editor/preview";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { copyClips, createClipboard } from "@/lib/editor/clipboard";
import { MESSAGES } from "@/lib/editor/messages";
import { DEFAULT_PREFS, createSettingsStore, type BoardZoom } from "@/lib/editor/settings";
import { findClip, viewDoc, type EditorState, type EditorStore } from "@/lib/editor/store";
import type { EditorInit } from "@/lib/editor/types";
import { drawFrame } from "@/lib/render/compositor";
import type { Clip, TimelineDoc, Transform } from "@/lib/timeline";
import { entry, makeStore, noticesOf, sampleDoc } from "../editor/fixtures";
import { fakeCtx } from "../render/fake-ctx";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
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

// Where the browser would put things. In Fill the pane and the content box are at (200, 40), 572 × 992, and the
// canvas is the 540 × 960 frame 16 px inside, so k = 0.5: a canvas point (cx, cy) is at client (cx + 216, cy + 56)
// and at overlay (cx + 16, cy + 16). The overlay fills the content box, so it measures the same.
type Rects = { pane: DOMRect; content: DOMRect; canvas: DOMRect };
const FILL_RECTS: Rects = { pane: rect(200, 40, 572, 992), content: rect(200, 40, 572, 992), canvas: rect(216, 56, 540, 960) };
let rects: Rects = FILL_RECTS;
let paneSize = { width: 572, height: 992 };
let observed: ResizeObserverCallback[] = [];

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
  rects = FILL_RECTS;
  paneSize = { width: 572, height: 992 };
  observed = [];
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
      constructor(callback: ResizeObserverCallback) {
        observed.push(callback);
      }
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

type ShowOptions = {
  over?: Partial<EditorInit>;
  selected?: string[];
  at?: number;
  boardZoom?: BoardZoom;
  copied?: string[];
  strict?: boolean;
  inspector?: boolean;
};

function show(opts: ShowOptions = {}) {
  const store: EditorStore = makeStore(opts.over);
  store.getState().seek(opts.at ?? 10);
  store.getState().select(opts.selected ?? []);
  const clipboard = createClipboard();
  if (opts.copied) clipboard.write(copyClips(store.getState().doc, opts.copied)!);
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: opts.boardZoom ?? "fill" } }, { prefs: vi.fn(), keymap: vi.fn() });
  const tree: ReactNode = (
    <EditorProvider store={store} settings={settings} clipboard={clipboard}>
      <ContextMenuProvider>
        {opts.inspector && <Inspector />}
        <Preview />
      </ContextMenuProvider>
    </EditorProvider>
  );
  render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
  const st = () => store.getState();
  return { store, st };
}

const overlay = () => document.querySelector<HTMLElement>("[data-canvas-overlay]")!;
const board = () => document.querySelector<HTMLElement>("[data-board]")!;
const outlines = () => [...overlay().querySelectorAll("polygon")].map((p) => p.getAttribute("points"));

type Mods = { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };
const press = (x: number, y: number, mods: Mods = {}, button = 0) =>
  fireEvent.pointerDown(overlay(), { clientX: x, clientY: y, button, pointerId: 1, ...mods });
const move = (x: number, y: number, mods: Mods = {}) => fireEvent.pointerMove(overlay(), { clientX: x, clientY: y, pointerId: 1, ...mods });
const release = (x: number, y: number, mods: Mods = {}) => fireEvent.pointerUp(overlay(), { clientX: x, clientY: y, pointerId: 1, ...mods });
const click = (x: number, y: number, mods: Mods = {}) => {
  press(x, y, mods);
  release(x, y, mods);
};
const rightClick = (x: number, y: number, mods: Mods = {}) => fireEvent.contextMenu(overlay(), { clientX: x, clientY: y, button: 2, ...mods });

// x1 ("hi", 64 × 76.8 in the middle of the frame) is at client (486, 536); c1, the frame-sized placeholder behind it,
// is everywhere in the frame, as at client (236, 76).
const TEXT = [486, 536] as const;
const PICTURE = [236, 76] as const;

describe("selecting on the preview", () => {
  it("the overlay covers the board's content and the canvas stays the Preview image", () => {
    show();
    const el = overlay();
    expect(el.parentElement).toBe(document.querySelector("[data-frame]")!.parentElement);
    expect(el.className.split(" ")).toEqual(expect.arrayContaining(["absolute", "inset-0", "touch-none", "select-none"]));
    expect(screen.getByRole("img", { name: "Preview" }).tagName).toBe("CANVAS");
  });

  it("pressing the text selects it; pressing the picture behind selects the video", () => {
    const { st } = show();
    click(...TEXT);
    expect(st().selection.clipIds).toEqual(["x1"]);
    click(...PICTURE);
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("the selection changes at the press, before the release", () => {
    const { st } = show({ selected: ["c1"] });
    press(...TEXT);
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("only the main button selects", () => {
    const { st } = show({ selected: ["c1"] });
    press(...TEXT, {}, 1);
    release(...TEXT);
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("pressing where nothing is drawn clears the selection", () => {
    const { st } = show({ at: 70, selected: ["x1"] });
    click(...TEXT);
    expect(st().selection.clipIds).toEqual([]);
  });

  it("the press hit-tests with 4 screen pixels of slop", () => {
    // x1's right edge is at client 486 + 16 = 502; at k = 0.5, 4 CSS px reach to 506.
    const { st } = show({ selected: ["c1"] });
    click(505, 536);
    expect(st().selection.clipIds).toEqual(["x1"]);
    click(507, 536);
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("a plain press on the picture clicks through a locked track", () => {
    const doc = sampleDoc();
    doc.tracks[1].locked = true;
    const { st } = show({ over: { doc } });
    click(...TEXT);
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("a hidden track is never hit", () => {
    const hidden = sampleDoc();
    hidden.tracks[1].hidden = true;
    const first = show({ over: { doc: hidden } });
    click(...TEXT);
    expect(first.st().selection.clipIds).toEqual(["c1"]);
  });

  it("a clip at opacity 0 is pressed through", () => {
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "x1", { opacity: 0 }) } });
    click(...TEXT);
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("a press on a selected clip keeps the selection, and its release without a drag leaves only that clip", () => {
    const { st } = show({ selected: ["x1", "c1"] });
    press(...TEXT);
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
    release(...TEXT);
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("Shift adds to the selection on release", () => {
    const { st } = show({ selected: ["x1"] });
    press(...PICTURE, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1"]);
    release(...PICTURE, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
  });

  it("Shift on a selected clip keeps it until the release, then takes it out", () => {
    const { st } = show({ selected: ["x1", "c1"] });
    press(...TEXT, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
    release(...TEXT, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("Cmd toggles, and so does Ctrl away from a Mac", () => {
    const { st } = show({ selected: ["x1"] });
    click(...PICTURE, { metaKey: true });
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
    click(...PICTURE, { ctrlKey: true });
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("a modified press that travels toggles nothing", () => {
    // A viewer moves nothing, so the travelling press is left to do nothing at all.
    const { st } = show({ over: { canEdit: false }, selected: ["x1"] });
    press(...PICTURE, { shiftKey: true });
    move(PICTURE[0] + 2, PICTURE[1], { shiftKey: true });
    move(PICTURE[0] + 10, PICTURE[1], { shiftKey: true });
    // Back where it started: it still travelled.
    move(...PICTURE, { shiftKey: true });
    release(...PICTURE, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1"]);
    // A release past the slop toggles nothing, even with no move seen before it.
    press(...PICTURE, { shiftKey: true });
    release(PICTURE[0], PICTURE[1] + 10, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1"]);
    // Within the slop it still toggles.
    press(...PICTURE, { shiftKey: true });
    move(PICTURE[0] + 2, PICTURE[1], { shiftKey: true });
    release(PICTURE[0] + 2, PICTURE[1], { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
  });

  it("a cancelled press toggles nothing", () => {
    const { st } = show({ selected: ["x1"] });
    press(...PICTURE, { shiftKey: true });
    fireEvent.pointerCancel(overlay(), { pointerId: 1 });
    release(...PICTURE, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("a viewer can select on the preview", () => {
    const { st } = show({ over: { canEdit: false } });
    click(...TEXT);
    expect(st().selection.clipIds).toEqual(["x1"]);
    click(...PICTURE, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
  });

  it("a press on the board beside a full-frame video clears the selection", () => {
    const doc = () => withTransform(sampleDoc(), "c1", { scale: 3 });
    const first = show({ over: { doc: doc() }, selected: ["x1"] });
    click(206, 300); // project (-20, 488)
    expect(first.st().selection.clipIds).toEqual([]);
    document.body.innerHTML = "";
    const second = show({ over: { doc: doc() }, selected: ["c1"] });
    click(206, 300);
    expect(second.st().selection.clipIds).toEqual(["c1"]);
  });

  it("at 100%, scrolled, a press at the pane's centre is the frame's centre", () => {
    rects = { pane: rect(200, 40, 572, 992), content: rect(-70, -440, 1112, 1952), canvas: rect(-54, -424, 1080, 1920) };
    const { st } = show({ boardZoom: 100 });
    click(486, 536);
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("before the canvas is measured a press selects nothing and changes nothing", () => {
    rects = { ...FILL_RECTS, canvas: rect(0, 0, 0, 0) };
    const { st } = show({ selected: ["x1"] });
    click(...PICTURE);
    expect(st().selection.clipIds).toEqual(["x1"]);
    expect(outlines()).toEqual([]);
  });

  it("on a Mac, Ctrl+click on the preview opens the menu and does not toggle", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st } = show({ selected: ["x1", "c1"] });
    press(...TEXT, { ctrlKey: true });
    release(...TEXT, { ctrlKey: true });
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
    rightClick(...TEXT, { ctrlKey: true });
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
    expect(screen.getByRole("menu", { name: "Clip actions" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    st().select(["x1"]);
    press(...PICTURE, { ctrlKey: true });
    release(...PICTURE, { ctrlKey: true });
    expect(st().selection.clipIds).toEqual(["x1"]);
    rightClick(...PICTURE, { ctrlKey: true });
    expect(st().selection.clipIds).toEqual(["c1"]);
  });
});

describe("right-clicking the preview", () => {
  it("a right-click on a clip opens its menu", () => {
    const { st } = show({ selected: ["c1"] });
    expect(rightClick(...TEXT)).toBe(false);
    const menu = screen.getByRole("menu", { name: "Clip actions" });
    expect(within(menu).getByRole("menuitem", { name: /^Cut/ })).toBeTruthy();
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("a right-click does not press: the main button's handler leaves it alone", () => {
    const { st } = show({ selected: ["x1", "c1"] });
    press(...TEXT, {}, 2);
    release(...TEXT);
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
  });

  it("a right-click on locked text opens the preview menu and keeps the selection", () => {
    const doc = sampleDoc();
    doc.tracks[1].locked = true;
    const { st } = show({ over: { doc }, selected: ["c1"] });
    rightClick(...TEXT);
    expect(screen.getByRole("menu", { name: "Preview" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "Clip actions" })).toBeNull();
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("a right-click on empty picture opens 'Preview', and Safe zones hides them", () => {
    const { st } = show({ at: 70 });
    rightClick(...TEXT);
    const menu = screen.getByRole("menu", { name: "Preview" });
    const paste = within(menu).getByRole("menuitem", { name: /^Paste/ });
    expect(paste.hasAttribute("disabled") || paste.getAttribute("aria-disabled") === "true").toBe(true);
    const safe = within(menu).getByRole("menuitemcheckbox", { name: "Safe zones" });
    expect(safe.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(safe);
    expect(st().showSafeZones).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a right-click on the board beside a full-frame video opens 'Preview' unless that video is selected", () => {
    show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["x1"] });
    rightClick(206, 300);
    expect(screen.getByRole("menu", { name: "Preview" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    document.body.innerHTML = "";
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    rightClick(206, 300);
    expect(screen.getByRole("menu", { name: "Clip actions" })).toBeTruthy();
    expect(st().selection.clipIds).toEqual(["c1"]);
  });

  it("Paste from the preview's menu pastes at the playhead", () => {
    const { st } = show({ at: 70, copied: ["x1"] });
    rightClick(...TEXT);
    fireEvent.click(within(screen.getByRole("menu", { name: "Preview" })).getByRole("menuitem", { name: /^Paste/ }));
    const pasted = st().doc.tracks.flatMap((t) => t.clips).filter((c) => !["c1", "c2", "x1", "x2"].includes(c.id));
    expect(pasted.map((c) => c.start)).toEqual([70]);
    expect(st().queue.map((q) => q.label)).toEqual(["paste"]);
  });

  it("a viewer's preview menu has only Safe zones", () => {
    show({ at: 70, over: { canEdit: false }, copied: ["x1"] });
    rightClick(...TEXT);
    const menu = screen.getByRole("menu", { name: "Preview" });
    expect([...menu.querySelectorAll("button")].map((i) => i.textContent)).toEqual(["Safe zones"]);
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Safe zones" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("the selection outline", () => {
  it("the outline is drawn round the selected clip", () => {
    show({ selected: ["x1"] });
    expect(outlines()).toEqual(["270,476.8 302,476.8 302,515.2 270,515.2"]);
    const polygon = overlay().querySelector("polygon")!;
    expect(polygon.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(polygon.getAttribute("fill")).toBe("none");
    expect(polygon.getAttribute("class")).toContain("stroke-ed-accent");
    expect(polygon.getAttribute("stroke-width")).toBe("1");
    expect(polygon.getAttribute("pointer-events")).toBe("none");
    const svg = overlay().querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("pointer-events-none");
    expect(svg.getAttribute("class")).toContain("overflow-visible");
  });

  it("under StrictMode the outline is drawn and a press still selects", () => {
    const { st } = show({ selected: ["x1"], strict: true });
    expect(outlines()).toEqual(["270,476.8 302,476.8 302,515.2 270,515.2"]);
    click(...PICTURE);
    expect(st().selection.clipIds).toEqual(["c1"]);
    expect(outlines()).toEqual(["16,16 556,16 556,976 16,976"]);
  });

  it("the outline follows the selection, and only for clips under the playhead", () => {
    const { st } = show();
    expect(outlines()).toEqual([]);
    act(() => st().select(["x1", "c1", "x2"]));
    // c1 is drawn first, so its outline is first; x2 is not under the playhead.
    expect(outlines()).toEqual(["16,16 556,16 556,976 16,976", "270,476.8 302,476.8 302,515.2 270,515.2"]);
    act(() => st().select([]));
    expect(outlines()).toEqual([]);
  });

  it("the outline is drawn over the board too, for a clip larger than the frame", () => {
    show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    expect(outlines()).toEqual(["-524,-944 1096,-944 1096,1936 -524,1936"]);
  });

  it("the outline follows the clip when the shown document changes", () => {
    const { st } = show({ selected: ["x1"] });
    act(() => {
      st().setGesture([{ op: "update_clip", clipId: "x1", patch: { transform: { x: 0.6 } } }]);
    });
    frame();
    // 0.1 of the frame is 108 project px, 54 on screen.
    expect(outlines()).toEqual(["324,476.8 356,476.8 356,515.2 324,515.2"]);
  });

  it("the outline follows the frame when the pane changes", () => {
    show({ selected: ["x1"] });
    paneSize = { width: 972, height: 992 };
    rects = { pane: rect(200, 40, 972, 992), content: rect(200, 40, 972, 992), canvas: rect(416, 56, 540, 960) };
    act(() => {
      for (const callback of observed) callback([], {} as ResizeObserver);
    });
    expect(outlines()).toEqual(["470,476.8 502,476.8 502,515.2 470,515.2"]);
  });

  it("a scroll of the board refreshes the outline, once per animation frame", () => {
    rects = { pane: rect(200, 40, 572, 992), content: rect(-70, -440, 1112, 1952), canvas: rect(-54, -424, 1080, 1920) };
    show({ boardZoom: 100, selected: ["x1"] });
    // x1 is 508..572 × 921.6..998.4 in project px, and the canvas sits 16 px inside the content.
    expect(outlines()).toEqual(["524,937.6 588,937.6 588,1014.4 524,1014.4"]);
    // A stub that moves the canvas alone shows that the overlay measures again once the scroll's frame runs.
    rects = { ...rects, canvas: rect(-44, -424, 1080, 1920) };
    const before = frames.size;
    fireEvent.scroll(board());
    fireEvent.scroll(board());
    expect(frames.size).toBe(before + 1);
    expect(outlines()).toEqual(["524,937.6 588,937.6 588,1014.4 524,1014.4"]);
    frame();
    expect(outlines()).toEqual(["534,937.6 598,937.6 598,1014.4 534,1014.4"]);
  });
});

// The handles and the drags they start. x1's handles at k = 0.5: its box is overlay 270..302 × 476.8..515.2, so e is
// at client (502, 536), se at (502, 555.2) and rotate 24 CSS px above n, at (486, 492.8).
const handle = (grip: string) => document.querySelector<HTMLElement>(`[data-canvas-handle="${grip}"]`);
const handleNames = () => [...document.querySelectorAll<HTMLElement>("[data-canvas-handle]")].map((h) => h.dataset.canvasHandle);
const placeOf = (grip: string) => [handle(grip)!.style.left, handle(grip)!.style.top];
const pressHandle = (grip: string, x: number, y: number, mods: Mods = {}) =>
  fireEvent.pointerDown(handle(grip)!, { clientX: x, clientY: y, button: 0, pointerId: 1, ...mods });
const EIGHT = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const transformOf = (s: EditorState, clipId: string) => findClip(viewDoc(s), clipId)!.clip.transform;
const labelsOf = (s: EditorState) => s.queue.map((q) => q.label);
const patchOf = (s: EditorState, index = 0) => (s.queue[index].ops[0] as { patch: unknown }).patch;
const gesturePatch = (s: EditorState) => (s.gesture!.ops[0] as { patch: unknown }).patch;

describe("moving, turning and resizing on the preview", () => {
  it("with nothing selected, pressing the text and dragging moves it in one go and saves one change", () => {
    const { st } = show();
    expect(st().selection.clipIds).toEqual([]);
    expect(press(...TEXT)).toBe(true);
    expect(st().selection.clipIds).toEqual(["x1"]);
    // Moves are worked out once per animation frame.
    const before = frames.size;
    move(500, 536);
    move(513, 536);
    expect(frames.size).toBe(before + 1);
    expect(st().gesture).toBeNull();
    frame();
    expect(transformOf(st(), "x1").x).toBeCloseTo(0.55, 6);
    expect(st().queue).toEqual([]);
    release(513, 536);
    expect(labelsOf(st())).toEqual(["position change"]);
    expect(st().queue[0].ops).toEqual([{ op: "update_clip", clipId: "x1", patch: { transform: { x: 0.55 } } }]);
  });

  it("a body drag waits for the click slop", () => {
    const { st } = show({ selected: ["x1"] });
    act(() => st().setSnapping(false));
    press(...TEXT);
    move(488, 536);
    frame();
    expect(st().gesture).toBeNull();
    release(488, 536);
    expect(st().queue).toEqual([]);
  });

  it("with x1 and c1 selected, dragging x1's body moves only x1 and leaves it the only selection", () => {
    const { st } = show({ selected: ["x1", "c1"] });
    press(...TEXT);
    move(513, 536);
    expect(st().selection.clipIds).toEqual(["x1"]);
    frame();
    release(513, 536);
    expect(labelsOf(st())).toEqual(["position change"]);
    expect(st().queue[0].ops).toEqual([{ op: "update_clip", clipId: "x1", patch: { transform: { x: 0.55 } } }]);
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("Shift held from the press moves along one axis", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT, { shiftKey: true });
    move(513, 540, { shiftKey: true });
    frame();
    release(513, 540, { shiftKey: true });
    expect(patchOf(st())).toEqual({ transform: { x: 0.55 } });
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("a Shift press that drags a clip of a multi-selection moves it alone and toggles nothing", () => {
    const { st } = show({ selected: ["x1", "c1"] });
    press(...TEXT, { metaKey: true });
    move(513, 536, { metaKey: true });
    frame();
    release(513, 536, { metaKey: true });
    expect(labelsOf(st())).toEqual(["position change"]);
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("Shift is read from each pointer move too", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(513, 546, { shiftKey: true });
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.55 } });
    move(513, 546);
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.55, y: 0.5104 } });
  });

  it("Escape drops the move", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(513, 536);
    frame();
    expect(transformOf(st(), "x1").x).toBeCloseTo(0.55, 6);
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
    expect(st().gesture).toBeNull();
    expect(transformOf(st(), "x1").x).toBe(0.5);
    move(520, 536);
    frame();
    release(520, 536);
    expect(st().queue).toEqual([]);
    expect(st().gesture).toBeNull();
  });

  it("a cancelled pointer or a lost capture drops the move", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(513, 536);
    frame();
    fireEvent.pointerCancel(overlay(), { pointerId: 1 });
    expect(st().gesture).toBeNull();
    release(513, 536);
    press(...TEXT);
    move(513, 536);
    frame();
    fireEvent(overlay(), new Event("lostpointercapture"));
    expect(st().gesture).toBeNull();
    release(513, 536);
    expect(st().queue).toEqual([]);
  });

  it("a move that comes back to where it started saves nothing", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(513, 536);
    frame();
    move(...TEXT);
    frame();
    expect(st().gesture).toBeNull();
    release(...TEXT);
    expect(st().queue).toEqual([]);
  });

  it("a moved centre snaps to the frame's middle with a guide across the frame", () => {
    const { st } = show({ selected: ["x1"] });
    expect(overlay().querySelectorAll("[data-canvas-guide]")).toHaveLength(0);
    press(...TEXT);
    move(490, 536); // 8 project px off the middle, inside the 12 px a 6 CSS px snap reaches at k = 0.5
    frame();
    expect(st().gesture).toBeNull();
    const lines = [...overlay().querySelectorAll("line[data-canvas-guide]")];
    expect(lines.map((l) => [l.getAttribute("data-canvas-guide"), l.getAttribute("x1"), l.getAttribute("y1"), l.getAttribute("x2"), l.getAttribute("y2")])).toEqual([
      ["x", "286", "16", "286", "976"],
      ["y", "16", "496", "556", "496"],
    ]);
    expect(lines[0].getAttribute("class")).toContain("stroke-ed-accent");
    expect(lines[0].getAttribute("stroke-width")).toBe("1");
    move(513, 536);
    frame();
    expect([...overlay().querySelectorAll("[data-canvas-guide]")].map((l) => l.getAttribute("data-canvas-guide"))).toEqual(["y"]);
    release(513, 536);
    expect(overlay().querySelectorAll("[data-canvas-guide]")).toHaveLength(0);
  });

  it("with snapping off the centre does not snap", () => {
    const { st } = show({ selected: ["x1"] });
    act(() => st().setSnapping(false));
    press(...TEXT);
    move(490, 536);
    frame();
    release(490, 536);
    expect(patchOf(st())).toEqual({ transform: { x: 0.5074 } });
  });

  it("turning snapping off mid-drag works the move out again", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(490, 536);
    frame();
    expect(st().gesture).toBeNull();
    act(() => st().setSnapping(false));
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.5074 } });
  });

  it("a scroll of the board mid-drag moves the clip with the pointer's new place on the frame", () => {
    rects = { pane: rect(200, 40, 572, 992), content: rect(-70, -440, 1112, 1952), canvas: rect(-54, -424, 1080, 1920) };
    const { st } = show({ boardZoom: 100, selected: ["x1"] });
    press(486, 536);
    move(506, 536);
    frame();
    expect(transformOf(st(), "x1").x).toBeCloseTo(0.5185, 4);
    rects = { ...rects, content: rect(-90, -440, 1112, 1952), canvas: rect(-74, -424, 1080, 1920) };
    fireEvent.scroll(board());
    frame();
    expect(transformOf(st(), "x1").x).toBeCloseTo(0.537, 4);
  });

  it("dragging a side handle stretches the clip and keeps the opposite side in place", () => {
    const { st } = show({ selected: ["x1"] });
    expect(placeOf("e")).toEqual(["302px", "496px"]);
    expect(handle("e")!.style.cursor).toBe("ew-resize");
    expect(pressHandle("e", 502, 536)).toBe(true);
    move(518, 536);
    frame();
    release(518, 536);
    expect(labelsOf(st())).toEqual(["size change"]);
    expect(patchOf(st())).toEqual({ transform: { x: 0.5148, stretch: 1.5 } });
  });

  it("a handle drag starts at once, without the click slop", () => {
    const { st } = show({ selected: ["x1"] });
    pressHandle("e", 502, 536);
    move(503, 536);
    frame();
    expect(st().gesture).not.toBeNull();
  });

  it("Shift on a corner keeps the shape", () => {
    const { st } = show({ selected: ["x1"] });
    pressHandle("se", 502, 555.2, { shiftKey: true });
    move(518, 574.4, { shiftKey: true });
    frame();
    release(518, 574.4, { shiftKey: true });
    expect(labelsOf(st())).toEqual(["size change"]);
    expect(patchOf(st())).toEqual({ transform: { x: 0.5148, y: 0.51, scale: 1.5 } });
  });

  it("a press on a handle wins over Shift's toggle", () => {
    const { st } = show({ selected: ["x1"] });
    pressHandle("se", 502, 555.2, { shiftKey: true });
    release(502, 555.2, { shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("pressing Shift mid-drag without moving re-resolves", () => {
    const { st } = show({ selected: ["x1"] });
    pressHandle("e", 502, 536);
    move(518, 536);
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.5148, stretch: 1.5 } });
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    frame();
    expect(gesturePatch(st())).toMatchObject({ transform: { scale: 1.5 } });
    expect(gesturePatch(st())).not.toHaveProperty("transform.stretch");
    fireEvent.keyUp(window, { key: "Shift" });
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.5148, stretch: 1.5 } });
  });

  it("the rotate handle turns the clip", () => {
    const { st } = show({ selected: ["x1"] });
    expect(handle("rotate")!.style.cursor).toBe("grab");
    pressHandle("rotate", 486, 492.8);
    move(529.2, 536);
    frame();
    release(529.2, 536);
    expect(labelsOf(st())).toEqual(["position change"]);
    expect(patchOf(st())).toEqual({ transform: { rotation: 90 } });
  });

  it("a right-click on a handle opens its clip's menu", () => {
    // The rotate handle is 24 CSS px above x1, where a press would reach the video behind it.
    const { st } = show({ selected: ["x1"] });
    fireEvent.contextMenu(handle("rotate")!, { clientX: 486, clientY: 492.8, button: 2 });
    expect(screen.getByRole("menu", { name: "Clip actions" })).toBeTruthy();
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("on a Mac a Ctrl press on a handle does nothing", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st } = show({ selected: ["x1"] });
    pressHandle("e", 502, 536, { ctrlKey: true });
    move(518, 536, { ctrlKey: true });
    frame();
    release(518, 536, { ctrlKey: true });
    expect(st().gesture).toBeNull();
    expect(st().queue).toEqual([]);
  });

  it("handles show only for one selected, editable clip on an unlocked track", () => {
    show({ selected: ["x1"] });
    expect(handleNames().sort()).toEqual([...EIGHT, "rotate"].sort());
    document.body.innerHTML = "";
    show({ selected: ["x1", "c1"] });
    expect(handleNames()).toEqual([]);
    document.body.innerHTML = "";
    const doc = sampleDoc();
    doc.tracks[1].locked = true;
    show({ over: { doc }, selected: ["x1"] });
    expect(handleNames()).toEqual([]);
    document.body.innerHTML = "";
    show({ selected: ["x2"] }); // not under the playhead
    expect(handleNames()).toEqual([]);
  });

  it("small boxes keep every handle", () => {
    show({ selected: ["x1"] });
    expect(handle("se")!.style.width).toBe("8px");
    expect(handle("se")!.style.height).toBe("8px");
    document.body.innerHTML = "";
    show({ selected: ["c1"] });
    expect(handle("se")!.style.width).toBe("24px");
    document.body.innerHTML = "";
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "x1", { scale: 0.5 }) }, selected: ["x1"] });
    expect(handleNames().filter((n) => n !== "rotate").sort()).toEqual([...EIGHT].sort());
    expect(placeOf("e")[0]).toBe("306px");
    expect(placeOf("w")[0]).toBe("266px");
    expect(placeOf("n")[1]).toBe("474.4px");
    expect(placeOf("s")[1]).toBe("517.6px");
    // n and s are pushed out, so the rotate handle sits 36 CSS px above the top edge.
    expect(placeOf("rotate")).toEqual(["286px", "450.4px"]);
    pressHandle("e", 506, 536);
    move(510, 536);
    frame();
    release(510, 536);
    expect(labelsOf(st())).toEqual(["size change"]);
    expect(patchOf(st())).toMatchObject({ transform: { stretch: 1.25 } });
    expect(patchOf(st())).not.toHaveProperty("transform.scale");
  });

  it("a tiny box keeps all eight handles", () => {
    show({ over: { doc: withTransform(sampleDoc(), "x1", { scale: 0.2 }) }, selected: ["x1"] });
    expect(handleNames().filter((n) => n !== "rotate").sort()).toEqual([...EIGHT].sort());
  });

  it("a wide, short box pushes only e and w out", () => {
    // x1 stretched 4 times across at scale 0.5 is 64 × 19.2 on screen.
    show({ over: { doc: withTransform(sampleDoc(), "x1", { scale: 0.5, stretch: 4 }) }, selected: ["x1"] });
    expect(handle("se")!.style.width).toBe("8px");
    expect(placeOf("e")[0]).toBe("330px");
    expect(placeOf("n")[1]).toBe("486.4px");
    expect(placeOf("rotate")).toEqual(["286px", "462.4px"]);
  });

  it("handles of a clip larger than the preview are drawn at the pane's edge", () => {
    show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    expect(placeOf("se")).toEqual(["560px", "980px"]);
  });

  it("a clip larger than the preview keeps its rotate handle on screen", () => {
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    expect(placeOf("rotate")).toEqual(["286px", "48px"]);
    pressHandle("rotate", 486, 88);
    move(934, 536);
    frame();
    release(934, 536);
    expect(labelsOf(st())).toEqual(["position change"]);
    expect(patchOf(st())).toEqual({ transform: { rotation: 90 } });
  });

  it("a full-frame clip's rotate handle sits inside it when there is no room above", () => {
    show({ selected: ["c1"] });
    expect(placeOf("rotate")).toEqual(["286px", "52px"]);
    document.body.innerHTML = "";
    show({ selected: ["x1"] });
    expect(placeOf("rotate")).toEqual(["286px", "452.8px"]);
    // Above a clip near the top, a rotate handle within 12 px of the pane's edge also moves inside it.
    document.body.innerHTML = "";
    show({ over: { doc: withTransform(sampleDoc(), "x1", { y: 0.04 }) }, selected: ["x1"] });
    expect(placeOf("n")).toEqual(["286px", "35.2px"]);
    expect(placeOf("rotate")).toEqual(["286px", "71.2px"]);
  });

  it("two handles clamped onto one spot show once", () => {
    show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3, x: 1.5 }) }, selected: ["c1"] });
    expect(placeOf("ne")).toEqual(["560px", "12px"]);
    expect(placeOf("se")).toEqual(["560px", "980px"]);
    expect(handle("n")).toBeNull();
    expect(handle("s")).toBeNull();
    expect(handleNames().sort()).toEqual(["e", "ne", "nw", "rotate", "se", "sw", "w"]);
  });

  it("a clamped handle follows the pointer while it is dragged", () => {
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    expect(placeOf("w")).toEqual(["12px", "496px"]);
    pressHandle("w", 212, 536);
    move(240, 536);
    frame();
    expect(handle("w")!.style.left).toBe("40px");
    release(240, 536);
    expect(labelsOf(st())).toEqual(["size change"]);
    expect(handle("w")!.style.left).toBe("12px");
  });

  it("at 100% a full-frame clip's handle is clamped to the visible pane", () => {
    rects = { pane: rect(200, 40, 572, 992), content: rect(-70, -440, 1112, 1952), canvas: rect(-54, -424, 1080, 1920) };
    show({ boardZoom: 100, selected: ["c1"] });
    expect(placeOf("se")).toEqual(["830px", "1460px"]);
    expect(placeOf("nw")).toEqual(["282px", "492px"]);
  });

  it("a selected clip can be dragged from the board beside the frame", () => {
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    press(206, 300);
    move(226, 300);
    release(226, 300);
    expect(labelsOf(st())).toEqual(["position change"]);
    expect(patchOf(st())).toEqual({ transform: { x: 0.537 } });
  });

  it("a clip removed during a preview drag ends it with a message", () => {
    const { store, st } = show({ selected: ["x1"] });
    const notices = noticesOf(store);
    press(...TEXT);
    move(513, 536);
    frame();
    act(() => void st().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x1" }])]));
    expect(st().notice?.text).toBe(MESSAGES.clipGone);
    move(530, 536);
    frame();
    release(530, 536);
    expect(st().queue).toEqual([]);
    expect(st().gesture).toBeNull();
    expect(notices).toEqual([MESSAGES.clipGone]);
  });

  it("a clip removed before its drag set anything ends it with a message too", () => {
    const { store, st } = show({ selected: ["x1"] });
    const notices = noticesOf(store);
    pressHandle("e", 502, 536);
    act(() => void st().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x1" }])]));
    move(518, 536);
    frame();
    release(518, 536);
    expect(st().queue).toEqual([]);
    expect(notices).toEqual([MESSAGES.clipGone]);
  });

  it("a remote edit elsewhere keeps the drag going", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(513, 536);
    frame();
    act(() => void st().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x2" }])]));
    release(513, 536);
    expect(labelsOf(st())).toEqual(["position change"]);
  });

  it("a draft in the inspector's X field is saved before the drag starts", () => {
    const { st } = show({ selected: ["x1"], inspector: true });
    const field = screen.getByLabelText("X");
    fireEvent.change(field, { target: { value: "594" } });
    // The draft draws x1 27 CSS px to the right. The press is never prevented, so the browser blurs the field.
    expect(press(513, 536)).toBe(true);
    fireEvent.blur(field);
    expect(labelsOf(st())).toEqual(["position change"]);
    move(540, 536);
    frame();
    release(540, 536);
    expect(labelsOf(st())).toEqual(["position change", "position change"]);
    expect(patchOf(st(), 0)).toEqual({ transform: { x: 0.55 } });
    expect(patchOf(st(), 1)).toEqual({ transform: { x: 0.6 } });
  });

  it("a draft in the inspector's X field is saved before a handle drag sets anything", () => {
    const { st } = show({ selected: ["x1"], inspector: true });
    const field = screen.getByLabelText("X");
    fireEvent.change(field, { target: { value: "594" } });
    expect(pressHandle("e", 529, 536)).toBe(true);
    fireEvent.blur(field);
    expect(labelsOf(st())).toEqual(["position change"]);
    move(545, 536);
    frame();
    release(545, 536);
    expect(labelsOf(st())).toEqual(["position change", "size change"]);
    expect(patchOf(st(), 1)).toEqual({ transform: { x: 0.5648, stretch: 1.5 } });
  });

  it("a viewer sees no handles and moves nothing", () => {
    const { st } = show({ over: { canEdit: false }, selected: ["x1"] });
    expect(handleNames()).toEqual([]);
    press(...TEXT);
    move(513, 536);
    frame();
    release(513, 536);
    expect(st().gesture).toBeNull();
    expect(st().queue).toEqual([]);
    expect(transformOf(st(), "x1").x).toBe(0.5);
  });

  it("the handles hide while playing", () => {
    const { st } = show({ selected: ["x1"] });
    expect(handleNames()).toHaveLength(9);
    act(() => st().play());
    expect(handleNames()).toEqual([]);
    act(() => st().pause());
    expect(handleNames()).toHaveLength(9);
  });

  it("losing edit access mid-drag ends it", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(513, 536);
    frame();
    act(() => st().revokeEditing());
    expect(handleNames()).toEqual([]);
    // The drag is over at once: Escape is left to the rest of the page.
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
    release(513, 536);
    expect(st().queue).toEqual([]);
    expect(st().gesture).toBeNull();
  });
});
