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
import type { AssetView, UploadItem } from "@/lib/media/types";
import { DEFAULT_TRANSFORM, type Clip } from "@/lib/timeline";
import { makeStore, noticesOf, text, video } from "../editor/fixtures";
import { act, fireEvent, within } from "../helpers/dom";
import { dragEvent } from "../helpers/drag-events";
import { rect } from "../helpers/layout";
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
let stopDrop: () => void;

beforeEach(() => {
  store = makeStore();
  media = pretendMediaServices([VIDEO, AUDIO, IMAGE, REMOVED, SHORT]);
  media.queue = { ...media.queue, add: vi.fn((files: File[]) => files.map((f) => f.name)) };
  drop = createMediaDrop({ store, library: media.library, queue: media.queue });
  stopDrop = drop.start();
  stopWatching = watchDrags(window, drop, () => true);
});

afterEach(() => {
  stopWatching();
  stopDrop();
});

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
  const line = () => shown.view.container.querySelector<HTMLElement>("[data-drop-line]");
  const placeholders = () => [...shown.view.container.querySelectorAll<HTMLElement>("[data-upload-placeholder]")];
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
  return { ...shown, wrapper, ghost, guide, line, placeholders, lane, dragOver, dropOn, added };
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

it("other drags are left to the window", () => {
  const { lane, ghost, line } = open();
  expect(fireEvent(lane(2), dragEvent("dragover", { clientX: x(90), clientY: y(2), data: { "text/plain": "hi" } }))).toBe(true);
  expect(ghost()).toBeNull();
  expect(line()).toBeNull();
  expect(fireEvent(lane(2), dragEvent("drop", { clientX: x(90), clientY: y(2), data: { "text/plain": "hi" } }))).toBe(true);
  expect(media.queue.add).not.toHaveBeenCalled();
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

it("with the rows scrolled down, a drop over the ruler has no wished track", () => {
  // Rows top to bottom: cap, t1, v2, v1, a1; both video rows are free at 400, and placement chooses v2.
  const doc = makeStore().getState().doc;
  const v2 = { id: "v2", kind: "video" as const, name: "Video 2", muted: false, hidden: false, locked: false, clips: [] };
  doc.tracks = [doc.tracks[0], v2, ...doc.tracks.slice(1)];
  const { dropOn, added, scroller, rows } = open({ store: makeStore({ doc }) });
  dragging(VIDEO);
  // Scrolled down, the rows' top has slid up under the sticky ruler: half way down the ruler is v1's row.
  rows.getBoundingClientRect = () => rect(0, RULER_HEIGHT - 4 * ROW_HEIGHT, 1400, 5 * ROW_HEIGHT);
  dropOn(scroller, x(400), RULER_HEIGHT / 2, "a");
  expect(added()[0].track.id).toBe("v2");
  expect(added()[0].clip.start).toBe(400);
});

// Files from the computer. A dragover carries no files (browsers keep them until the drop); reads counts any look.
function fileOver(target: Element, clientX: number, clientY: number) {
  const event = dragEvent("dragover", { clientX, clientY, types: ["Files"] });
  const transfer = transferOf(event);
  transfer.dropEffect = "copy"; // what a browser offers for files until a handler says otherwise
  const seen = { reads: 0 };
  Object.defineProperty(transfer, "files", {
    get: () => {
      seen.reads += 1;
      return [];
    },
  });
  const taken = !fireEvent(target, event);
  return { taken, effect: transfer.dropEffect, reads: seen.reads };
}
const fileDrop = (target: Element, clientX: number, clientY: number, files: File[]) =>
  !fireEvent(target, dragEvent("drop", { clientX, clientY, files }));
const file = (name: string) => new File(["x"], name);
// An upload row 40% through; the fake queue's keys are the file names. 2 s is 60 frames.
const upload = (fileName: string, over: Partial<UploadItem> = {}): UploadItem => ({
  key: fileName, fileName, sizeBytes: 100, durationMs: 2_000, stage: "uploading", sentBytes: 40, previewFraction: 0, assetId: null,
  message: null, canRetry: false, ...over,
});
const setUploads = (items: UploadItem[]) => act(async () => media.library.getState().setUploads(items));
const leftOf = (el: HTMLElement) => parseFloat(el.style.left);
const widthOf = (el: HTMLElement) => parseFloat(el.style.width);
const rowOf = (el: HTMLElement) => (parseFloat(el.style.top) - CLIP_TOP) / ROW_HEIGHT;
const flush = () => act(async () => {});
const audio = (id: string, start: number, duration: number) => ({ ...video(id, start, duration), type: "audio", assetId: "m" }) as Clip;

it("a file dragged over the timeline shows where it will land", () => {
  const { wrapper, scroller, lane, line, ghost, guide } = open();
  const event = dragEvent("dragover", { clientX: x(90), clientY: y(2), types: ["Files"] });
  expect(fireEvent(lane(2), event)).toBe(false);
  expect(transferOf(event).dropEffect).toBe("copy");
  const drawn = line()!;
  expect(parseFloat(drawn.style.left)).toBe(LANE_LEFT + 90 * ZOOM - 1);
  expect(parseFloat(drawn.style.top)).toBe(2 * ROW_HEIGHT);
  expect(parseFloat(drawn.style.height)).toBe(ROW_HEIGHT);
  expect(drawn.className).toBe("pointer-events-none absolute z-10 w-0.5 bg-ed-accent");
  expect(drawn.getAttribute("aria-hidden")).toBe("true");
  expect(ghost()).toBeNull();
  expect(wrapper.dataset.drop).toBe("over");

  // The files themselves are never looked at before the drop. Near c2's end the line snaps to it, with a guide.
  expect(fileOver(lane(2), x(62), y(2))).toEqual({ taken: true, effect: "copy", reads: 0 });
  expect(parseFloat(line()!.style.left)).toBe(LANE_LEFT + 60 * ZOOM - 1);
  expect(parseFloat(guide()!.style.left)).toBe(LANE_LEFT + 60 * ZOOM);

  // Below the last row there is no row: the line crosses them all.
  fileOver(scroller, x(200), y(5));
  expect(parseFloat(line()!.style.left)).toBe(LANE_LEFT + 200 * ZOOM - 1);
  expect(parseFloat(line()!.style.top)).toBe(0);
  expect(parseFloat(line()!.style.height)).toBe(4 * ROW_HEIGHT);

  act(() => drop.setIncoming(null));
  expect(line()).toBeNull();
  expect(wrapper.dataset.drop).toBe("idle");
});

it("a dropped file shows a placeholder until its upload lands, then the clip", async () => {
  const { st, lane, line, placeholders } = open();
  const climb = file("climb.mov");
  fileOver(lane(2), x(90), y(2));
  expect(fileDrop(lane(2), x(90), y(2), [climb])).toBe(true);
  expect(media.queue.add).toHaveBeenCalledTimes(1);
  expect(media.queue.add).toHaveBeenCalledWith([climb]);
  expect(line()).toBeNull();

  await setUploads([upload("climb.mov")]);
  expect(placeholders()).toHaveLength(1);
  const [shown] = placeholders();
  expect(shown.textContent).toBe("climb.mov · Uploading 40%");
  expect(leftOf(shown)).toBe(LANE_LEFT + 90 * ZOOM);
  expect(widthOf(shown)).toBe(60 * ZOOM);
  expect(rowOf(shown)).toBe(2);
  expect(shown.className).toContain("absolute z-10 rounded-[4px] border border-dashed border-ed-accent bg-ed-accent-weak");
  expect(shown.getAttribute("aria-hidden")).toBe("true");
  expect(shown.querySelector<HTMLElement>("[data-upload-progress]")!.style.width).toBe("40%");
  expect(shown.querySelector("button")).toBeNull();

  await act(async () => {
    media.library.getState().setUploads([upload("climb.mov", { stage: "done", sentBytes: 100, assetId: "n1" })]);
    media.library.getState().put(assetView({ id: "n1", name: "climb", fileName: "climb.mov", durationMs: 2_000 }));
  });
  await flush();
  expect(placeholders()).toEqual([]);
  const landed = st().doc.tracks.find((t) => t.id === "v1")!.clips.find((c) => c.type === "video" && c.assetId === "n1");
  expect(landed).toMatchObject({ start: 90, duration: 60 });
  expect(st().selection.clipIds).not.toContain(landed!.id);
});

it("the empty timeline's sentence hides while a dropped file waits to land", async () => {
  const doc = makeStore().getState().doc;
  for (const track of doc.tracks) track.clips = [];
  const { lane, placeholders, view } = open({ store: makeStore({ doc }) });
  const sentence = "Nothing on the timeline yet. Add text or media from the panel on the left, or drag files here.";
  const shown = () => within(view.container).queryByText(sentence);
  expect(shown()).not.toBeNull();
  fileOver(lane(2), x(90), y(2));
  fileDrop(lane(2), x(90), y(2), [file("climb.mov")]);
  await setUploads([upload("climb.mov")]);
  expect(placeholders()).toHaveLength(1);
  expect(shown()).toBeNull();
  // Cancelled, the group closes and the empty timeline says so again.
  await setUploads([]);
  await flush();
  expect(placeholders()).toEqual([]);
  expect(shown()).not.toBeNull();
});

it("a placeholder whose upload is in but has not landed reads just its name", async () => {
  const { st, lane, placeholders } = open();
  fileDrop(lane(2), x(90), y(2), [file("a.mov"), file("b.mov")]);
  await act(async () => {
    media.library.getState().setUploads([upload("a.mov", { durationMs: null }), upload("b.mov", { stage: "done", sentBytes: 100, assetId: "nb" })]);
    media.library.getState().put(assetView({ id: "nb", name: "b", fileName: "b.mov", durationMs: 2_000 }));
  });
  await flush();
  const [a, b] = placeholders();
  expect(a.textContent).toBe("a.mov · Uploading 40%");
  expect(b.textContent).toBe("b.mov");
  // a's length is not read yet: until it is, it counts as the still length (3 s, 90 frames), and b waits after it.
  expect([leftOf(a), widthOf(a)]).toEqual([LANE_LEFT + 90 * ZOOM, 90 * ZOOM]);
  expect([leftOf(b), widthOf(b)]).toEqual([LANE_LEFT + 180 * ZOOM, 60 * ZOOM]);

  // Once a's length is read (1 s), b takes its real slot and lands there.
  await setUploads([upload("a.mov", { durationMs: 1_000 }), upload("b.mov", { stage: "done", sentBytes: 100, assetId: "nb" })]);
  await flush();
  expect(placeholders().map((p) => p.textContent)).toEqual(["a.mov · Uploading 40%"]);
  expect([leftOf(placeholders()[0]), widthOf(placeholders()[0])]).toEqual([LANE_LEFT + 90 * ZOOM, 30 * ZOOM]);
  const landed = st().doc.tracks.find((t) => t.id === "v1")!.clips.find((c) => c.type === "video" && c.assetId === "nb");
  expect(landed).toMatchObject({ start: 120, duration: 60 });
});

it("a failed upload that can be tried again keeps its slot and says so", async () => {
  const { lane, placeholders } = open();
  fileDrop(lane(2), x(90), y(2), [file("climb.mov"), file("b.mov")]);
  await setUploads([upload("climb.mov", { stage: "failed", canRetry: true, message: "The upload stopped." }), upload("b.mov")]);
  const [climb, b] = placeholders();
  expect(climb.textContent).toBe("climb.mov · Upload failed");
  expect(climb.className).toContain("border-ed-danger");
  expect(climb.className).not.toContain("border-ed-accent");
  expect(b.className).toContain("border-ed-accent");
  expect(leftOf(b)).toBe(LANE_LEFT + 150 * ZOOM);
});

it("a cancelled file, or one failed for good, closes up the gap", async () => {
  const { lane, placeholders } = open();
  fileDrop(lane(2), x(90), y(2), [file("a.mov"), file("b.mov"), file("c.mov")]);
  await setUploads([upload("a.mov"), upload("b.mov"), upload("c.mov")]);
  expect(placeholders().map(leftOf)).toEqual([90, 150, 210].map((f) => LANE_LEFT + f * ZOOM));
  await setUploads([upload("b.mov"), upload("c.mov")]); // a cancelled
  expect(placeholders().map((p) => p.textContent)).toEqual(["b.mov · Uploading 40%", "c.mov · Uploading 40%"]);
  expect(placeholders().map(leftOf)).toEqual([90, 150].map((f) => LANE_LEFT + f * ZOOM));
  await setUploads([upload("b.mov", { stage: "failed", canRetry: false, message: "That file can't be read." }), upload("c.mov")]);
  expect(placeholders().map((p) => p.textContent)).toEqual(["c.mov · Uploading 40%"]);
  expect(placeholders().map(leftOf)).toEqual([LANE_LEFT + 90 * ZOOM]);
});

it("a placeholder shows on the row placement would really use", async () => {
  // A video dropped on the text row goes to v1.
  const first = open();
  fileDrop(first.lane(1), x(200), y(1), [file("a.mov")]);
  await setUploads([upload("a.mov")]);
  expect(first.placeholders().map(rowOf)).toEqual([2]);
  first.view.unmount();
  stopDrop();
  stopDrop = drop.start(); // forgets the drop above

  // Rows top to bottom: cap, t1, v2, v1, a1. Dropped on v1 where it is taken, a video goes to the free v2.
  const doc = makeStore().getState().doc;
  doc.tracks = [doc.tracks[0], { id: "v2", kind: "video", name: "Video 2", muted: false, hidden: false, locked: false, clips: [] }, ...doc.tracks.slice(1)];
  const second = open({ store: makeStore({ doc }) });
  act(() => drop.dropFiles([file("b.mov")], { frame: 10, trackId: "v1" }, { stillSeconds: 3 }));
  await setUploads([upload("b.mov")]);
  expect(second.placeholders().map(rowOf)).toEqual([2]);
});

it("a placeholder's wished track is the dropped row only when that row takes the file", async () => {
  // Rows top to bottom: o1, cap, t1, v1, a1. Wished onto a1, an image would go to the first row that takes it (o1);
  // with no wish it goes to its own kind's row, v1, as the file will land.
  const doc = makeStore().getState().doc;
  doc.tracks.push({ id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [] });
  const { placeholders } = open({ store: makeStore({ doc }) });
  act(() => drop.dropFiles([file("logo.png")], { frame: 200, trackId: "a1" }, { stillSeconds: 3 }));
  await setUploads([upload("logo.png", { durationMs: null })]);
  expect(placeholders().map(rowOf)).toEqual([3]);
  expect(widthOf(placeholders()[0])).toBe(90 * ZOOM);
});

it("when a new track would be made, a placeholder shows on the wished row, else its kind's first row, else the top row", async () => {
  // Rows top to bottom: cap, t1, v2, v1, a1, a2; every video and audio row is taken at frame 10.
  const doc = makeStore().getState().doc;
  const track = (id: string, kind: "video" | "audio", clips: Clip[]) => ({ id, kind, name: id, muted: false, hidden: false, locked: false, clips });
  doc.tracks = [doc.tracks[0], track("v2", "video", [video("d1", 0, 60)]), doc.tracks[1], doc.tracks[2], track("a1", "audio", [audio("m1", 0, 60)]), track("a2", "audio", [audio("m2", 0, 60)])];
  const first = open({ store: makeStore({ doc }) });
  act(() => drop.dropFiles([file("a.mov")], { frame: 10, trackId: "v1" }, { stillSeconds: 3 }));
  act(() => drop.dropFiles([file("b.mov")], { frame: 10, trackId: null }, { stillSeconds: 3 }));
  act(() => drop.dropFiles([file("c.mp3")], { frame: 10, trackId: null }, { stillSeconds: 3 }));
  await setUploads([upload("a.mov"), upload("b.mov"), upload("c.mp3")]);
  // a: its wished row, v1; b: the top-most video row, v2; c: the bottom-most audio row, a2.
  expect(first.placeholders().map(rowOf)).toEqual([3, 2, 5]);
  first.view.unmount();
  stopDrop();
  stopDrop = drop.start(); // forgets the drops above

  // No audio row at all: the top row.
  const bare = makeStore().getState().doc;
  bare.tracks = bare.tracks.filter((t) => t.kind !== "audio");
  const second = open({ store: makeStore({ doc: bare }) });
  act(() => drop.dropFiles([file("d.mp3")], { frame: 10, trackId: null }, { stillSeconds: 3 }));
  await setUploads([upload("d.mp3")]);
  expect(second.placeholders().map(rowOf)).toEqual([0]);
});

it("drops land with the window watcher installed", async () => {
  const { lane } = open();
  await setUploads([upload("a.mov", { stage: "waiting" }), upload("b.mov", { stage: "waiting" })]);
  fileOver(lane(2), x(90), y(2));
  fileDrop(lane(2), x(90), y(2), [file("a.mov")]);
  fileOver(lane(2), x(300), y(2));
  fileDrop(lane(2), x(300), y(2), [file("b.mov")]);
  await flush();
  const { groups } = drop.state.getState();
  expect(groups.map((g) => g.frame)).toEqual([90, 300]);
  expect(groups.map((g) => g.trackId)).toEqual(["v1", "v1"]);
});

it("a viewer and a project without uploads get dropEffect none", () => {
  const viewer = open({ store: makeStore({ canEdit: false }) });
  expect(fileOver(viewer.lane(2), x(90), y(2))).toEqual({ taken: true, effect: "none", reads: 0 });
  expect(viewer.line()).toBeNull();
  expect(viewer.wrapper.dataset.drop).toBe("idle");
  expect(fileDrop(viewer.lane(2), x(90), y(2), [file("a.mov")])).toBe(true);
  viewer.view.unmount();

  act(() => media.library.setState({ setUp: false }));
  const mine = open();
  expect(fileOver(mine.lane(2), x(90), y(2))).toEqual({ taken: true, effect: "none", reads: 0 });
  expect(mine.line()).toBeNull();
  expect(mine.wrapper.dataset.drop).toBe("idle");
  expect(fileDrop(mine.lane(2), x(90), y(2), [file("a.mov")])).toBe(true);
  expect(media.queue.add).not.toHaveBeenCalled();
  expect(drop.state.getState().groups).toEqual([]);
});

it("a deleted project takes no file", () => {
  const { st, lane, line } = open();
  act(() => st().setStatus("deleted"));
  expect(fileOver(lane(2), x(90), y(2))).toEqual({ taken: true, effect: "none", reads: 0 });
  expect(line()).toBeNull();
  fileDrop(lane(2), x(90), y(2), [file("a.mov")]);
  expect(media.queue.add).not.toHaveBeenCalled();
});

it("a file dropped near a clip's end starts there, with the Settings still length of the drop", async () => {
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, stillSeconds: 5 } });
  const { lane } = open({ settings });
  await setUploads([upload("logo.png", { stage: "waiting", durationMs: null })]);
  fileOver(lane(2), x(62), y(2));
  fileDrop(lane(2), x(62), y(2), [file("logo.png")]);
  expect(drop.state.getState().groups.map(({ frame, trackId, stillSeconds }) => ({ frame, trackId, stillSeconds }))).toEqual([
    { frame: 60, trackId: "v1", stillSeconds: 5 },
  ]);
});

