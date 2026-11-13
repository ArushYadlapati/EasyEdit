// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchDrags } from "@/components/editor/drag-watch";
import { ASSET_DRAG_TYPE, createMediaDrop, type MediaDrop } from "@/lib/editor/media-drop";
import type { EditorStore } from "@/lib/editor/store";
import { createLibraryStore } from "@/lib/media/library-store";
import type { MediaApi } from "@/lib/media/api";
import { makeStore } from "../editor/fixtures";
import { dragEvent } from "../helpers/drag-events";
import { assetView } from "../helpers/media-services";

const never = <T,>() => new Promise<T>(() => {});
const api: MediaApi = {
  list: never, open: never, offset: never, complete: never, openFile: never, completeFile: never, previewFailed: never,
  update: never, remove: never, readToken: never,
};

let store: EditorStore;
let drop: MediaDrop;
let stops: (() => void)[];
let a: HTMLElement;
let b: HTMLElement;

const FILES = { types: ["Files"] };
const incoming = () => drop.state.getState().incoming;
const allowed = () => store.getState().canEdit && store.getState().status !== "deleted";

function setup(canEdit = true, allow: () => boolean = allowed) {
  store = makeStore({ canEdit });
  drop = createMediaDrop({ store, library: createLibraryStore({ api }), queue: { add: () => [] } });
  stops.push(drop.start(), watchDrags(window, drop, allow));
}

beforeEach(() => {
  vi.useFakeTimers();
  stops = [];
  a = document.createElement("div");
  b = document.createElement("div");
  document.body.append(a, b);
});

