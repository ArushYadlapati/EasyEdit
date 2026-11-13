import { expect, it } from "vitest";
import { ASSET_DRAG_TYPE, carriesFiles, createMediaDrop, dragKind, dropTrack } from "@/lib/editor/media-drop";
import { createLibraryStore } from "@/lib/media/library-store";
import type { MediaApi } from "@/lib/media/api";
import { assetView } from "../helpers/media-services";
import { makeStore, sampleDoc } from "./fixtures";

const never = <T,>() => new Promise<T>(() => {});
const api: MediaApi = {
  list: never, open: never, offset: never, complete: never, openFile: never, completeFile: never, previewFailed: never,
  update: never, remove: never, readToken: never,
};

function setup(canEdit = true) {
  const store = makeStore({ canEdit });
  const drop = createMediaDrop({ store, library: createLibraryStore({ api }), queue: { add: () => [] } });
  return { store, drop };
}

it("dragKind tells files, this page's library items and other tabs' apart", () => {
  expect(dragKind(["Files"], false)).toBe("files");
  expect(dragKind([ASSET_DRAG_TYPE], true)).toBe("asset");
  expect(dragKind([ASSET_DRAG_TYPE], false)).toBe("foreign-asset");
  expect(dragKind(["text/plain"], false)).toBe(null);
  expect(ASSET_DRAG_TYPE).toBe("application/x-easyedit-asset");
});

it("carriesFiles is true only for a drag with files", () => {
  expect(carriesFiles(["Files"])).toBe(true);
  expect(carriesFiles(["text/plain", "Files"])).toBe(true);
  expect(carriesFiles(["text/plain"])).toBe(false);
  expect(carriesFiles([])).toBe(false);
});

it("starts with nothing incoming, and sets the state only when it changes", () => {
  const { drop } = setup();
  expect(drop.state.getState()).toEqual({ incoming: null, asset: null });
  let changes = 0;
  drop.state.subscribe(() => changes++);
  drop.setIncoming("files");
  drop.setIncoming("files");
  expect(drop.state.getState().incoming).toBe("files");
  drop.setIncoming(null);
  drop.endAssetDrag(); // nothing to end
  expect(changes).toBe(2);
});

it("a library item's drag is kept until it ends", () => {
  const { drop } = setup();
  const asset = assetView();
  drop.startAssetDrag(asset);
  expect(drop.state.getState().asset).toBe(asset);
  drop.setIncoming("asset");
  drop.setIncoming(null);
  expect(drop.state.getState().asset).toBe(asset);
  drop.endAssetDrag();
  expect(drop.state.getState().asset).toBe(null);
});

it("once started, losing edit access or the project clears what is dragged in", () => {
  const { store, drop } = setup();
  const stop = drop.start();
  drop.startAssetDrag(assetView());
  drop.setIncoming("asset");
  store.getState().revokeEditing();
  expect(drop.state.getState()).toEqual({ incoming: null, asset: null });

  const other = setup();
  const stopOther = other.drop.start();
  other.drop.setIncoming("files");
  other.store.getState().setStatus("deleted");
  expect(other.drop.state.getState().incoming).toBe(null);
  stop();
  stopOther();
});

it("stopping ends the watch of the editor", () => {
  const { store, drop } = setup();
  const stop = drop.start();
  stop();
  drop.setIncoming("files");
  store.getState().revokeEditing();
  expect(drop.state.getState().incoming).toBe("files");
});

it("dropTrack keeps a clip on the dropped row only when the row takes it", () => {
  const doc = sampleDoc();
  expect(dropTrack(doc, "v1", "video")).toBe("v1");
  expect(dropTrack(doc, "t1", "video")).toBe(null);
  expect(dropTrack(doc, "v1", "audio")).toBe(null);
  expect(dropTrack(doc, null, "video")).toBe(null);
  expect(dropTrack(doc, "gone", "video")).toBe(null);
  expect(dropTrack(doc, "a1", "audio")).toBe("a1");
});