it("a drop that carries no file is taken and does nothing", () => {
  const { lane, line } = open();
  fileOver(lane(2), x(90), y(2));
  // Files named, none carried (a folder, say): the browser still never opens it.
  expect(fireEvent(lane(2), dragEvent("drop", { clientX: x(90), clientY: y(2), types: ["Files"] }))).toBe(false);
  expect(line()).toBeNull();
  expect(media.queue.add).not.toHaveBeenCalled();
  expect(drop.state.getState().groups).toEqual([]);
});

// A waiting file's box takes the pointer: pressed, moved and let go of on the box itself, which holds the pointer.
const at = (clientX: number, clientY: number) => ({ button: 0, pointerId: 1, clientX, clientY });
const groupsNow = () => drop.state.getState().groups.map((g) => ({ frame: g.frame, trackId: g.trackId, keys: g.members.map((m) => m.key) }));

it("a file's box can be dragged along the timeline while it uploads, and the file lands where it was let go", async () => {
  const { st, lane, placeholders } = open();
  fileDrop(lane(2), x(200), y(2), [file("climb.mov")]);
  await setUploads([upload("climb.mov")]);
  const box = () => placeholders()[0];
  expect(box().className).not.toContain("pointer-events-none");
  expect(box().className).toContain("cursor-grab");
  // Its name and its bar let the pointer through to the box.
  expect([...box().children].every((child) => child.className.includes("pointer-events-none"))).toBe(true);

  // Taken 10 frames into the box and carried 200 frames to the right: [400, 460], far from every snap target.
  fireEvent.pointerDown(box(), at(x(210), y(2)));
  fireEvent.pointerMove(box(), at(x(410), y(2)));
  expect(leftOf(box())).toBe(LANE_LEFT + 400 * ZOOM);
  expect(rowOf(box())).toBe(2);
  expect(box().className).toContain("cursor-grabbing");
  expect(box().dataset.moving).toBe("true");
  expect(groupsNow()).toEqual([{ frame: 200, trackId: "v1", keys: ["climb.mov"] }]); // nothing is changed until it is let go
  fireEvent.pointerUp(box(), at(x(410), y(2)));
  expect(groupsNow()).toEqual([{ frame: 400, trackId: "v1", keys: ["climb.mov"] }]);
  expect(leftOf(box())).toBe(LANE_LEFT + 400 * ZOOM);
  expect(box().dataset.moving).toBeUndefined();

  await act(async () => {
    media.library.getState().setUploads([upload("climb.mov", { stage: "done", sentBytes: 100, assetId: "n1" })]);
    media.library.getState().put(assetView({ id: "n1", name: "climb", fileName: "climb.mov", durationMs: 2_000 }));
  });
  await flush();
  expect(placeholders()).toEqual([]);
  expect(st().doc.tracks.find((t) => t.id === "v1")!.clips.find((c) => c.type === "video" && c.assetId === "n1")).toMatchObject({ start: 400, duration: 60 });
});

