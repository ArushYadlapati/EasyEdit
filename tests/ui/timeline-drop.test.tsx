// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchDrags } from "@/components/editor/drag-watch";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { CLIP_TOP } from "@/components/editor/timeline/clip-view";
import { ROW_HEIGHT, RULER_HEIGHT } from "@/lib/editor/geometry";
import { ASSET_DRAG_TYPE, createMediaDrop, type MediaDrop } from "@/lib/editor/media-drop";
import { MESSAGES } from "@/lib/editor/messages";
import { DEFAULT_PREFS, createSettingsStore, type SettingsStore } from "@/lib/editor/settings";
import { findClip, type EditorStore } from "@/lib/editor/store";
import type { AssetView } from "@/lib/media/types";
import { makeStore, noticesOf, text } from "../editor/fixtures";
import { act, fireEvent } from "../helpers/dom";
import { dragEvent } from "../helpers/drag-events";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { LANE_LEFT, ZOOM, installTimelineStubs, renderTimeline, x, y } from "../helpers/timeline-harness";

installTimelineStubs();

// A 2-second video is 60 frames.
const VIDEO = assetView({ id: "a", durationMs: 2_000 });
const AUDIO = assetView({ id: "m", kind: "audio", name: "theme", fileName: "theme.mp3", durationMs: 2_000, width: null, height: null, fps: null, posterFileId: null });
const IMAGE = assetView({ id: "i", kind: "image", name: "logo", fileName: "logo.png", durationMs: null, fps: null, hasAudio: false });
const REMOVED = assetView({ id: "r", name: "gone", durationMs: 2_000, removed: true });
const SHORT = assetView({ id: "s", name: "short", durationMs: 1_500 }); // 45 frames

let store: EditorStore;
let media: MediaServices;
let drop: MediaDrop;
let stopWatching: () => void;

beforeEach(() => {
  store = makeStore();
  media = pretendMediaServices([VIDEO, AUDIO, IMAGE, REMOVED, SHORT]);
  media.queue = { ...media.queue, add: vi.fn((files: File[]) => files.map((f) => f.name)) };
  drop = createMediaDrop({ store, library: media.library, queue: media.queue });
  stopWatching = watchDrags(window, drop, () => true);
});

afterEach(() => stopWatching());

function open(over: { store?: EditorStore; settings?: SettingsStore } = {}) {
  const shown = renderTimeline(over.store ?? store, {
    settings: over.settings,
    wrap: (timeline: ReactNode) => (
      <MediaProvider services={media} drop={drop}>
        {timeline}
      </MediaProvider>
    ),
  });
  const wrapper = shown.view.container.querySelector<HTMLElement>("[data-drop]")!;
  const ghost = () => shown.view.container.querySelector<HTMLElement>("[data-drop-ghost]");
  const guide = () => shown.view.container.querySelector<HTMLElement>("[data-snap-guide]");
  // The lane of a display row: cap, t1, v1, a1.
  const lane = (row: number) => shown.lanes[row];
  const dragOver = (target: Element, clientX: number, clientY: number, data: Record<string, string> = { [ASSET_DRAG_TYPE]: "a" }) => {
    const event = dragEvent("dragover", { clientX, clientY, data });
    return { taken: !fireEvent(target, event), effect: transferOf(event).dropEffect };
  };
  const dropOn = (target: Element, clientX: number, clientY: number, id: string) =>
    !fireEvent(target, dragEvent("drop", { clientX, clientY, data: { [ASSET_DRAG_TYPE]: id } }));
  const added = () => {
    const { doc, selection } = shown.st();
    return selection.clipIds.map((clipId) => findClip(doc, clipId)!);
  };
  return { ...shown, wrapper, ghost, guide, lane, dragOver, dropOn, added };
}

// dragEvent's MouseEvent carries a dataTransfer that its type does not name.
const transferOf = (event: MouseEvent) => (event as unknown as { dataTransfer: DataTransfer }).dataTransfer;

const dragging = (asset: AssetView) => act(() => drop.startAssetDrag(asset));

