// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { watchDrags } from "@/components/editor/drag-watch";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { Preview } from "@/components/editor/preview";
import { ASSET_DRAG_TYPE, createMediaDrop, type MediaDrop } from "@/lib/editor/media-drop";
import { DEFAULT_PREFS, createSettingsStore, type SettingsStore } from "@/lib/editor/settings";
import { findClip, type EditorStore } from "@/lib/editor/store";
import { drawFrame } from "@/lib/render/compositor";
import type { AssetView, UploadItem } from "@/lib/media/types";
import { makeStore, noticesOf } from "../editor/fixtures";
import { fakeCtx } from "../render/fake-ctx";
import { act, fireEvent, render, screen } from "../helpers/dom";
import { dragEvent } from "../helpers/drag-events";
import { assetView, pretendMediaServices } from "../helpers/media-services";

vi.mock("@/lib/render/compositor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/render/compositor")>();
  return { ...actual, drawFrame: vi.fn() };
});

// A pool that plays nothing.
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

// A 2-second video is 60 frames.
const VIDEO = assetView({ id: "a", durationMs: 2_000 });
const IMAGE = assetView({ id: "i", kind: "image", name: "logo", fileName: "logo.png", durationMs: null, fps: null, hasAudio: false });

let store: EditorStore;
let media: MediaServices;
let drop: MediaDrop;
let stopWatching: () => void;
let stopDrop: () => void;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-board") ? 572 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-board") ? 992 : 0;
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

  store = makeStore(); // nothing selected
  media = pretendMediaServices([VIDEO, IMAGE]);
  media.queue = { ...media.queue, add: vi.fn((files: File[]) => files.map((f) => f.name)) };
  drop = createMediaDrop({ store, library: media.library, queue: media.queue });
  stopDrop = drop.start();
  stopWatching = watchDrags(window, drop, () => true);
});

afterEach(() => {
  stopWatching();
  stopDrop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(drawFrame).mockClear();
});

function open(over: { store?: EditorStore; settings?: SettingsStore } = {}) {
  const editor = over.store ?? store;
  const view = render(
    <EditorProvider store={editor} settings={over.settings}>
      <MediaProvider services={media} drop={drop}>
        <Preview />
      </MediaProvider>
    </EditorProvider>,
  );
  const board = view.container.querySelector<HTMLElement>("[data-board]")!;
  const wrapper = board.parentElement!;
  const st = () => editor.getState();
  return { view, board, wrapper, st };
}

// dragEvent's MouseEvent carries a dataTransfer that its type does not name.
const transferOf = (event: MouseEvent) => (event as unknown as { dataTransfer: DataTransfer }).dataTransfer;

// A dragover as a browser sends it: for files it names them but carries none, and offers copy until a handler says
// otherwise.
function dragOver(target: Element, init: { types?: string[]; data?: Record<string, string> } = { types: ["Files"] }) {
  const event = dragEvent("dragover", init);
  transferOf(event).dropEffect = "copy";
  const taken = !fireEvent(target, event);
  return { taken, effect: transferOf(event).dropEffect };
}
const fileDrop = (target: Element, files: File[]) => !fireEvent(target, dragEvent("drop", { files }));
const itemDrop = (target: Element, id: string) => !fireEvent(target, dragEvent("drop", { data: { [ASSET_DRAG_TYPE]: id } }));
const file = (name: string) => new File(["x"], name);
// An upload row 40% through; the fake queue's keys are the file names. 2 s is 60 frames.
const upload = (fileName: string, over: Partial<UploadItem> = {}): UploadItem => ({
  key: fileName, fileName, sizeBytes: 100, durationMs: 2_000, stage: "uploading", sentBytes: 40, previewFraction: 0, assetId: null,
  message: null, canRetry: false, ...over,
});
// The upload of a file is in and its asset ready.
const landed = (fileName: string, asset: AssetView, over: Partial<UploadItem> = {}) =>
  act(async () => {
    media.library.getState().setUploads([...media.library.getState().uploads.filter((u) => u.key !== fileName), upload(fileName, { stage: "done", sentBytes: 100, assetId: asset.id, ...over })]);
    media.library.getState().put(asset);
  });
