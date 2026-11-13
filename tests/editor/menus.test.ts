import { expect, it } from "vitest";
import { ZOOM_MAX, ZOOM_MIN, clampZoom, zoomLimits } from "@/lib/editor/geometry";
import { editMenu, topMenuInput, trackMenu, viewMenu, type MenuEntry, type TopMenuInput } from "@/lib/editor/menus";
import { LIMITS } from "@/lib/limits";
import { docDuration } from "@/lib/timeline";
import { makeStore, sampleDoc } from "./fixtures";

// An editor with nothing selected, nothing copied, empty stacks and room to zoom both ways.
const BASE: TopMenuInput = {
  canEdit: true,
  deleted: false,
  busy: false,
  hasSelection: false,
  canUndo: false,
  canRedo: false,
  canPaste: false,
  snapping: true,
  showSafeZones: true,
  canZoomIn: true,
  canZoomOut: true,
};

const enabled = (entries: MenuEntry[]) => entries.filter((e) => !e.disabled).map((e) => e.id);
const byId = (entries: MenuEntry[], id: string) => entries.find((e) => e.id === id)!;

it("the Edit menu lists its items in order", () => {
  const entries = editMenu(BASE);
  expect(entries.map((e) => e.id)).toEqual([
    "undo", "redo", "cut", "copy", "paste", "duplicate", "split", "delete", "ripple-delete", "select-all", "clear-selection",
  ]);
  expect(entries.map((e) => e.label)).toEqual([
    "Undo", "Redo", "Cut", "Copy", "Paste", "Duplicate", "Split", "Delete", "Ripple delete", "Select all", "Deselect all",
  ]);
  expect(entries.filter((e) => e.separatorBefore).map((e) => e.id)).toEqual(["cut", "split", "select-all"]);
  for (const entry of entries) expect(entry.command).toBe(entry.id);
  // edit follows the shortcut table: copy, select all and deselect change nothing.
  expect(entries.filter((e) => e.edit).map((e) => e.id)).toEqual(["undo", "redo", "cut", "paste", "duplicate", "split", "delete", "ripple-delete"]);
});

it("a viewer may only copy and select", () => {
  const all = { ...BASE, hasSelection: true, canPaste: true, canUndo: true, canRedo: true };
  expect(enabled(editMenu({ ...all, canEdit: false }))).toEqual(["copy", "select-all", "clear-selection"]);
  // The same input for an editor enables everything.
  expect(enabled(editMenu(all))).toEqual(editMenu(all).map((e) => e.id));
});

it("nothing edits while a gesture is live or the project is deleted", () => {
  const all = { ...BASE, hasSelection: true, canPaste: true, canUndo: true, canRedo: true };
  for (const input of [{ ...all, busy: true }, { ...all, deleted: true }]) {
    const entries = editMenu(input);
    const edits = entries.filter((e) => e.edit);
    expect(edits).toHaveLength(8);
    for (const entry of edits) expect(entry.disabled, entry.id).toBe(true);
    expect(enabled(entries)).toEqual(["copy", "select-all", "clear-selection"]);
  }
});

it("undo and redo follow their stacks; cut and delete need a selection; paste needs something copied", () => {
  expect(enabled(editMenu(BASE))).toEqual(["split", "select-all", "clear-selection"]);
  expect(enabled(editMenu({ ...BASE, canUndo: true }))).toEqual(["undo", "split", "select-all", "clear-selection"]);
  expect(enabled(editMenu({ ...BASE, canRedo: true }))).toEqual(["redo", "split", "select-all", "clear-selection"]);
  expect(enabled(editMenu({ ...BASE, hasSelection: true }))).toEqual([
    "cut", "copy", "duplicate", "split", "delete", "ripple-delete", "select-all", "clear-selection",
  ]);
  expect(enabled(editMenu({ ...BASE, canPaste: true }))).toEqual(["paste", "split", "select-all", "clear-selection"]);
});

it("the View menu shows the two switches and the zoom limits", () => {
  const entries = viewMenu(BASE);
  expect(entries.map((e) => e.label)).toEqual([
    "Zoom in on the timeline", "Zoom out on the timeline", "Fit the timeline", "Snapping", "Safe zones", "Reset panel sizes", "Keyboard shortcuts",
  ]);
  expect(entries.map((e) => e.id)).toEqual(["zoom-in", "zoom-out", "zoom-fit", "toggle-snapping", "safe-zones", "reset-layout", "show-shortcuts"]);
  expect(entries.map((e) => e.command)).toEqual(["zoom-in", "zoom-out", "zoom-fit", "toggle-snapping", undefined, undefined, "show-shortcuts"]);
  expect(entries.filter((e) => e.separatorBefore).map((e) => e.id)).toEqual(["toggle-snapping", "reset-layout"]);
  expect(entries.filter((e) => e.checked !== undefined).map((e) => e.id)).toEqual(["toggle-snapping", "safe-zones"]);
  expect(byId(entries, "toggle-snapping").checked).toBe(true);
  expect(byId(entries, "safe-zones").checked).toBe(true);
  const off = viewMenu({ ...BASE, snapping: false, showSafeZones: false });
  expect(byId(off, "toggle-snapping").checked).toBe(false);
  expect(byId(off, "safe-zones").checked).toBe(false);
  expect(enabled(entries)).toEqual(entries.map((e) => e.id));
  expect(enabled(viewMenu({ ...BASE, canZoomIn: false }))).not.toContain("zoom-in");
  expect(byId(viewMenu({ ...BASE, canZoomIn: false }), "zoom-in").disabled).toBe(true);
  expect(byId(viewMenu({ ...BASE, canZoomOut: false }), "zoom-out").disabled).toBe(true);
  expect(byId(viewMenu({ ...BASE, canZoomOut: false }), "zoom-in").disabled).toBe(false);
  // Nothing in the View menu changes the project.
  expect(entries.filter((e) => e.edit)).toEqual([]);
  // A viewer and a deleted project still view.
  expect(enabled(viewMenu({ ...BASE, canEdit: false, deleted: true, busy: true }))).toEqual(entries.map((e) => e.id));
});