it("a dragged box snaps to a clip's edge with a guide, and not with snapping off", async () => {
  const { st, lane, placeholders, guide } = open();
  fileDrop(lane(2), x(200), y(2), [file("climb.mov")]);
  await setUploads([upload("climb.mov")]);
  const box = () => placeholders()[0];
  fireEvent.pointerDown(box(), at(x(200), y(2)));
  fireEvent.pointerMove(box(), at(x(62), y(2))); // 2 frames from c2's end at 60
  expect(leftOf(box())).toBe(LANE_LEFT + 60 * ZOOM);
  expect(parseFloat(guide()!.style.left)).toBe(LANE_LEFT + 60 * ZOOM);
  act(() => st().setSnapping(false));
  fireEvent.pointerMove(box(), at(x(63), y(2)));
  expect(leftOf(box())).toBe(LANE_LEFT + 63 * ZOOM);
  expect(guide()).toBeNull();
  fireEvent.pointerUp(box(), at(x(63), y(2)));
  expect(groupsNow()).toEqual([{ frame: 63, trackId: "v1", keys: ["climb.mov"] }]);
  expect(guide()).toBeNull();
});

it("a box dragged onto another row wishes for that row, and never starts before frame 0", async () => {
  const { lane, placeholders } = open();
  fileDrop(lane(3), x(200), y(3), [file("theme.mp3")]);
  await setUploads([upload("theme.mp3")]);
  const box = () => placeholders()[0];
  expect(rowOf(box())).toBe(3);
  // Onto the video row, which takes no audio: it wishes for it, and shows on the audio row placement would use.
  fireEvent.pointerDown(box(), at(x(230), y(3)));
  fireEvent.pointerMove(box(), at(x(10), y(2)));
  expect(leftOf(box())).toBe(LANE_LEFT);
  expect(rowOf(box())).toBe(3);
  fireEvent.pointerUp(box(), at(x(10), y(2)));
  expect(groupsNow()).toEqual([{ frame: 0, trackId: "v1", keys: ["theme.mp3"] }]);
});