const flush = () => act(async () => {});
const clipsOf = (st: () => ReturnType<EditorStore["getState"]>, assetId: string) =>
  st().doc.tracks.flatMap((track) => track.clips.filter((c) => "assetId" in c && c.assetId === assetId).map((clip) => ({ track: track.id, clip })));
const dragging = (asset: AssetView) => act(() => drop.startAssetDrag(asset));

it("a file over the board shows the copy cursor and the drop look", () => {
  const { wrapper } = open();
  expect(wrapper.dataset.drop).toBe("idle");
  expect(dragOver(wrapper)).toEqual({ taken: true, effect: "copy" });
  expect(wrapper.dataset.drop).toBe("over");
  const pill = screen.getByText("Drop to add at the playhead");
  expect(pill.className).toBe("rounded-md bg-ed-panel px-3 py-1.5 text-[13px] text-ed-text");
  const look = pill.parentElement!;
  expect(look.parentElement).toBe(wrapper);
  expect(look.className.split(" ")).toEqual(
    expect.arrayContaining(["pointer-events-none", "absolute", "inset-0", "outline-2", "-outline-offset-2", "outline-ed-accent", "bg-ed-accent-weak/50"]),
  );

  expect(fileDrop(wrapper, [file("climb.mov")])).toBe(true);
  expect(wrapper.dataset.drop).toBe("idle");
  expect(screen.queryByText("Drop to add at the playhead")).toBeNull();
  // The next drag lights the board only once it is over it.
  act(() => drop.setIncoming("files"));
  expect(wrapper.dataset.drop).toBe("idle");
});

it("over also clears when nothing is coming in any more", () => {
  const { wrapper } = open();
  dragOver(wrapper);
  expect(wrapper.dataset.drop).toBe("over");
  act(() => drop.setIncoming(null));
  expect(wrapper.dataset.drop).toBe("idle");
  expect(screen.queryByText("Drop to add at the playhead")).toBeNull();
});

it("a file dropped on the board lands at the playhead as it was at the drop", async () => {
  const { wrapper, st } = open();
  act(() => st().seek(60));
  dragOver(wrapper);
  expect(fileDrop(wrapper, [file("climb.mov")])).toBe(true);
  expect(media.queue.add).toHaveBeenCalledTimes(1);
  act(() => st().seek(200));
  await landed("climb.mov", assetView({ id: "n1", name: "climb", fileName: "climb.mov", durationMs: 2_000 }));
  await flush();
  const [clip] = clipsOf(st, "n1");
  expect(clip.track).toBe("v1");
  expect(clip.clip).toMatchObject({ start: 60, duration: 60 });
  expect(st().selection.clipIds).not.toContain(clip.clip.id);
  expect(st().queue.map((e) => e.label)).toEqual(["add media"]);
});

it("several files go end to end from the playhead", async () => {
  const { wrapper, st } = open();
  act(() => st().seek(60));
  dragOver(wrapper);
  fileDrop(wrapper, [file("a.mov"), file("b.mov")]);
  await act(async () => media.library.getState().setUploads([upload("a.mov"), upload("b.mov", { durationMs: 1_000 })]));
  await landed("a.mov", assetView({ id: "na", name: "a", fileName: "a.mov", durationMs: 2_000 }));
  await landed("b.mov", assetView({ id: "nb", name: "b", fileName: "b.mov", durationMs: 1_000 }), { durationMs: 1_000 });
  await flush();
  expect(clipsOf(st, "na").map(({ track, clip }) => [track, clip.start, clip.duration])).toEqual([["v1", 60, 60]]);
  expect(clipsOf(st, "nb").map(({ track, clip }) => [track, clip.start, clip.duration])).toEqual([["v1", 120, 30]]);
  expect(st().selection.clipIds).toEqual([]);
});