it("topMenuInput reads the store", () => {
  const store = makeStore();
  const { doc } = store.getState();
  expect(topMenuInput(store.getState(), false)).toEqual({
    canEdit: true,
    deleted: false,
    busy: false,
    hasSelection: false,
    canUndo: false,
    canRedo: false,
    canPaste: false,
    snapping: true,
    showSafeZones: true,
    canZoomIn: true,
    canZoomOut: true,
  });
  store.getState().select(["x1"]);
  store.getState().setGesture([{ op: "move_clip", clipId: "x1", start: 5 }]);
  store.getState().setZoom(zoomLimits(docDuration(doc), doc.fps).max);
  const input = topMenuInput(store.getState(), true);
  expect(input).toMatchObject({ hasSelection: true, busy: true, canZoomIn: false, canZoomOut: true, canPaste: true });

  store.getState().commitGesture("move");
  store.getState().setZoom(ZOOM_MIN);
  expect(topMenuInput(store.getState(), false)).toMatchObject({ busy: false, canUndo: true, canRedo: false, canZoomIn: true, canZoomOut: false });
  store.getState().undo();
  store.getState().setSnapping(false);
  store.getState().toggleSafeZones();
  store.getState().setStatus("deleted");
  expect(topMenuInput(store.getState(), false)).toMatchObject({ canUndo: false, canRedo: true, snapping: false, showSafeZones: false, deleted: true });
  expect(topMenuInput(makeStore({ canEdit: false }).getState(), false).canEdit).toBe(false);
});

it("zoomLimits gives the toolbar's limits", () => {
  expect(zoomLimits(120, 30)).toEqual({ min: 0.02, max: 40 });
  expect(zoomLimits(120, 30)).toEqual({ min: ZOOM_MIN, max: ZOOM_MAX });
  expect(zoomLimits(1_080_000, 30).max).toBeCloseTo(8_000_000 / 1_080_900, 6);
  expect(zoomLimits(1_080_000, 30).max).toBe(clampZoom(ZOOM_MAX, 1_080_000, 30));
  expect(zoomLimits(1_080_000, 30).min).toBe(0.02);
  const long = zoomLimits(400_000_000, 30);
  expect(long.min).toBe(long.max);
  expect(long.max).toBeLessThan(0.02);
});

it("trackMenu disables Duplicate on Captions and Remove on a locked track", () => {
  const store = makeStore();
  const t1 = trackMenu(store.getState(), "t1");
  expect(t1.map((e) => [e.id, e.label])).toEqual([
    ["rename", "Rename"], ["duplicate", "Duplicate"], ["up", "Move up"], ["down", "Move down"], ["remove", "Remove track"],
  ]);
  for (const entry of t1) expect([entry.edit, entry.command], entry.id).toEqual([true, undefined]);
  expect(t1.filter((e) => e.separatorBefore).map((e) => e.id)).toEqual(["remove"]);
  expect(t1.filter((e) => e.danger).map((e) => e.id)).toEqual(["remove"]);
  expect(enabled(t1)).toEqual(["rename", "duplicate", "up", "down", "remove"]);

  // Rows top to bottom: cap, t1, v1, then audio a1.
  expect(enabled(trackMenu(store.getState(), "cap"))).toEqual(["rename", "down", "remove"]);
  expect(enabled(trackMenu(store.getState(), "v1"))).toEqual(["rename", "duplicate", "up", "remove"]);
  expect(enabled(trackMenu(store.getState(), "a1"))).toEqual(["rename", "duplicate", "remove"]);

  store.getState().edit([{ op: "update_track", trackId: "t1", patch: { locked: true } }], "track change");
  const locked = byId(trackMenu(store.getState(), "t1"), "remove");
  expect(locked).toMatchObject({ label: "Remove track (unlock first)", danger: true, separatorBefore: true, disabled: true });
  expect(enabled(trackMenu(store.getState(), "t1"))).toEqual(["rename", "duplicate", "up", "down"]);

  const full = sampleDoc();
  for (let i = full.tracks.length; i < LIMITS.tracksPerProject; i++) {
    full.tracks.push({ id: `a${i}`, kind: "audio", name: `Audio ${i}`, muted: false, hidden: false, locked: false, clips: [] });
  }
  expect(byId(trackMenu(makeStore({ doc: full }).getState(), "t1"), "duplicate").disabled).toBe(true);

  const viewer = trackMenu(makeStore({ canEdit: false }).getState(), "t1");
  expect(viewer.map((e) => e.id)).toEqual(["rename", "duplicate", "up", "down", "remove"]);
  expect(enabled(viewer)).toEqual([]);
});