it("Escape puts a dragged box back, heard by nothing else, and a press without a move changes nothing", async () => {
  const { lane, placeholders } = open();
  fileDrop(lane(2), x(200), y(2), [file("climb.mov")]);
  await setUploads([upload("climb.mov")]);
  const box = () => placeholders()[0];
  const before = drop.state.getState().groups;
  const heard: string[] = [];
  const listen = (e: KeyboardEvent) => heard.push(e.key);
  window.addEventListener("keydown", listen);

  fireEvent.pointerDown(box(), at(x(210), y(2)));
  fireEvent.pointerMove(box(), at(x(410), y(2)));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(leftOf(box())).toBe(LANE_LEFT + 200 * ZOOM);
  expect(heard).toEqual([]);
  // The button is still down: further moves and the release do nothing.
  fireEvent.pointerMove(box(), at(x(500), y(2)));
  fireEvent.pointerUp(box(), at(x(500), y(2)));
  expect(drop.state.getState().groups).toBe(before);

  // With no drag under way Escape is everyone's again.
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(heard).toEqual(["Escape"]);

  // A press that travels less than a click's slop is no drag.
  fireEvent.pointerDown(box(), at(x(210), y(2)));
  fireEvent.pointerMove(box(), at(x(210) + 2, y(2)));
  fireEvent.pointerUp(box(), at(x(210) + 2, y(2)));
  expect(drop.state.getState().groups).toBe(before);
  window.removeEventListener("keydown", listen);
});