it("files go on the selected track when it takes them", async () => {
  const { wrapper, st } = open();
  act(() => {
    st().edit([{ op: "add_track", track: { kind: "overlay", name: "Overlay 1" } }], "add track");
  });
  const overlay = st().doc.tracks.find((t) => t.kind === "overlay")!;
  act(() => {
    st().selectTrack(overlay.id);
    st().seek(60);
  });
  dragOver(wrapper);
  fileDrop(wrapper, [file("climb.mov")]);
  expect(drop.state.getState().groups.map(({ frame, trackId }) => ({ frame, trackId }))).toEqual([{ frame: 60, trackId: overlay.id }]);
  await landed("climb.mov", assetView({ id: "n1", name: "climb", fileName: "climb.mov", durationMs: 2_000 }));
  await flush();
  expect(clipsOf(st, "n1").map(({ track, clip }) => [track, clip.start])).toEqual([[overlay.id, 60]]);
});

it("a still image lasts the Settings length from the drop", async () => {
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, stillSeconds: 5 } });
  const { wrapper, st } = open({ settings });
  act(() => st().seek(60));
  dragOver(wrapper);
  fileDrop(wrapper, [file("logo.png")]);
  act(() => settings.getState().set({ stillSeconds: 2 }));
  await landed("logo.png", assetView({ id: "ni", kind: "image", name: "logo", fileName: "logo.png", durationMs: null, fps: null }), { durationMs: null });
  await flush();
  const [clip] = clipsOf(st, "ni");
  expect(clip.clip).toMatchObject({ start: 60, duration: 150 });
});

it("a library item dropped on the board lands at the playhead, selected", () => {
  const { wrapper, st } = open();
  act(() => st().seek(60));
  dragging(VIDEO);
  expect(dragOver(wrapper, { data: { [ASSET_DRAG_TYPE]: "" } })).toEqual({ taken: true, effect: "copy" });
  expect(wrapper.dataset.drop).toBe("over");
  expect(itemDrop(wrapper, "a")).toBe(true);
  const [clip] = st().selection.clipIds.map((id) => findClip(st().doc, id)!);
  expect(clip.track.id).toBe("v1");
  expect(clip.clip).toMatchObject({ type: "video", assetId: "a", start: 60, duration: 60 });
  expect(st().queue.map((e) => e.label)).toEqual(["add media"]);
  expect(wrapper.dataset.drop).toBe("idle");
  expect(media.queue.add).not.toHaveBeenCalled();
});

it("an item the library does not hold lands nothing", () => {
  const { wrapper, st } = open();
  const notices = noticesOf(store);
  dragging(VIDEO);
  for (const id of ["unknown", "constructor"]) {
    dragOver(wrapper, { data: { [ASSET_DRAG_TYPE]: "" } });
    expect(itemDrop(wrapper, id)).toBe(true);
  }
  expect(st().queue).toEqual([]);
  expect(notices).toEqual([]);
});

it("a library image dropped on the board lasts the Settings length", () => {
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, stillSeconds: 5 } });
  const { wrapper, st } = open({ settings });
  act(() => st().seek(60));
  dragging(IMAGE);
  dragOver(wrapper, { data: { [ASSET_DRAG_TYPE]: "" } });
  itemDrop(wrapper, "i");
  const [clip] = st().selection.clipIds.map((id) => findClip(st().doc, id)!);
  expect(clip.clip).toMatchObject({ type: "image", assetId: "i", start: 60, duration: 150 });
});