it("while dragging, a box of the item's length shows where it would land", () => {
  const { wrapper, ghost, lane, dragOver } = open();
  dragging(VIDEO);
  expect(wrapper.dataset.drop).toBe("idle");
  const over = dragOver(lane(2), x(90), y(2));
  expect(over).toEqual({ taken: true, effect: "copy" });
  const box = ghost()!;
  expect(parseFloat(box.style.left)).toBe(LANE_LEFT + 90 * ZOOM);
  expect(parseFloat(box.style.width)).toBe(60 * ZOOM);
  expect(parseFloat(box.style.top)).toBe(2 * ROW_HEIGHT + CLIP_TOP);
  expect(box.className).toContain("pointer-events-none");
  expect(box.className).toContain("border border-dashed border-ed-accent bg-ed-accent-weak");
  expect(wrapper.dataset.drop).toBe("over");
  // The stronger tint while it is over the timeline.
  const glow = wrapper.lastElementChild!;
  expect(glow.classList.contains("bg-ed-accent-weak")).toBe(true);
  expect(glow.classList.contains("bg-ed-accent-weak/50")).toBe(false);
  expect(glow.classList.contains("opacity-100")).toBe(true);

  // The drag going on elsewhere: when nothing is coming in any more, the box goes.
  act(() => drop.setIncoming(null));
  expect(ghost()).toBeNull();
  expect(wrapper.dataset.drop).toBe("idle");
  expect(glow.classList.contains("bg-ed-accent-weak/50")).toBe(true);
});

it("a library item dropped on the timeline lands at the drop frame on that row and is selected", () => {
  const { st, ghost, wrapper, lane, dragOver, dropOn, added } = open();
  dragging(VIDEO);
  dragOver(lane(2), x(90), y(2));
  expect(dropOn(lane(2), x(90), y(2), "a")).toBe(true);
  const [clip] = added();
  expect(clip.track.id).toBe("v1");
  expect(clip.clip).toMatchObject({ type: "video", assetId: "a", start: 90, duration: 60 });
  expect(st().queue.map((e) => e.label)).toEqual(["add media"]);
  expect(ghost()).toBeNull();
  expect(wrapper.dataset.drop).not.toBe("over");
});

it("an audio item dropped on a video row goes to an audio track", () => {
  const { lane, dragOver, dropOn, added, ghost } = open();
  dragging(AUDIO);
  dragOver(lane(2), x(90), y(2), { [ASSET_DRAG_TYPE]: "m" });
  expect(parseFloat(ghost()!.style.top)).toBe(3 * ROW_HEIGHT + CLIP_TOP); // shown where it really goes
  dropOn(lane(2), x(90), y(2), "m");
  const [clip] = added();
  expect(clip.track.id).toBe("a1");
  expect(clip.clip).toMatchObject({ type: "audio", start: 90 });
});

it("a drop near a clip's end snaps to it, with a guide", () => {
  const { lane, dragOver, dropOn, added, guide, ghost } = open();
  dragging(VIDEO);
  dragOver(lane(2), x(62), y(2));
  expect(parseFloat(guide()!.style.left)).toBe(LANE_LEFT + 60 * ZOOM);
  expect(parseFloat(ghost()!.style.left)).toBe(LANE_LEFT + 60 * ZOOM);
  dropOn(lane(2), x(62), y(2), "a");
  expect(added()[0].clip.start).toBe(60);
  expect(guide()).toBeNull();
});

it("an item snaps by its end too", () => {
  // [73, 118]: the start is far from every target, the end 2 frames from x2's end.
  const { lane, dragOver, dropOn, added, guide, ghost } = open();
  dragging(SHORT);
  dragOver(lane(2), x(73), y(2), { [ASSET_DRAG_TYPE]: "s" });
  expect(parseFloat(guide()!.style.left)).toBe(LANE_LEFT + 120 * ZOOM);
  expect(parseFloat(ghost()!.style.left)).toBe(LANE_LEFT + 75 * ZOOM);
  dropOn(lane(2), x(73), y(2), "s");
  expect(added()[0].clip).toMatchObject({ start: 75, duration: 45 });
});

it("the box is placed from the snapped start", () => {
  // Below the rows there is no wished track. At 58 the item would not fit on v1 and would make a new track, which has
  // no row to show; snapped to c2's end at 60 it fits on v1.
  const { scroller, dragOver, dropOn, added, ghost } = open();
  dragging(VIDEO);
  dragOver(scroller, x(58), y(5));
  expect(parseFloat(ghost()!.style.top)).toBe(2 * ROW_HEIGHT + CLIP_TOP);
  expect(parseFloat(ghost()!.style.left)).toBe(LANE_LEFT + 60 * ZOOM);
  dropOn(scroller, x(58), y(5), "a");
  expect(added()[0]).toMatchObject({ track: { id: "v1" }, clip: { start: 60 } });
});

it("a snap that would start the item before frame 0 is not taken", () => {
  // At half a pixel per frame a snap reaches 16 frames and whole seconds are no targets. [5, 65]: the end is 15 frames
  // from x1's end at 50, and the start is far from every target, so the end would pull the start to -10.
  const doc = makeStore().getState().doc;
  for (const track of doc.tracks) track.clips = [];
  doc.tracks.find((t) => t.id === "t1")!.clips = [text("x1", 40, 10)];
  const editor = makeStore({ doc });
  editor.getState().seek(1000);
  const { st, lane, dragOver, dropOn, added, ghost, guide } = open({ store: editor });
  act(() => st().setZoom(0.5));
  dragging(VIDEO);
  dragOver(lane(2), LANE_LEFT + 5 * 0.5, y(2));
  expect(parseFloat(ghost()!.style.left)).toBe(LANE_LEFT + 5 * 0.5);
  expect(guide()).toBeNull();
  dropOn(lane(2), LANE_LEFT + 5 * 0.5, y(2), "a");
  expect(added()[0]).toMatchObject({ track: { id: "v1" }, clip: { start: 5 } });
});