it("a file that comes in while its box is dragged lands when the box is let go, at its new place", async () => {
  const { st, lane, placeholders } = open();
  fileDrop(lane(2), x(200), y(2), [file("climb.mov")]);
  await setUploads([upload("climb.mov")]);
  const box = () => placeholders()[0];
  fireEvent.pointerDown(box(), at(x(210), y(2)));
  fireEvent.pointerMove(box(), at(x(410), y(2)));
  await act(async () => {
    media.library.getState().setUploads([upload("climb.mov", { stage: "done", sentBytes: 100, assetId: "n1" })]);
    media.library.getState().put(assetView({ id: "n1", name: "climb", fileName: "climb.mov", durationMs: 2_000 }));
  });
  await flush();
  const landed = () => st().doc.tracks.flatMap((t) => t.clips).find((c) => c.type === "video" && c.assetId === "n1");
  expect(landed()).toBeUndefined();
  expect(placeholders()).toHaveLength(1);
  fireEvent.pointerUp(box(), at(x(410), y(2)));
  await flush();
  expect(landed()).toMatchObject({ start: 400, duration: 60 });
  expect(placeholders()).toEqual([]);
});

it("dragging one file of a drop leaves the others where they are", async () => {
  const { lane, placeholders } = open();
  fileDrop(lane(2), x(200), y(2), [file("a.mov"), file("b.mov"), file("c.mov")]);
  await setUploads([upload("a.mov"), upload("b.mov"), upload("c.mov")]);
  const lefts = () => placeholders().map((p) => (leftOf(p) - LANE_LEFT) / ZOOM);
  expect(lefts()).toEqual([200, 260, 320]);
  const b = () => placeholders().find((p) => p.textContent!.startsWith("b.mov"))!;
  fireEvent.pointerDown(b(), at(x(260), y(2)));
  fireEvent.pointerMove(b(), at(x(500), y(2)));
  expect(placeholders().map((p) => p.textContent!.split(" ")[0])).toEqual(["a.mov", "b.mov", "c.mov"]);
  expect(lefts()).toEqual([200, 500, 320]);
  fireEvent.pointerUp(b(), at(x(500), y(2)));
  expect(groupsNow()).toEqual([
    { frame: 200, trackId: "v1", keys: ["a.mov"] },
    { frame: 500, trackId: "v1", keys: ["b.mov"] },
    { frame: 320, trackId: "v1", keys: ["c.mov"] },
  ]);
  expect(lefts()).toEqual([200, 500, 320]);
});

