// @vitest-environment happy-dom
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { peerLook, PEER_MORE } from "@/components/editor/peer-look";
import { PresenceProvider } from "@/components/editor/presence-context";
import { Preview } from "@/components/editor/preview";
import { useShortcuts } from "@/components/editor/use-shortcuts";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { editTextInPlace } from "@/lib/editor/actions";
import { copyClips, createClipboard } from "@/lib/editor/clipboard";
import { MESSAGES } from "@/lib/editor/messages";
import { createPresenceStore, type PeerWire, type PresenceStore } from "@/lib/editor/presence";
import { DEFAULT_PREFS, createSettingsStore, type BoardZoom } from "@/lib/editor/settings";
import { findClip, viewDoc, type EditorState, type EditorStore } from "@/lib/editor/store";
import type { EditorInit } from "@/lib/editor/types";
import { drawFrame } from "@/lib/render/compositor";
import type { Clip, TimelineDoc, Transform } from "@/lib/timeline";
import { entry, makeStore, noticesOf, sampleDoc, text } from "../editor/fixtures";
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
  shortcuts?: boolean;
  // Teammates' selections, as the last check answered them; without it there is no presence provider at all.
  peers?: PeerWire[];
};

function Keys() {
  useShortcuts(() => {});
  return null;
}