it("with snapping off, a drop lands where it is let go, with no guide", () => {
  const { st, lane, dragOver, dropOn, added, guide } = open();
  act(() => st().setSnapping(false));
  dragging(VIDEO);
  dragOver(lane(2), x(62), y(2));
  expect(guide()).toBeNull();
  dropOn(lane(2), x(62), y(2), "a");
  expect(added()[0].clip.start).toBe(62);
});

it("a drop that would not fit makes a new track, as a click does", () => {
  const { st, lane, dragOver, dropOn, added, ghost } = open();
  dragging(VIDEO);
  dragOver(lane(2), x(10), y(2));
  expect(parseFloat(ghost()!.style.top)).toBe(2 * ROW_HEIGHT + CLIP_TOP); // on the row it is over
  dropOn(lane(2), x(10), y(2), "a");
  const [clip] = added();
  expect(clip.track.name).toBe("Video 2");
  expect(clip.clip.start).toBe(10);
  expect(st().doc.tracks.find((t) => t.id === "v1")!.clips.map((c) => c.id)).toEqual(["c1", "c2"]);
});

it("a library image lasts the Settings length", () => {
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, stillSeconds: 5 } });
  const { lane, dragOver, dropOn, added, ghost } = open({ settings });
  dragging(IMAGE);
  dragOver(lane(2), x(90), y(2), { [ASSET_DRAG_TYPE]: "i" });
  expect(parseFloat(ghost()!.style.width)).toBe(150 * ZOOM);
  dropOn(lane(2), x(90), y(2), "i");
  expect(added()[0].clip).toMatchObject({ type: "image", start: 90, duration: 150 });
});

it("an image snaps by the end the Settings length gives it", () => {
  // 4.9 s is 147 frames: [95, 242] snaps its end to 240, where 3 s would end at 185, out of reach.
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, stillSeconds: 4.9 } });
  const { lane, dragOver, dropOn, added, ghost } = open({ settings });
  dragging(IMAGE);
  dragOver(lane(2), x(95), y(2), { [ASSET_DRAG_TYPE]: "i" });
  expect(parseFloat(ghost()!.style.left)).toBe(LANE_LEFT + 93 * ZOOM);
  dropOn(lane(2), x(95), y(2), "i");
  expect(added()[0].clip).toMatchObject({ start: 93, duration: 147 });
});

it("an item dropped on a row that does not take it has no wished track", () => {
  // Rows top to bottom: o1, cap, t1, v1, a1. Wished onto a1, an image would go to the first row that takes it (o1);
  // with no wish it goes to its own kind's row, v1.
  const doc = makeStore().getState().doc;
  doc.tracks.push({ id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [] });
  const { lane, dragOver, dropOn, added, ghost } = open({ store: makeStore({ doc }) });
  dragging(IMAGE);
  dragOver(lane(4), x(200), y(4), { [ASSET_DRAG_TYPE]: "i" });
  expect(parseFloat(ghost()!.style.top)).toBe(3 * ROW_HEIGHT + CLIP_TOP);
  dropOn(lane(4), x(200), y(4), "i");
  expect(added()[0].track.id).toBe("v1");
});

it("a viewer gets dropEffect none and nothing lands", () => {
  const viewer = makeStore({ canEdit: false });
  const { st, wrapper, lane, dragOver, dropOn, ghost } = open({ store: viewer });
  dragging(VIDEO);
  expect(dragOver(lane(2), x(90), y(2))).toEqual({ taken: true, effect: "none" });
  expect(ghost()).toBeNull();
  expect(wrapper.dataset.drop).not.toBe("over");
  dropOn(lane(2), x(90), y(2), "a");
  expect(st().doc.tracks.find((t) => t.id === "v1")!.clips.map((c) => c.id)).toEqual(["c1", "c2"]);
  expect(st().queue).toEqual([]);
});