it("files being added or already landed are shown and counted as the landing counts them", async () => {
  const { placeholders } = open();
  await setUploads([upload("a.mov"), upload("b.mov", { stage: "done", sentBytes: 100 }), upload("c.mov"), upload("d.mov")]);
  // a was refused a place (out) though its row is still there; b is being added; c landed 30 frames long; d waits.
  act(() =>
    drop.state.setState({
      groups: [
        {
          id: "drop-9",
          frame: 90,
          trackId: "v1",
          stillSeconds: 3,
          members: [
            { key: "a.mov", state: "out" },
            { key: "b.mov", state: "placing" },
            { key: "c.mov", state: "placed", placedFrames: 30 },
            { key: "d.mov", state: "pending" },
          ],
        },
      ],
    }),
  );
  expect(placeholders().map((p) => p.textContent)).toEqual(["b.mov", "d.mov · Uploading 40%"]);
  expect(placeholders().map(leftOf)).toEqual([90, 180].map((f) => LANE_LEFT + f * ZOOM));
});

it("a file that failed for good takes no room, even before the landing has given it up", async () => {
  const { placeholders } = open();
  await setUploads([upload("a.mov", { stage: "failed", canRetry: false, message: "That file can't be read." }), upload("b.mov")]);
  // Put straight in the drop's state: no change of the library follows, so no landing runs and a stays pending.
  act(() =>
    drop.state.setState({
      groups: [{ id: "drop-9", frame: 90, trackId: "v1", stillSeconds: 3, members: [{ key: "a.mov", state: "pending" }, { key: "b.mov", state: "pending" }] }],
    }),
  );
  expect(placeholders().map((p) => p.textContent)).toEqual(["b.mov · Uploading 40%"]);
  expect(placeholders().map(leftOf)).toEqual([LANE_LEFT + 90 * ZOOM]);
});