function show(opts: ShowOptions = {}) {
  const store: EditorStore = makeStore(opts.over);
  store.getState().seek(opts.at ?? 10);
  store.getState().select(opts.selected ?? []);
  const clipboard = createClipboard();
  if (opts.copied) clipboard.write(copyClips(store.getState().doc, opts.copied)!);
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: opts.boardZoom ?? "fill" } }, { prefs: vi.fn(), keymap: vi.fn() });
  const presence: PresenceStore = createPresenceStore("u1");
  if (opts.peers) presence.getState().receive(opts.peers, 0);
  const preview: ReactNode = (
    <ContextMenuProvider>
      {opts.inspector && <Inspector />}
      {opts.shortcuts && <Keys />}
      <Preview />
    </ContextMenuProvider>
  );
  const tree: ReactNode = (
    <EditorProvider store={store} settings={settings} clipboard={clipboard}>
      {opts.peers ? <PresenceProvider store={presence}>{preview}</PresenceProvider> : preview}
    </EditorProvider>
  );
  render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
  const st = () => store.getState();
  return { store, st, presence };
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

  it("a right-click on empty picture opens 'Preview', and Safe area shows it", () => {
    const { st } = show({ at: 70 });
    rightClick(...TEXT);
    const menu = screen.getByRole("menu", { name: "Preview" });
    const paste = within(menu).getByRole("menuitem", { name: /^Paste/ });
    expect(paste.hasAttribute("disabled") || paste.getAttribute("aria-disabled") === "true").toBe(true);
    const safe = within(menu).getByRole("menuitemcheckbox", { name: "Safe area" });
    expect(safe.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(safe);
    expect(st().showSafeZones).toBe(true);
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

  it("a viewer's preview menu has only Safe area", () => {
    show({ at: 70, over: { canEdit: false }, copied: ["x1"] });
    rightClick(...TEXT);
    const menu = screen.getByRole("menu", { name: "Preview" });
    expect([...menu.querySelectorAll("button")].map((i) => i.textContent)).toEqual(["Safe area"]);
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Safe area" }).getAttribute("aria-checked")).toBe("false");
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

  it("a cancelled pointer drops the move", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(513, 536);
    frame();
    fireEvent.pointerCancel(overlay(), { pointerId: 1 });
    expect(st().gesture).toBeNull();
    expect(transformOf(st(), "x1").x).toBe(0.5);
    release(513, 536);
    expect(st().queue).toEqual([]);
  });

  // On a quick flick the browser lets the capture go a few milliseconds before the pointerup, and the pointerup then
  // goes to whatever is under the pointer.
  it("a capture lost before the release drops the clip where the pointer was last seen, and saves it", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(500, 536);
    frame();
    move(513, 536); // its frame has not run yet
    fireEvent(overlay(), new Event("lostpointercapture"));
    expect(st().gesture).toBeNull();
    expect(labelsOf(st())).toEqual(["position change"]);
    expect(patchOf(st())).toEqual({ transform: { x: 0.55 } });
    // The late pointerup changes nothing more.
    release(520, 536);
    expect(st().queue).toHaveLength(1);
    expect(transformOf(st(), "x1").x).toBeCloseTo(0.55, 6);
  });

  it("a handle drag whose capture is lost saves the resize shown", () => {
    const { st } = show({ selected: ["x1"] });
    pressHandle("e", 502, 536);
    move(518, 536);
    frame();
    const shown = gesturePatch(st());
    fireEvent(overlay(), new Event("lostpointercapture"));
    expect(st().gesture).toBeNull();
    expect(labelsOf(st())).toEqual(["size change"]);
    expect(patchOf(st())).toEqual(shown);
  });

  it("a capture lost before a press travels saves nothing", () => {
    const { st } = show({ selected: ["x1"] });
    press(...TEXT);
    move(488, 536);
    fireEvent(overlay(), new Event("lostpointercapture"));
    move(513, 536);
    frame();
    release(513, 536);
    expect(st().gesture).toBeNull();
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

  // x1 10 CSS px right of the frame's middle and 4 below it, still under TEXT.
  const offCentre = () => withTransform(sampleDoc(), "x1", { x: 0.5 + 20 / 1080, y: 0.5 + 8 / 1920 });

  it("a moved centre snaps to the frame's middle with a guide across the frame", () => {
    const { st } = show({ over: { doc: offCentre() }, selected: ["x1"] });
    expect(overlay().querySelectorAll("[data-canvas-guide]")).toHaveLength(0);
    press(...TEXT);
    move(480, 535); // 8 and 6 project px off the middle, inside the 12 px a 6 CSS px snap reaches at k = 0.5
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.5, y: 0.5 } });
    const lines = [...overlay().querySelectorAll("line[data-canvas-guide]")];
    expect(lines.map((l) => [l.getAttribute("data-canvas-guide"), l.getAttribute("x1"), l.getAttribute("y1"), l.getAttribute("x2"), l.getAttribute("y2")])).toEqual([
      ["x", "286", "16", "286", "976"],
      ["y", "16", "496", "556", "496"],
    ]);
    expect(lines[0].getAttribute("class")).toContain("stroke-ed-accent");
    expect(lines[0].getAttribute("stroke-width")).toBe("1");
    move(513, 535);
    frame();
    expect([...overlay().querySelectorAll("[data-canvas-guide]")].map((l) => l.getAttribute("data-canvas-guide"))).toEqual(["y"]);
    release(513, 535);
    expect(overlay().querySelectorAll("[data-canvas-guide]")).toHaveLength(0);
  });

  it("with snapping off the centre does not snap", () => {
    const { st } = show({ over: { doc: offCentre() }, selected: ["x1"] });
    act(() => st().setSnapping(false));
    press(...TEXT);
    move(480, 535);
    frame();
    release(480, 535);
    expect(patchOf(st())).toEqual({ transform: { x: 0.5074, y: 0.5031 } });
  });

  it("turning snapping off mid-drag works the move out again", () => {
    const { st } = show({ over: { doc: offCentre() }, selected: ["x1"] });
    press(...TEXT);
    move(480, 535);
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.5, y: 0.5 } });
    act(() => st().setSnapping(false));
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.5074, y: 0.5031 } });
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

  it("dragging a side handle with Shift stretches the clip and keeps the opposite side in place", () => {
    const { st } = show({ selected: ["x1"] });
    expect(placeOf("e")).toEqual(["302px", "496px"]);
    expect(handle("e")!.style.cursor).toBe("ew-resize");
    expect(pressHandle("e", 502, 536, { shiftKey: true })).toBe(true);
    move(518, 536, { shiftKey: true });
    frame();
    release(518, 536, { shiftKey: true });
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

  it("a corner keeps the shape with Cmd held", () => {
    const { st } = show({ selected: ["x1"] });
    const keys = { metaKey: true };
    pressHandle("se", 502, 555.2, keys);
    move(518, 555.2, keys);
    frame();
    release(518, 555.2, keys);
    expect(labelsOf(st())).toEqual(["size change"]);
    const { transform } = patchOf(st()) as { transform: Record<string, number> };
    expect(transform).not.toHaveProperty("stretch");
    expect(transform.scale).toBeCloseTo(1.2049, 3);
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
    expect(gesturePatch(st())).toMatchObject({ transform: { scale: 1.5 } });
    expect(gesturePatch(st())).not.toHaveProperty("transform.stretch");
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { x: 0.5148, stretch: 1.5 } });
    fireEvent.keyUp(window, { key: "Shift" });
    frame();
    expect(gesturePatch(st())).toMatchObject({ transform: { scale: 1.5 } });
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

  it("a click on the rotate handle changes nothing, even near a quarter turn", () => {
    let { st } = show({ over: { doc: withTransform(sampleDoc(), "x1", { rotation: 2 }) }, selected: ["x1"] });
    pressHandle("rotate", 486, 492.8);
    release(486, 492.8);
    expect(st().queue).toEqual([]);
    expect(st().gesture).toBeNull();
    expect(transformOf(st(), "x1").rotation).toBe(2);
    document.body.innerHTML = "";
    ({ st } = show({ over: { doc: withTransform(sampleDoc(), "x1", { rotation: 2 }) }, selected: ["x1"] }));
    pressHandle("rotate", 486, 492.8);
    move(487, 492.8);
    frame();
    release(487, 492.8);
    expect(st().queue).toEqual([]);
    expect(transformOf(st(), "x1").rotation).toBe(2);
    document.body.innerHTML = "";
    ({ st } = show({ over: { doc: withTransform(sampleDoc(), "x1", { rotation: 7 }) }, selected: ["x1"] }));
    pressHandle("rotate", 486, 492.8, { shiftKey: true });
    release(486, 492.8, { shiftKey: true });
    expect(st().queue).toEqual([]);
    expect(transformOf(st(), "x1").rotation).toBe(7);
  });

  it("a right-click on a handle opens its clip's menu", () => {
    // The rotate handle is 24 CSS px above x1, where a press would reach the video behind it.
    const { st } = show({ selected: ["x1"] });
    fireEvent.contextMenu(handle("rotate")!, { clientX: 486, clientY: 492.8, button: 2 });
    expect(screen.getByRole("menu", { name: "Clip actions" })).toBeTruthy();
    expect(st().selection.clipIds).toEqual(["x1"]);
  });

  it("on a Mac a Ctrl press on a handle crops", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st } = show({ selected: ["x1"] });
    pressHandle("e", 502, 536, { ctrlKey: true });
    move(494, 536, { ctrlKey: true });
    frame();
    release(494, 536, { ctrlKey: true });
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(patchOf(st())).toEqual({ transform: { crop: { left: 0, top: 0, right: 0.25, bottom: 0 } } });
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
    pressHandle("e", 506, 536, { shiftKey: true });
    move(510, 536, { shiftKey: true });
    frame();
    release(510, 536, { shiftKey: true });
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

  it("a full-frame clip's rotate handle sits inside it when there is no room past any side", () => {
    // The board has 16 px round the frame here, too little on every side. rotate-handle-place.test.tsx has the rest.
    show({ selected: ["c1"] });
    expect(placeOf("rotate")).toEqual(["286px", "52px"]);
    document.body.innerHTML = "";
    show({ selected: ["x1"] });
    expect(placeOf("rotate")).toEqual(["286px", "452.8px"]);
    // Above a clip near the top, a rotate handle within 12 px of the pane's edge goes below the clip instead.
    document.body.innerHTML = "";
    show({ over: { doc: withTransform(sampleDoc(), "x1", { y: 0.04 }) }, selected: ["x1"] });
    expect(placeOf("n")).toEqual(["286px", "35.2px"]);
    expect(placeOf("rotate")).toEqual(["286px", "97.6px"]);
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
    expect(patchOf(st(), 1)).toEqual({ transform: { x: 0.5648, scale: 1.5 } });
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

// c1, the frame-sized placeholder, at k = 0.5: its w handle is at client (216, 536) and its e handle at (756, 536).
const looks = () =>
  [...document.querySelectorAll<HTMLElement>("[data-canvas-handle]")].map((h) => [h.dataset.canvasHandle, h.getAttribute("data-look")]);
const lookOfAll = (look: string) => [...EIGHT.map((g) => [g, look]), ["rotate", null]].sort();
const cropFull = () => overlay().querySelector("[data-crop-full]");
const pickItem = (name: string) => fireEvent.click(screen.getByRole("menuitem", { name }));

describe("cropping on the preview", () => {
  it("Ctrl-dragging a side crops it and keeps the rest in place", () => {
    const { st } = show({ selected: ["c1"] });
    pressHandle("w", 216, 536, { ctrlKey: true });
    move(270, 536, { ctrlKey: true });
    frame();
    release(270, 536, { ctrlKey: true });
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(st().queue[0].ops).toEqual([{ op: "update_clip", clipId: "c1", patch: { transform: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } } }]);
  });

  it("Ctrl+Shift on a side keeps the kept part's shape", () => {
    const { st } = show({ selected: ["c1"] });
    pressHandle("e", 756, 536, { ctrlKey: true, shiftKey: true });
    move(702, 536, { ctrlKey: true, shiftKey: true });
    frame();
    release(702, 536, { ctrlKey: true, shiftKey: true });
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(patchOf(st())).toEqual({ transform: { crop: { left: 0, top: 0.05, right: 0.1, bottom: 0.05 } } });
  });

  it("Ctrl pressed mid-drag switches the drag to a crop", () => {
    const { st } = show({ selected: ["c1"] });
    pressHandle("e", 756, 536);
    move(702, 536);
    frame();
    expect(gesturePatch(st())).toHaveProperty("transform.scale");
    expect(cropFull()).toBeNull();
    expect(fireEvent.keyDown(window, { key: "Control", ctrlKey: true })).toBe(true);
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { crop: { left: 0, top: 0, right: 0.1, bottom: 0 } } });
    expect(cropFull()).not.toBeNull();
    expect(fireEvent.keyUp(window, { key: "Control" })).toBe(true);
    frame();
    expect(gesturePatch(st())).toHaveProperty("transform.scale");
    expect(cropFull()).toBeNull();
    expect(gesturePatch(st())).not.toHaveProperty("transform.crop");
    release(702, 536);
    expect(labelsOf(st())).toEqual(["size change"]);
  });

  it("Ctrl is read from each pointer move too", () => {
    const { st } = show({ selected: ["c1"] });
    pressHandle("w", 216, 536);
    move(270, 536, { ctrlKey: true });
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } });
    move(270, 536);
    frame();
    expect(gesturePatch(st())).not.toHaveProperty("transform.crop");
  });

  it("an unclamped handle crops from the first move", () => {
    const { st } = show({ selected: ["c1"] });
    pressHandle("w", 216, 536, { ctrlKey: true });
    move(218, 536, { ctrlKey: true });
    frame();
    expect(gesturePatch(st())).toEqual({ transform: { crop: { left: 0.0037, top: 0, right: 0, bottom: 0 } } });
  });

  it("a Ctrl drag of the clip's body moves it and outlines nothing", () => {
    const { st } = show({ selected: ["c1"] });
    press(...PICTURE, { ctrlKey: true });
    move(256, 76, { ctrlKey: true });
    frame();
    expect(cropFull()).toBeNull();
    release(256, 76, { ctrlKey: true });
    expect(labelsOf(st())).toEqual(["position change"]);
  });

  it("on a Mac a Control drag crops", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st } = show({ selected: ["c1"] });
    pressHandle("w", 216, 536, { ctrlKey: true });
    move(270, 536, { ctrlKey: true });
    frame();
    release(270, 536, { ctrlKey: true });
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(patchOf(st())).toEqual({ transform: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } });
  });

  it("a clamped handle starts the cut where it is drawn", () => {
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    expect(placeOf("w")).toEqual(["12px", "496px"]);
    pressHandle("w", 212, 536, { ctrlKey: true });
    move(217, 536, { ctrlKey: true });
    frame();
    release(217, 536, { ctrlKey: true });
    expect(labelsOf(st())).toEqual(["crop"]);
    expect((patchOf(st()) as { transform: { crop: { left: number } } }).transform.crop.left).toBe(0.334);
  });

  it("a Ctrl+click on a clamped handle crops nothing", () => {
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    pressHandle("w", 212, 536, { ctrlKey: true });
    release(212, 536, { ctrlKey: true });
    expect(st().queue).toEqual([]);
  });

  it("a clamped handle's crop waits for the click slop", () => {
    const { st } = show({ over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) }, selected: ["c1"] });
    pressHandle("w", 212, 536, { ctrlKey: true });
    move(214, 536, { ctrlKey: true });
    frame();
    expect(st().gesture).toBeNull();
    move(212, 536, { ctrlKey: true });
    frame();
    release(212, 536, { ctrlKey: true });
    expect(st().queue).toEqual([]);
    // Once past the slop, the cut keeps applying when the pointer comes back near the press.
    pressHandle("w", 212, 536, { ctrlKey: true });
    move(217, 536, { ctrlKey: true });
    frame();
    move(213, 536, { ctrlKey: true });
    frame();
    expect((gesturePatch(st()) as { transform: { crop: { left: number } } }).transform.crop.left).toBe(0.3315);
    fireEvent.keyDown(window, { key: "Escape" });
    release(213, 536);
    // A clamped handle resizes from the first move: only the crop waits.
    pressHandle("w", 212, 536);
    move(214, 536);
    frame();
    expect(gesturePatch(st())).toHaveProperty("transform.scale");
  });

  it("text crops by hand too", () => {
    const { st } = show({ selected: ["x1"] });
    pressHandle("w", 470, 536, { ctrlKey: true });
    move(478, 536, { ctrlKey: true });
    frame();
    release(478, 536, { ctrlKey: true });
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(st().queue[0].ops).toEqual([{ op: "update_clip", clipId: "x1", patch: { transform: { crop: { left: 0.25, top: 0, right: 0, bottom: 0 } } } }]);
  });

  it("holding Ctrl over the board turns the handles into crop marks", () => {
    show({ selected: ["c1"] });
    expect(looks().sort()).toEqual(lookOfAll("resize"));
    fireEvent.pointerMove(overlay(), { clientX: 486, clientY: 536, pointerId: 1 });
    expect(fireEvent.keyDown(window, { key: "Control", ctrlKey: true })).toBe(true);
    expect(looks().sort()).toEqual(lookOfAll("crop"));
    // Each mark is drawn in the clip's own turn, in its 24 px target.
    expect(handle("w")!.querySelector("svg polygon")!.getAttribute("points")).toBe("10,5 14,5 14,19 10,19");
    expect(handle("nw")!.querySelector("svg polygon")!.getAttribute("points")).toBe("10,10 22,10 22,14 14,14 14,22 10,22");
    expect(handle("w")!.style.width).toBe("24px");
    expect(fireEvent.keyUp(window, { key: "Control" })).toBe(true);
    expect(looks().sort()).toEqual(lookOfAll("resize"));
    expect(handle("w")!.querySelector("svg")).toBeNull();
  });

  it("Ctrl let go while the window was away, or while the handles were hidden, leaves no marks", () => {
    const { st } = show({ selected: ["c1"] });
    fireEvent.pointerMove(overlay(), { clientX: 486, clientY: 536, pointerId: 1 });
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    expect(looks().sort()).toEqual(lookOfAll("crop"));
    fireEvent.blur(window);
    expect(looks().sort()).toEqual(lookOfAll("resize"));
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    expect(looks().sort()).toEqual(lookOfAll("crop"));
    act(() => st().play());
    fireEvent.keyUp(window, { key: "Control" });
    act(() => st().pause());
    expect(looks().sort()).toEqual(lookOfAll("resize"));
  });

  it("Ctrl is also read from the pointer's moves over the board", () => {
    show({ selected: ["c1"] });
    fireEvent.pointerMove(overlay(), { clientX: 486, clientY: 536, pointerId: 1, ctrlKey: true });
    expect(looks().sort()).toEqual(lookOfAll("crop"));
    fireEvent.pointerMove(overlay(), { clientX: 486, clientY: 536, pointerId: 1 });
    expect(looks().sort()).toEqual(lookOfAll("resize"));
  });

  it("Ctrl away from the board leaves the handles as they are, and leaving the board ends the marks", () => {
    show({ selected: ["c1"] });
    expect(fireEvent.keyDown(window, { key: "Control", ctrlKey: true })).toBe(true);
    expect(looks().sort()).toEqual(lookOfAll("resize"));
    fireEvent.pointerEnter(overlay(), { clientX: 486, clientY: 536, pointerId: 1 });
    expect(looks().sort()).toEqual(lookOfAll("crop"));
    fireEvent.pointerLeave(overlay(), { clientX: 100, clientY: 536, pointerId: 1 });
    expect(looks().sort()).toEqual(lookOfAll("resize"));
  });

  it("Alt with another key reaches the page", () => {
    show({ selected: ["c1"] });
    expect(fireEvent.keyDown(window, { key: "f", altKey: true })).toBe(true);
    expect(fireEvent.keyUp(window, { key: "f", altKey: true })).toBe(true);
  });

  it("with no handles shown a lone Alt reaches the page", () => {
    const { st } = show({ selected: ["c1", "x1"] });
    expect(fireEvent.keyDown(window, { key: "Alt", altKey: true })).toBe(true);
    expect(fireEvent.keyUp(window, { key: "Alt" })).toBe(true);
    act(() => st().select(["c1"]));
    expect(fireEvent.keyDown(window, { key: "Alt", altKey: true })).toBe(false);
    act(() => st().play());
    expect(fireEvent.keyUp(window, { key: "Alt" })).toBe(true);
  });

  it("a Ctrl drag outlines the whole clip", () => {
    show({ selected: ["c1"] });
    expect(cropFull()).toBeNull();
    pressHandle("w", 216, 536, { ctrlKey: true });
    // From the press.
    expect(cropFull()).not.toBeNull();
    expect(looks().sort()).toEqual(lookOfAll("crop"));
    move(270, 536, { ctrlKey: true });
    frame();
    const full = cropFull()!;
    expect(full.getAttribute("points")).toBe("16,16 556,16 556,976 16,976");
    expect(full.getAttribute("fill")).toBe("none");
    expect(full.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(full.getAttribute("class")).toContain("stroke-ed-accent");
    // The marks stay while the drag crops, even with the pointer off the board.
    fireEvent.pointerLeave(overlay(), { clientX: 100, clientY: 536, pointerId: 1 });
    expect(looks().sort()).toEqual(lookOfAll("crop"));
    release(270, 536, { ctrlKey: true });
    expect(cropFull()).toBeNull();
  });

  it("the whole-box outline is the uncut box of a clip already cropped", () => {
    show({ over: { doc: withTransform(sampleDoc(), "c1", { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }) }, selected: ["c1"] });
    expect(placeOf("w")).toEqual(["70px", "496px"]);
    pressHandle("w", 270, 536, { ctrlKey: true });
    move(280, 536, { ctrlKey: true });
    frame();
    expect(cropFull()!.getAttribute("points")).toBe("16,16 556,16 556,976 16,976");
  });

  it("a plain resize draws no whole-box outline", () => {
    show({ selected: ["c1"] });
    pressHandle("w", 216, 536);
    move(270, 536);
    frame();
    expect(cropFull()).toBeNull();
  });

  it("Crop in a clip's menu makes the next handle drag a crop", () => {
    const { st } = show({ selected: [] });
    rightClick(...PICTURE);
    pickItem("Crop");
    expect(st().notice?.text).toBe("Drag a handle to crop. Next time, you can hold Ctrl while you drag.");
    expect(looks().sort()).toEqual(lookOfAll("crop"));
    pressHandle("w", 216, 536);
    move(270, 536);
    frame();
    release(270, 536);
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(patchOf(st())).toEqual({ transform: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } });
    expect(st().cropArmed).toBeNull();
    expect(looks().sort()).toEqual(lookOfAll("resize"));
    pressHandle("w", 270, 536);
    move(280, 536);
    frame();
    release(280, 536);
    expect(labelsOf(st())).toEqual(["crop", "size change"]);
  });

  it("a drag crops only while its clip is armed", () => {
    const { st } = show({ selected: ["c1"] });
    act(() => st().setCropArmed("c1"));
    pressHandle("w", 216, 536);
    move(270, 536);
    frame();
    expect(gesturePatch(st())).toHaveProperty("transform.crop");
    act(() => st().setCropArmed(null));
    frame();
    expect(gesturePatch(st())).toHaveProperty("transform.scale");
  });

  it("an armed crop ends with any canvas drag, and a click does not end it", () => {
    const { st } = show({ selected: ["c1"] });
    act(() => st().setCropArmed("c1"));
    // A press that never travels is no drag.
    click(...PICTURE);
    expect(st().cropArmed).toBe("c1");
    press(...PICTURE);
    move(256, 76);
    frame();
    release(256, 76);
    expect(labelsOf(st())).toEqual(["position change"]);
    expect(st().cropArmed).toBeNull();
    act(() => st().setCropArmed("c1"));
    pressHandle("w", 236, 536);
    move(290, 536);
    frame();
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
    expect(st().cropArmed).toBeNull();
  });

  it("a click on a handle keeps Crop armed", () => {
    const { st } = show({ selected: ["c1"] });
    act(() => st().setCropArmed("c1"));
    pressHandle("w", 216, 536);
    release(216, 536);
    expect(st().cropArmed).toBe("c1");
    expect(st().queue).toEqual([]);
    pressHandle("w", 216, 536);
    move(270, 536);
    frame();
    release(270, 536);
    expect(labelsOf(st())).toEqual(["crop"]);
    expect(st().cropArmed).toBeNull();
  });
});