it("a removed asset says the file isn't ready", () => {
  const { st, lane, dragOver, dropOn } = open();
  const notices = noticesOf(store);
  dragging(REMOVED);
  dragOver(lane(2), x(90), y(2), { [ASSET_DRAG_TYPE]: "r" });
  dropOn(lane(2), x(90), y(2), "r");
  expect(notices).toEqual([MESSAGES.mediaNotReady]);
  expect(st().queue).toEqual([]);

  // An id the library does not hold, even one every object has: nothing, and nothing said.
  const errors = vi.fn();
  window.addEventListener("error", errors);
  dropOn(lane(2), x(90), y(2), "unknown");
  dropOn(lane(2), x(90), y(2), "constructor");
  window.removeEventListener("error", errors);
  expect(errors).not.toHaveBeenCalled();
  expect(notices).toEqual([MESSAGES.mediaNotReady]);
  expect(st().queue).toEqual([]);
});

it("without the window's watcher the timeline still lights up while the item is over it, and a drop clears it", () => {
  stopWatching();
  const { wrapper, lane, dragOver, dropOn, ghost } = open();
  dragging(VIDEO);
  dragOver(lane(2), x(90), y(2));
  expect(wrapper.dataset.drop).toBe("over");
  expect(wrapper.lastElementChild!.classList.contains("opacity-100")).toBe(true);
  dropOn(lane(2), x(90), y(2), "a");
  expect(ghost()).toBeNull();
  expect(wrapper.dataset.drop).toBe("idle");
});

it("a dragover near the lane's right edge scrolls the lanes", () => {
  const { scroller, lane, dragOver } = open();
  dragging(VIDEO);
  dragOver(lane(2), 1390, y(2));
  expect(scroller.scrollLeft).toBe(12);
  dragOver(lane(2), 1390, y(2));
  expect(scroller.scrollLeft).toBe(24);
  dragOver(lane(2), x(90), y(2)); // the middle: no scroll
  expect(scroller.scrollLeft).toBe(24);
});

it("another tab's library item gets dropEffect none and shows nothing", () => {
  const { wrapper, lane, dragOver, ghost } = open();
  // No drag of this page's library began, so the browser is told no drop is taken and sends none.
  expect(dragOver(lane(2), x(90), y(2))).toEqual({ taken: true, effect: "none" });
  expect(ghost()).toBeNull();
  expect(wrapper.dataset.drop).toBe("idle");
});

it("files and other drags are left to the window", () => {
  const { lane, ghost } = open();
  const files = dragEvent("dragover", { clientX: x(90), clientY: y(2), files: [new File(["x"], "climb.mov")] });
  expect(fireEvent(lane(2), files)).toBe(true);
  expect(ghost()).toBeNull();
  expect(fireEvent(lane(2), dragEvent("drop", { clientX: x(90), clientY: y(2), files: [new File(["x"], "climb.mov")] }))).toBe(true);
  expect(fireEvent(lane(2), dragEvent("dragover", { clientX: x(90), clientY: y(2), data: { "text/plain": "hi" } }))).toBe(true);
});

it("leaving the timeline clears the box; moving between its parts does not", () => {
  const { wrapper, lane, dragOver, ghost } = open();
  dragging(VIDEO);
  // Something outside the timeline was entered first, so the drag is still over the page after the leave.
  fireEvent(document.body, dragEvent("dragenter", { data: { [ASSET_DRAG_TYPE]: "a" } }));
  dragOver(lane(2), x(90), y(2));
  fireEvent(lane(2), dragEvent("dragleave", { relatedTarget: lane(1), data: { [ASSET_DRAG_TYPE]: "a" } }));
  expect(wrapper.dataset.drop).toBe("over");
  expect(ghost()).not.toBeNull();
  fireEvent(lane(2), dragEvent("dragleave", { relatedTarget: document.body, data: { [ASSET_DRAG_TYPE]: "a" } }));
  expect(ghost()).toBeNull();
  expect(wrapper.dataset.drop).toBe("armed");
});

it("a drop below the last row has no wished track: placement chooses", () => {
  // Rows top to bottom: cap, t1, v2, v1, a1; both video rows are free at 200.
  const doc = makeStore().getState().doc;
  const v2 = { id: "v2", kind: "video" as const, name: "Video 2", muted: false, hidden: false, locked: false, clips: [] };
  doc.tracks = [doc.tracks[0], v2, ...doc.tracks.slice(1)];
  const { lane, dragOver, dropOn, added, ghost, scroller } = open({ store: makeStore({ doc }) });
  dragging(VIDEO);
  dropOn(lane(3), x(200), y(3), "a"); // on v1's row
  expect(added()[0].track.id).toBe("v1");
  const below = y(5);
  dragOver(scroller, x(300), below);
  expect(parseFloat(ghost()!.style.top)).toBe(2 * ROW_HEIGHT + CLIP_TOP); // where placement puts it: v2
  dropOn(scroller, x(300), below, "a");
  expect(added()[0].track.id).toBe("v2");
  // Over the ruler there is no wished track either.
  dropOn(scroller, x(400), RULER_HEIGHT / 2, "a");
  expect(added()[0].track.id).toBe("v2");
});