it("without the window's watcher a file drop still clears the line", () => {
  stopWatching();
  const { wrapper, lane, line } = open();
  fileOver(lane(2), x(90), y(2));
  expect(line()).not.toBeNull();
  fileDrop(lane(2), x(90), y(2), [file("a.mov")]);
  expect(line()).toBeNull();
  expect(wrapper.dataset.drop).toBe("idle");
});

// A placeholder for a visual slot on the video track, over frames 0-30; the second clip stays a video.
function withPlaceholder(accepts: "visual" | "audio" = "visual") {
  const doc = store.getState().doc;
  const clips = [
    { id: "ph", type: "placeholder", accepts, start: 0, duration: 30, transform: { ...DEFAULT_TRANSFORM }, slot: { name: "intro" } } as Clip,
    video("c2", 30, 30),
  ];
  const next = { ...doc, tracks: doc.tracks.map((t) => (t.id === doc.tracks[0].id ? { ...t, clips } : t)) };
  return makeStore({ doc: next });
}

it("dropping a video on a placeholder fills the slot as one undoable change that keeps the clip id", () => {
  const filled = withPlaceholder();
  const view = open({ store: filled });
  dragging(VIDEO);
  const before = filled.getState().queue.length;
  view.dropOn(view.lane(2), x(10), y(2), "a");
  expect(filled.getState().queue.length).toBe(before + 1);
  expect(findClip(filled.getState().doc, "ph")!.clip).toMatchObject({ type: "video", assetId: "a", start: 0, duration: 30, slot: { name: "intro" } });
  expect(filled.getState().undoStack.at(-1)!.label).toBe("fill slot");
  act(() => filled.getState().undo());
  expect(findClip(filled.getState().doc, "ph")!.clip).toMatchObject({ type: "placeholder", accepts: "visual" });
});