// The in-place box over x1 at k = 0.5: its centre, project (540, 960), is overlay (286, 496).
const textBox = () => screen.queryByRole("textbox", { name: "Edit text" }) as HTMLTextAreaElement | null;
const doubleClick = (x: number, y: number) => fireEvent.doubleClick(overlay(), { clientX: x, clientY: y });
const textOf = (s: EditorState, clipId: string) => {
  const clip = findClip(viewDoc(s), clipId)!.clip;
  return clip.type === "text" ? clip.text : null;
};
const lastDrawOptions = () => vi.mocked(drawFrame).mock.calls.at(-1)![3];

describe("typing text in place", () => {
  it("double-clicking text on the preview opens a box with the caret at the end", () => {
    const { st } = show({ selected: ["c1"] });
    // happy-dom leaves the caret at the end of a new value by itself; a browser need not.
    const caret = vi.spyOn(HTMLTextAreaElement.prototype, "setSelectionRange");
    doubleClick(...TEXT);
    const box = textBox()!;
    expect(caret).toHaveBeenLastCalledWith(2, 2);
    expect(box.value).toBe("hi");
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([2, 2]);
    expect(st().textEditId).toBe("x1");
    expect(st().selection.clipIds).toEqual(["x1"]);
    expect(box.hasAttribute("data-canvas-text-editor")).toBe(true);
    expect(box.hasAttribute("data-edit-control")).toBe(false);
    expect(box.maxLength).toBe(2000);
    expect(box.closest("[data-canvas-overlay]")).toBe(overlay());
  });

  it("the box takes focus without scrolling the board", () => {
    show();
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");
    doubleClick(...TEXT);
    expect(focus).toHaveBeenCalled();
    expect(focus.mock.calls).toEqual(focus.mock.calls.map(() => [{ preventScroll: true }]));
    expect(document.activeElement).toBe(textBox());
  });

  it("the box lies over the text in its font, size, weight, colour and alignment", () => {
    const doc = sampleDoc();
    const x1 = doc.tracks[1].clips[0];
    if (x1.type === "text") x1.style = { ...x1.style, color: "#ffcc00", align: "left", fontWeight: 500 };
    // Left-aligned, "hi" is drawn at the box's left end, project (54..118, 960).
    show({ over: { doc } });
    doubleClick(259, 536);
    const { style } = textBox()!;
    expect([style.left, style.top]).toEqual(["286px", "496px"]);
    expect(style.transform).toBe("translate(-50%, -50%) rotate(0deg) scaleX(1)");
    // 64 px at k = 0.5; the wrap width is 90% of the 1080 px frame.
    expect(style.fontSize).toBe("32px");
    expect(style.width).toBe("486px");
    expect(style.fontWeight).toBe("500");
    expect(style.fontFamily).toBe("Geist, sans-serif"); // the resolver's '"Geist", sans-serif', as the DOM reads it back
    expect(style.lineHeight).toBe("1.2");
    expect(style.textAlign).toBe("left");
    expect(style.color).toBe("#ffcc00");
    expect(textBox()!.className.split(" ")).toEqual(
      expect.arrayContaining(["absolute", "resize-none", "overflow-hidden", "whitespace-pre-wrap", "wrap-anywhere", "bg-transparent", "p-0", "border-0", "outline", "outline-ed-accent", "select-text"]),
    );
  });

  it("on a keyframed clip the box opens where the text is drawn at the playhead", () => {
    const doc = sampleDoc();
    const x1 = doc.tracks[1].clips[0];
    // At the playhead (frame 10) x is 0.25, y 0.75, scale 2 and rotation 30; the transform's own values are stale.
    x1.keyframes = {
      x: [{ at: 0, value: 0.1 }, { at: 20, value: 0.4 }],
      y: [{ at: 0, value: 0.75 }],
      scale: [{ at: 0, value: 1.5 }, { at: 20, value: 2.5 }],
      rotation: [{ at: 10, value: 30 }],
    };
    const { store } = show({ over: { doc } });
    act(() => editTextInPlace(store, "x1"));
    const { style } = textBox()!;
    // Project (270, 1440) at k = 0.5, 16 px in from the overlay's corner.
    expect([style.left, style.top]).toEqual(["151px", "736px"]);
    expect(style.transform).toBe("translate(-50%, -50%) rotate(30deg) scaleX(1)");
    expect(style.fontSize).toBe("64px");
    expect(style.width).toBe("972px");
  });

  it("the box grows to fit its lines", () => {
    show();
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLTextAreaElement) {
      return this.value.split("\n").length * 38;
    });
    doubleClick(...TEXT);
    expect(textBox()!.style.height).toBe("38px");
    fireEvent.change(textBox()!, { target: { value: "hi\nthere" } });
    expect(textBox()!.style.height).toBe("76px");
  });

  it("typing shows at once, Enter adds a line, and Ctrl+Enter saves one change", () => {
    const { st } = show();
    doubleClick(...TEXT);
    fireEvent.change(textBox()!, { target: { value: "hey" } });
    expect(textOf(st(), "x1")).toBe("hey");
    expect(st().queue).toEqual([]);
    expect(fireEvent.keyDown(textBox()!, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(textBox()!, { key: "Enter", shiftKey: true })).toBe(true);
    expect(textBox()).not.toBeNull();
    expect(st().queue).toEqual([]);
    expect(fireEvent.keyDown(textBox()!, { key: "Enter", ctrlKey: true })).toBe(false);
    expect(labelsOf(st())).toEqual(["text edit"]);
    expect(textOf(st(), "x1")).toBe("hey");
    expect(textBox()).toBeNull();
    expect(st().textEditId).toBeNull();
  });

  it("Cmd+Enter saves too", () => {
    const { st } = show();
    doubleClick(...TEXT);
    fireEvent.change(textBox()!, { target: { value: "hey" } });
    expect(fireEvent.keyDown(textBox()!, { key: "Enter", metaKey: true })).toBe(false);
    expect(labelsOf(st())).toEqual(["text edit"]);
    expect(textBox()).toBeNull();
  });

  it("Escape keeps what was typed and saves one change", () => {
    const { st } = show();
    doubleClick(...TEXT);
    fireEvent.change(textBox()!, { target: { value: "hey" } });
    expect(fireEvent.keyDown(textBox()!, { key: "Escape" })).toBe(false);
    expect(labelsOf(st())).toEqual(["text edit"]);
    expect(textOf(st(), "x1")).toBe("hey");
    expect(textBox()).toBeNull();
    expect(st().textEditId).toBeNull();
  });

  it("Escape with nothing typed closes the box and saves nothing", () => {
    const { st } = show();
    doubleClick(...TEXT);
    expect(fireEvent.keyDown(textBox()!, { key: "Escape" })).toBe(false);
    expect(st().queue).toEqual([]);
    expect(textBox()).toBeNull();
  });

  it("blur saves", () => {
    const { st } = show();
    doubleClick(...TEXT);
    fireEvent.change(textBox()!, { target: { value: "hey" } });
    fireEvent.blur(textBox()!);
    expect(labelsOf(st())).toEqual(["text edit"]);
    expect(textOf(st(), "x1")).toBe("hey");
    expect(textBox()).toBeNull();
    expect(st().textEditId).toBeNull();
  });

  it("switching to another window keeps the box open and saves what was typed", () => {
    const { st } = show();
    doubleClick(...TEXT);
    fireEvent.change(textBox()!, { target: { value: "hey" } });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    fireEvent.blur(textBox()!);
    expect(textBox()).not.toBeNull();
    expect(st().textEditId).toBe("x1");
    expect(labelsOf(st())).toEqual(["text edit"]);
    expect(textOf(st(), "x1")).toBe("hey");
    hasFocus.mockReturnValue(true);
    fireEvent.blur(textBox()!);
    expect(textBox()).toBeNull();
    expect(labelsOf(st())).toEqual(["text edit"]);
  });

  it("when the box closes by a key, focus goes back to what had it", () => {
    const { store } = show();
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    act(() => editTextInPlace(store, "x1"));
    expect(document.activeElement).toBe(textBox());
    fireEvent.keyDown(textBox()!, { key: "Escape" });
    expect(document.activeElement).toBe(before);
    act(() => editTextInPlace(store, "x1"));
    fireEvent.keyDown(textBox()!, { key: "Enter", ctrlKey: true });
    expect(document.activeElement).toBe(before);
    // After a blur, focus stays where the click put it: nothing, for a click on the board, or a control.
    act(() => editTextInPlace(store, "x1"));
    fireEvent.blur(textBox()!);
    expect(textBox()).toBeNull();
    expect(document.activeElement).not.toBe(before);
    const clicked = document.createElement("button");
    document.body.append(clicked);
    act(() => editTextInPlace(store, "x1"));
    act(() => clicked.focus());
    expect(textBox()).toBeNull();
    expect(document.activeElement).toBe(clicked);
  });

  it("typing s and a space into the box neither splits nor plays", () => {
    const { st } = show({ shortcuts: true });
    doubleClick(...TEXT);
    expect(fireEvent.keyDown(textBox()!, { key: "s" })).toBe(true);
    expect(fireEvent.keyDown(textBox()!, { key: " " })).toBe(true);
    fireEvent.change(textBox()!, { target: { value: "his " } });
    expect(st().playing).toBe(false);
    expect(st().queue).toEqual([]);
    fireEvent.keyDown(textBox()!, { key: "Enter", ctrlKey: true });
    expect(labelsOf(st())).toEqual(["text edit"]);
    // Out of the box, the same key splits.
    fireEvent.keyDown(document.body, { key: "s" });
    expect(labelsOf(st())).toEqual(["text edit", "split"]);
  });

  it("a viewer gets no box, and playback goes on", () => {
    const { st } = show({ over: { canEdit: false } });
    act(() => st().play());
    doubleClick(...TEXT);
    expect(textBox()).toBeNull();
    expect(st().textEditId).toBeNull();
    expect(st().playing).toBe(true);
    expect(st().selection.clipIds).toEqual([]);
  });

  it("a double-click on a video starts nothing", () => {
    const { st } = show();
    doubleClick(...PICTURE);
    expect(textBox()).toBeNull();
    expect(st().textEditId).toBeNull();
    expect(st().notice).toBeNull();
  });

  it("a double-click on locked text says the track is locked", () => {
    const doc = sampleDoc();
    doc.tracks[1].locked = true;
    const { st } = show({ over: { doc } });
    doubleClick(...TEXT);
    expect(st().notice?.text).toBe("That track is locked.");
    expect(st().textEditId).toBeNull();
    expect(textBox()).toBeNull();
  });

  it("a double-click outside the frame reaches only a selected clip", () => {
    const doc = () => withTransform(sampleDoc(), "x1", { scale: 20 });
    const first = show({ over: { doc: doc() } });
    doubleClick(206, 536); // project (-20, 960), on x1's box but beside the frame
    expect(first.st().textEditId).toBeNull();
    document.body.innerHTML = "";
    const second = show({ over: { doc: doc() }, selected: ["x1"] });
    doubleClick(206, 536);
    expect(second.st().textEditId).toBe("x1");
  });

  it("Edit text from the clip menu opens the box", () => {
    const { st } = show();
    rightClick(...TEXT);
    pickItem("Edit text");
    expect(st().textEditId).toBe("x1");
    expect(document.activeElement).toBe(textBox());
  });

  it("the preview does not draw the text twice", () => {
    const { st } = show();
    doubleClick(...TEXT);
    frame();
    expect(lastDrawOptions()).toMatchObject({ hideClipId: "x1" });
    fireEvent.keyDown(textBox()!, { key: "Escape" });
    frame();
    expect(lastDrawOptions()?.hideClipId).toBeUndefined();
    expect(st().textEditId).toBeNull();
  });

  it("while the box is open its clip has no handles or outline", () => {
    show({ selected: ["x1"] });
    expect(handleNames()).toHaveLength(9);
    expect(outlines()).toHaveLength(1);
    doubleClick(...TEXT);
    expect(handleNames()).toEqual([]);
    expect(outlines()).toEqual([]);
    fireEvent.keyDown(textBox()!, { key: "Escape" });
    expect(handleNames()).toHaveLength(9);
    expect(outlines()).toHaveLength(1);
  });

  it("a press or a double-click inside the box is the box's own", () => {
    // x3, on a text track drawn above x1, has the same place.
    const doc = sampleDoc();
    doc.tracks.push({ id: "t2", kind: "text", name: "Text 2", muted: false, hidden: false, locked: false, clips: [text("x3", 0, 60)] });
    const { store, st } = show({ over: { doc } });
    act(() => editTextInPlace(store, "x1"));
    fireEvent.pointerDown(textBox()!, { clientX: PICTURE[0], clientY: PICTURE[1], button: 0, pointerId: 1 });
    fireEvent.pointerUp(textBox()!, { clientX: PICTURE[0], clientY: PICTURE[1], button: 0, pointerId: 1 });
    expect(st().selection.clipIds).toEqual(["x1"]);
    // A double-click selects a word in it, and does not open x3.
    expect(fireEvent.doubleClick(textBox()!, { clientX: TEXT[0], clientY: TEXT[1] })).toBe(true);
    expect(st().textEditId).toBe("x1");
    // Its right-click is the browser's, as in any text field.
    expect(fireEvent.contextMenu(textBox()!, { clientX: TEXT[0], clientY: TEXT[1], button: 2 })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a small text gets a 13 px box", () => {
    show({ over: { doc: withTransform(sampleDoc(), "x1", { scale: 0.2 }) } });
    doubleClick(...TEXT);
    const { style } = textBox()!;
    // 6.4 px of type would be too small to read: 13 px, and the box widens in step from 97.2 px.
    expect(style.fontSize).toBe("13px");
    expect(style.width).toBe("197.44px");
    expect([style.left, style.top]).toEqual(["286px", "496px"]);
  });

  it("a stretched text's box is stretched too", () => {
    show({ over: { doc: withTransform(sampleDoc(), "x1", { stretch: 2, rotation: 30 }) } });
    doubleClick(...TEXT);
    expect(textBox()!.style.transform).toContain("scaleX(2)");
    expect(textBox()!.style.transform).toBe("translate(-50%, -50%) rotate(30deg) scaleX(2)");
  });

  it("the box follows the frame when the pane changes", () => {
    show();
    doubleClick(...TEXT);
    paneSize = { width: 972, height: 992 };
    rects = { pane: rect(200, 40, 972, 992), content: rect(200, 40, 972, 992), canvas: rect(416, 56, 540, 960) };
    act(() => {
      for (const callback of observed) callback([], {} as ResizeObserver);
    });
    expect(textBox()!.style.left).toBe("486px");
  });

  it("removing the clip while typing closes the box with a message", () => {
    const { store, st } = show();
    const notices = noticesOf(store);
    doubleClick(...TEXT);
    fireEvent.change(textBox()!, { target: { value: "hey" } });
    expect(st().gesture).not.toBeNull();
    act(() => void st().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x1" }])]));
    expect(notices).toEqual([MESSAGES.clipGone]);
    expect(st().textEditId).toBeNull();
    expect(textBox()).toBeNull();
    expect(st().queue).toEqual([]);
  });
});

// Teammates' marks. Polygons are counted by their data attributes, since outlines() above collects every one.
const GRACE = { userId: "u2", name: "Grace Hopper", trackId: null };
const LIN = { userId: "u3", name: "Lin Chen", trackId: null };
const MAE = { userId: "u4", name: "Mae Jemison", trackId: null };
const peerOutlines = () =>
  [...overlay().querySelectorAll("[data-peer-outline]:not([data-peer-halo])")].map((p) => p.getAttribute("points"));
const peerLabels = () => [...overlay().querySelectorAll<HTMLElement>("[data-peer-label]")];
const pillAt = (el: HTMLElement) => ({ top: parseFloat(el.style.top), left: el.style.left, right: el.style.right });
const colourOf = (presence: PresenceStore, userId: string) => presence.getState().peers.find((p) => p.userId === userId)!.colour;

describe("teammates' selections on the preview", () => {
  it("a teammate's clip under the playhead is outlined 3 px outside it, with their name", () => {
    const { presence } = show({ peers: [{ ...GRACE, clipIds: ["x1"] }] });
    // x1's own outline would be 270..302 × 476.8..515.2.
    expect(peerOutlines()).toEqual(["267,473.8 305,473.8 305,518.2 267,518.2"]);
    const look = peerLook(colourOf(presence, "u2"));
    const line = overlay().querySelector("[data-peer-outline]:not([data-peer-halo])")!;
    expect(line.getAttribute("data-peer-outline")).toBe("x1");
    expect(line.getAttribute("class")).toContain(look.stroke);
    expect(line.getAttribute("stroke-width")).toBe("1");
    expect(line.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(line.getAttribute("fill")).toBe("none");
    expect(line.getAttribute("pointer-events")).toBe("none");
    const halo = overlay().querySelector("[data-peer-halo]")!;
    expect(halo.getAttribute("points")).toBe(line.getAttribute("points"));
    expect(halo.getAttribute("stroke-width")).toBe("3");
    expect(halo.getAttribute("class")).toContain("stroke-ed-bg");
    expect(halo.getAttribute("class")).toContain("opacity-50");
    expect(halo.getAttribute("vector-effect")).toBe("non-scaling-stroke");

    const [pill] = peerLabels();
    expect(peerLabels()).toHaveLength(1);
    expect(pill.textContent).toBe("Grace");
    expect(pill.dataset.peerLabel).toBe("u2");
    expect(pill.getAttribute("aria-hidden")).toBe("true");
    expect(pill.className.split(" ")).toEqual(expect.arrayContaining([look.bg, "text-ed-bg", "pointer-events-none", "truncate", "max-w-40"]));
    // 16 px tall, 2 px above the outline's top-left corner.
    expect(pillAt(pill)).toEqual({ top: 455.8, left: "267px", right: "" });

    // A new list moves the marks without anything else changing.
    act(() => presence.getState().receive([{ ...GRACE, clipIds: ["c1"] }], 1));
    expect(peerOutlines()).toEqual(["13,13 559,13 559,979 13,979"]);
    act(() => presence.getState().forget());
    expect(peerOutlines()).toEqual([]);
    expect(peerLabels()).toEqual([]);
  });

  it("nothing is drawn for a clip off the playhead, on a hidden track, deleted, or being typed in place", () => {
    const peers = [{ ...GRACE, clipIds: ["x1"] }];
    show({ peers, at: 70 });
    expect(peerOutlines()).toEqual([]);
    expect(peerLabels()).toEqual([]);
    document.body.innerHTML = "";

    const hidden = sampleDoc();
    hidden.tracks[1].hidden = true;
    show({ peers, over: { doc: hidden } });
    expect(peerOutlines()).toEqual([]);
    expect(peerLabels()).toEqual([]);
    document.body.innerHTML = "";

    // A clip this tab does not have, then one deleted while shown.
    show({ peers: [{ ...GRACE, clipIds: ["zz"] }] });
    expect(peerOutlines()).toEqual([]);
    document.body.innerHTML = "";
    const deleted = show({ peers });
    expect(peerOutlines()).toHaveLength(1);
    act(() => void deleted.st().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x1" }])]));
    frame();
    expect(peerOutlines()).toEqual([]);
    expect(peerLabels()).toEqual([]);
    document.body.innerHTML = "";

    const typing = show({ peers });
    act(() => editTextInPlace(typing.store, "x1"));
    expect(textBox()).not.toBeNull();
    expect(peerOutlines()).toEqual([]);
    expect(peerLabels()).toEqual([]);
  });

  it("teammates' marks hide while playing", () => {
    const { st } = show({ peers: [{ ...GRACE, clipIds: ["x1"] }] });
    expect(peerOutlines()).toHaveLength(1);
    act(() => st().play());
    expect(peerOutlines()).toEqual([]);
    expect(peerLabels()).toEqual([]);
    act(() => st().pause());
    expect(peerOutlines()).toHaveLength(1);
    expect(peerLabels()).toHaveLength(1);
  });

  it("on a full-frame clip in Fill the pill flips inside the outline, 2 px inside the pane", () => {
    show({ peers: [{ ...GRACE, clipIds: ["c1"] }] });
    expect(peerOutlines()).toEqual(["13,13 559,13 559,979 13,979"]);
    const pill = pillAt(peerLabels()[0]);
    // Above the outline it would start at -5, off the pane; inside it starts 2 px below the outline's top.
    expect(pill.top).toBe(15);
    expect(pill.top).toBeGreaterThanOrEqual(2);
    expect(pill.left).toBe("13px");
  });

  it("on a clip larger than the view the pill stays inside the pane", () => {
    show({ peers: [{ ...GRACE, clipIds: ["c1"] }], over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) } });
    expect(peerOutlines()).toEqual(["-527,-947 1099,-947 1099,1939 -527,1939"]);
    expect(pillAt(peerLabels()[0])).toEqual({ top: 2, left: "2px", right: "" });
    document.body.innerHTML = "";

    // Near the pane's right edge the pill is placed by its right side, still inside.
    show({ peers: [{ ...GRACE, clipIds: ["x1"] }], over: { doc: withTransform(sampleDoc(), "x1", { x: 0.95 }) } });
    // x1's outline starts at overlay x 510, past 572 - 160, so the pill's right edge sits there: 62 px from the right.
    expect(pillAt(peerLabels()[0])).toEqual({ top: 455.8, left: "", right: "62px" });
    document.body.innerHTML = "";

    // A clip wholly past the pane's right edge keeps its pill 2 px inside it.
    show({ peers: [{ ...GRACE, clipIds: ["c1"] }], over: { doc: withTransform(sampleDoc(), "c1", { x: 1.6 }) } });
    expect(peerOutlines()).toEqual(["607,13 1153,13 1153,979 607,979"]);
    expect(pillAt(peerLabels()[0])).toEqual({ top: 15, left: "", right: "2px" });
  });

  it("two teammates on one clip are outlined 3 and 6 px out, each with their name", () => {
    const { presence } = show({ peers: [{ ...LIN, clipIds: ["x1"] }, { ...GRACE, clipIds: ["x1"] }] });
    // In name order: Grace, then Lin.
    expect(peerOutlines()).toEqual(["267,473.8 305,473.8 305,518.2 267,518.2", "264,470.8 308,470.8 308,521.2 264,521.2"]);
    const strokes = [...overlay().querySelectorAll("[data-peer-outline]:not([data-peer-halo])")].map((p) => p.getAttribute("class"));
    expect(strokes).toEqual([peerLook(colourOf(presence, "u2")).stroke, peerLook(colourOf(presence, "u3")).stroke]);
    expect(peerLabels().map((p) => p.textContent)).toEqual(["Grace", "Lin"]);
    // Lin's pill would overlap Grace's, so it goes 18 px below hers.
    const [grace, lin] = peerLabels().map(pillAt);
    expect(grace.top).toBe(455.8);
    expect(lin.top).toBe(473.8);
  });

  it("a third teammate on a clip gets a name but no outline, and the clip a +1 pill", () => {
    show({ peers: [{ ...GRACE, clipIds: ["x1"] }, { ...LIN, clipIds: ["x1"] }, { ...MAE, clipIds: ["x1"] }] });
    expect(peerOutlines()).toHaveLength(2);
    expect(peerLabels().map((p) => p.textContent)).toEqual(["Grace", "Lin", "Mae", "+1"]);
    const more = peerLabels()[3];
    expect(more.dataset.peerLabel).toBe("more");
    expect(more.className.split(" ")).toEqual(expect.arrayContaining(PEER_MORE.split(" ")));
    expect(more.className).not.toContain("text-ed-bg");
    // Beside the outer outline's top-left corner, to its left.
    expect(pillAt(more)).toMatchObject({ top: 452.8, left: "" });
  });

  it("a teammate who selected several clips gets one pill, on the top-most", () => {
    show({ peers: [{ ...GRACE, clipIds: ["c1", "x1"] }] });
    expect(peerOutlines()).toHaveLength(2);
    expect(peerLabels()).toHaveLength(1);
    expect(pillAt(peerLabels()[0])).toEqual({ top: 455.8, left: "267px", right: "" });
  });

  it("teammates' outlines come before your own, and their pills before your handles", () => {
    show({ selected: ["x1"], peers: [{ ...GRACE, clipIds: ["x1"] }] });
    const polygons = [...overlay().querySelectorAll("polygon")];
    expect(polygons.map((p) => (p.hasAttribute("data-peer-halo") ? "halo" : p.hasAttribute("data-peer-outline") ? "peer" : "mine"))).toEqual([
      "halo",
      "peer",
      "mine",
    ]);
    expect(polygons[2].getAttribute("points")).toBe("270,476.8 302,476.8 302,515.2 270,515.2");
    const pill = peerLabels()[0];
    expect(pill.compareDocumentPosition(handle("nw")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handleNames()).toHaveLength(9);
  });

  it("a press beside the frame does not grab a teammate's clip", () => {
    const { st } = show({ peers: [{ ...GRACE, clipIds: ["c1"] }], over: { doc: withTransform(sampleDoc(), "c1", { scale: 3 }) } });
    expect(peerOutlines()).toHaveLength(1);
    click(206, 300); // project (-20, 488)
    expect(st().selection.clipIds).toEqual([]);
  });
});