afterEach(() => {
  for (const stop of stops) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("a file entering turns it on, and leaving the last element turns it off", () => {
  setup();
  expect(incoming()).toBe(null);
  a.dispatchEvent(dragEvent("dragenter", FILES));
  b.dispatchEvent(dragEvent("dragenter", FILES));
  a.dispatchEvent(dragEvent("dragleave", FILES));
  expect(incoming()).toBe("files");
  b.dispatchEvent(dragEvent("dragleave", FILES));
  expect(incoming()).toBe(null);
});

it("an element removed after another was entered does not keep it on either", () => {
  setup();
  a.dispatchEvent(dragEvent("dragenter", FILES));
  b.dispatchEvent(dragEvent("dragenter", FILES));
  a.remove();
  b.dispatchEvent(dragEvent("dragleave", FILES));
  expect(incoming()).toBe(null);
});

it("an element removed under the pointer does not keep it on", () => {
  setup();
  a.dispatchEvent(dragEvent("dragenter", FILES));
  a.remove(); // a browser sends no dragleave for a removed element
  b.dispatchEvent(dragEvent("dragenter", FILES));
  b.dispatchEvent(dragEvent("dragleave", FILES));
  expect(incoming()).toBe(null);
});

it("a drop turns it off and keeps the dragged library item until dragend", () => {
  setup();
  const asset = assetView();
  a.dispatchEvent(dragEvent("dragstart", { types: [ASSET_DRAG_TYPE] }));
  drop.startAssetDrag(asset);
  b.dispatchEvent(dragEvent("dragenter", { types: [ASSET_DRAG_TYPE] }));
  expect(incoming()).toBe("asset");
  b.dispatchEvent(dragEvent("drop", { types: [ASSET_DRAG_TYPE] }));
  expect(incoming()).toBe(null);
  expect(drop.state.getState().asset).toBe(asset);
  a.dispatchEvent(dragEvent("dragend", { types: [ASSET_DRAG_TYPE] }));
  expect(drop.state.getState()).toEqual({ incoming: null, asset: null, groups: [] });

  // A file drop turns it off the same way.
  a.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe("files");
  a.dispatchEvent(dragEvent("drop", { files: [new File(["x"], "a.mov")] }));
  expect(incoming()).toBe(null);
});

it("a second with no drag events turns it off", () => {
  setup();
  a.dispatchEvent(dragEvent("dragenter", FILES));
  vi.advanceTimersByTime(600);
  a.dispatchEvent(dragEvent("dragover", FILES)); // re-arms the wait
  vi.advanceTimersByTime(999);
  expect(incoming()).toBe("files");
  vi.advanceTimersByTime(1);
  expect(incoming()).toBe(null);
});

it("a dragover after the idle clear turns it back on", () => {
  setup();
  a.dispatchEvent(dragEvent("dragenter", FILES));
  b.dispatchEvent(dragEvent("dragenter", FILES));
  vi.advanceTimersByTime(1000);
  expect(incoming()).toBe(null);
  a.dispatchEvent(dragEvent("dragover", FILES));
  expect(incoming()).toBe("files");
  // The set was emptied by the idle clear, and this dragover's target is in it again.
  b.dispatchEvent(dragEvent("dragenter", FILES));
  b.dispatchEvent(dragEvent("dragleave", FILES));
  expect(incoming()).toBe("files");
  a.dispatchEvent(dragEvent("dragleave", FILES));
  expect(incoming()).toBe(null);
});

it("a drag that began in the page is not a file from the computer", () => {
  setup();
  a.dispatchEvent(dragEvent("dragstart", FILES)); // an image of the page: some browsers list Files
  b.dispatchEvent(dragEvent("dragenter", FILES));
  b.dispatchEvent(dragEvent("dragover", FILES));
  expect(incoming()).toBe(null);
  a.dispatchEvent(dragEvent("dragend", FILES));
  b.dispatchEvent(dragEvent("dragenter", FILES)); // the next drag comes from the computer
  expect(incoming()).toBe("files");
  b.dispatchEvent(dragEvent("drop", FILES));

  // A drop ends the page's drag too.
  a.dispatchEvent(dragEvent("dragstart", FILES));
  b.dispatchEvent(dragEvent("drop", FILES));
  b.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe("files");
  vi.advanceTimersByTime(1000);

  // So does the idle clear, which any drag event re-arms.
  a.dispatchEvent(dragEvent("dragstart", FILES));
  b.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe(null);
  vi.advanceTimersByTime(1000);
  b.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe("files");
});

it("a viewer never gets it", () => {
  setup(false);
  let changes = 0;
  drop.state.subscribe(() => changes++);
  a.dispatchEvent(dragEvent("dragenter", FILES));
  a.dispatchEvent(dragEvent("dragover", FILES));
  a.dispatchEvent(dragEvent("drop", FILES));
  expect(incoming()).toBe(null);
  expect(changes).toBe(0);
});

it("losing edit access mid-drag turns it off", () => {
  setup();
  a.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe("files");
  store.getState().revokeEditing();
  expect(incoming()).toBe(null);
  a.dispatchEvent(dragEvent("dragover", FILES));
  b.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe(null);
});

it("a deleted project never gets it", () => {
  setup();
  store.getState().setStatus("deleted");
  a.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe(null);
});

it("a file over the window while a dialog is open changes nothing", () => {
  setup();
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  a.dispatchEvent(dragEvent("dragenter", FILES));
  a.dispatchEvent(dragEvent("dragover", FILES));
  expect(incoming()).toBe(null);
  dialog.remove();
  a.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe("files");

  // A closed dialog does not count.
  a.dispatchEvent(dragEvent("drop", FILES));
  document.body.append(document.createElement("dialog"));
  a.dispatchEvent(dragEvent("dragenter", FILES));
  expect(incoming()).toBe("files");
});

it("plain text is ignored", () => {
  setup();
  const text = { types: ["text/plain"] };
  a.dispatchEvent(dragEvent("dragenter", text));
  a.dispatchEvent(dragEvent("dragover", text));
  expect(incoming()).toBe(null);
  // Nor does a library item of another tab count.
  a.dispatchEvent(dragEvent("dragenter", { types: [ASSET_DRAG_TYPE] }));
  a.dispatchEvent(dragEvent("dragover", { types: [ASSET_DRAG_TYPE] }));
  expect(incoming()).toBe(null);
});

it("a library item dragged from this page is an asset", () => {
  setup();
  const asset = assetView();
  a.dispatchEvent(dragEvent("dragstart", { types: [ASSET_DRAG_TYPE] }));
  drop.startAssetDrag(asset);
  a.dispatchEvent(dragEvent("dragenter", { types: [ASSET_DRAG_TYPE] }));
  expect(drop.state.getState()).toEqual({ incoming: "asset", asset, groups: [] });
  // The idle clear keeps the item: the drag has not ended.
  vi.advanceTimersByTime(1000);
  expect(drop.state.getState()).toEqual({ incoming: null, asset, groups: [] });
});

it("sets the state only when it changes", () => {
  setup();
  let changes = 0;
  drop.state.subscribe(() => changes++);
  a.dispatchEvent(dragEvent("dragenter", FILES));
  b.dispatchEvent(dragEvent("dragenter", FILES));
  for (let i = 0; i < 3; i++) b.dispatchEvent(dragEvent("dragover", FILES));
  a.dispatchEvent(dragEvent("dragleave", FILES));
  expect(changes).toBe(1);
});

it("stopping removes every listener", () => {
  const added = vi.spyOn(window, "addEventListener");
  const removed = vi.spyOn(window, "removeEventListener");
  store = makeStore();
  drop = createMediaDrop({ store, library: createLibraryStore({ api }), queue: { add: () => [] } });
  const stop = watchDrags(window, drop, () => true);
  const types = ["dragstart", "dragenter", "dragover", "dragleave", "drop", "dragend"];
  expect(added.mock.calls.map(([type, , options]) => [type, options])).toEqual(types.map((type) => [type, true]));
  a.dispatchEvent(dragEvent("dragenter", FILES));
  stop();
  expect(removed.mock.calls.map(([type, , options]) => [type, options])).toEqual(types.map((type) => [type, true]));
  for (const [i, call] of removed.mock.calls.entries()) expect(call[1]).toBe(added.mock.calls[i][1]);
  // Nothing more is heard, and the idle wait is gone with them.
  drop.setIncoming("files");
  a.dispatchEvent(dragEvent("dragleave", FILES));
  vi.advanceTimersByTime(5000);
  expect(incoming()).toBe("files");
});