it("dropping audio on a visual placeholder says it does not fit and changes nothing", () => {
  const filled = withPlaceholder();
  const view = open({ store: filled });
  const notices = noticesOf(filled);
  dragging(AUDIO);
  view.dropOn(view.lane(2), x(10), y(2), "m");
  expect(filled.getState().queue).toEqual([]);
  expect(notices).toEqual(["intro takes a video or image"]);
  expect(findClip(filled.getState().doc, "ph")!.clip.type).toBe("placeholder");
});

it("dropping on a clip that is not a placeholder adds the item as before", () => {
  const filled = withPlaceholder();
  const view = open({ store: filled });
  dragging(VIDEO);
  view.dropOn(view.lane(2), x(40), y(2), "a");
  expect(filled.getState().doc.tracks.flatMap((t) => t.clips).length).toBe(5);
  expect(findClip(filled.getState().doc, "ph")!.clip.type).toBe("placeholder");
});

it("while dragging over an empty slot that takes it, the box is the slot's own span", () => {
  const filled = withPlaceholder();
  const view = open({ store: filled });
  dragging(VIDEO);
  view.dragOver(view.lane(2), x(10), y(2));
  const box = view.ghost()!;
  expect(parseFloat(box.style.left)).toBe(LANE_LEFT + 0 * ZOOM);
  expect(parseFloat(box.style.width)).toBe(30 * ZOOM); // the slot's 30 frames, not the video's 60
  expect(parseFloat(box.style.top)).toBe(2 * ROW_HEIGHT + CLIP_TOP);
});

it("over an empty slot that does not take it, the box is where it would be added", () => {
  const filled = withPlaceholder();
  const view = open({ store: filled });
  dragging(AUDIO);
  view.dragOver(view.lane(2), x(10), y(2), { [ASSET_DRAG_TYPE]: "m" });
  expect(parseFloat(view.ghost()!.style.width)).toBe(60 * ZOOM); // the audio's own 2 s, not the slot's 30 frames
});

it("a drop that fills a slot with footage shorter than it says there is a gap", () => {
  const filled = withPlaceholder(); // 30 frames
  const view = open({ store: filled });
  const notices = noticesOf(filled);
  dragging(assetView({ id: "s", durationMs: 500 })); // 15 frames
  media.library.getState().put(assetView({ id: "s", durationMs: 500 }));
  view.dropOn(view.lane(2), x(10), y(2), "s");
  expect(notices).toEqual(["intro: the clip is shorter than the slot, so there's a gap after it."]);
});