it("a viewer, and a project without uploads, get dropEffect none and upload nothing", () => {
  const viewer = open({ store: makeStore({ canEdit: false }) });
  expect(dragOver(viewer.wrapper)).toEqual({ taken: true, effect: "none" });
  expect(viewer.wrapper.dataset.drop).toBe("idle");
  expect(fileDrop(viewer.wrapper, [file("a.mov")])).toBe(true);
  // A library item too (one dragged in from an editor's tab of this page).
  dragging(VIDEO);
  expect(dragOver(viewer.wrapper, { data: { [ASSET_DRAG_TYPE]: "" } })).toEqual({ taken: true, effect: "none" });
  expect(viewer.wrapper.dataset.drop).toBe("idle");
  expect(itemDrop(viewer.wrapper, "a")).toBe(true);
  expect(viewer.st().queue).toEqual([]);
  act(() => drop.endAssetDrag());
  viewer.view.unmount();

  act(() => media.library.setState({ setUp: false }));
  const mine = open();
  expect(dragOver(mine.wrapper)).toEqual({ taken: true, effect: "none" });
  expect(mine.wrapper.dataset.drop).toBe("idle");
  expect(fileDrop(mine.wrapper, [file("a.mov")])).toBe(true);
  expect(media.queue.add).not.toHaveBeenCalled();
  expect(drop.state.getState().groups).toEqual([]);
});

it("a deleted project takes no file", () => {
  const { wrapper, st } = open();
  act(() => st().setStatus("deleted"));
  expect(dragOver(wrapper)).toEqual({ taken: true, effect: "none" });
  expect(wrapper.dataset.drop).toBe("idle");
  expect(fileDrop(wrapper, [file("a.mov")])).toBe(true);
  expect(media.queue.add).not.toHaveBeenCalled();
});

it("another tab's library item gets dropEffect none and lands nothing", () => {
  const { wrapper, st } = open();
  expect(dragOver(wrapper, { data: { [ASSET_DRAG_TYPE]: "" } })).toEqual({ taken: true, effect: "none" });
  expect(wrapper.dataset.drop).toBe("idle");
  expect(itemDrop(wrapper, "a")).toBe(true);
  expect(st().queue).toEqual([]);
});

it("a text drag over the board is left alone", () => {
  const { wrapper } = open();
  expect(fireEvent(wrapper, dragEvent("dragover", { data: { "text/plain": "hi" } }))).toBe(true);
  expect(wrapper.dataset.drop).toBe("idle");
});

it("a text drop on the board is left alone", () => {
  const { wrapper, st } = open();
  expect(fireEvent(wrapper, dragEvent("drop", { data: { "text/plain": "hi" } }))).toBe(true);
  expect(media.queue.add).not.toHaveBeenCalled();
  expect(st().queue).toEqual([]);
});

it("leaving the board resets the look; moving between its parts does not", () => {
  const { wrapper, board } = open();
  dragOver(wrapper);
  expect(wrapper.dataset.drop).toBe("over");
  fireEvent(board, dragEvent("dragleave", { relatedTarget: board.querySelector("[data-frame]") }));
  expect(wrapper.dataset.drop).toBe("over");
  // On to another part of the window, the control row say: the file is still over the window, and the board lets it go.
  const transport = document.body.appendChild(document.createElement("button"));
  fireEvent(transport, dragEvent("dragenter", { types: ["Files"], relatedTarget: wrapper }));
  fireEvent(wrapper, dragEvent("dragleave", { types: ["Files"], relatedTarget: transport }));
  expect(drop.state.getState().incoming).toBe("files");
  expect(wrapper.dataset.drop).toBe("idle");
  dragOver(wrapper);
  fireEvent(wrapper, dragEvent("dragleave", { relatedTarget: null }));
  expect(wrapper.dataset.drop).toBe("idle");
});

it("without a drop the board takes nothing", () => {
  const errors = vi.fn();
  window.addEventListener("error", errors);
  const view = render(
    <EditorProvider store={store}>
      <Preview />
    </EditorProvider>,
  );
  const wrapper = view.container.querySelector<HTMLElement>("[data-board]")!.parentElement!;
  expect(dragOver(wrapper).taken).toBe(false);
  expect(fireEvent(wrapper, dragEvent("drop", { files: [file("a.mov")] }))).toBe(true);
  expect(wrapper.dataset.drop).toBe("idle");
  window.removeEventListener("error", errors);
  expect(errors).not.toHaveBeenCalled();
});
