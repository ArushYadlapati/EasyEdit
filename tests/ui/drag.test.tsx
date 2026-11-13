// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { MediaServices } from "@/components/editor/media/media-context";
import type { TimelineDoc } from "@/lib/timeline";
import { cx } from "@/components/ui/cx";
import { ROW_HEIGHT, RULER_HEIGHT, displayRows } from "@/lib/editor/geometry";
import { resolveDrag } from "@/lib/editor/drag";
import { MESSAGES, explainOpError } from "@/lib/editor/messages";
import { findClip, viewDoc } from "@/lib/editor/store";
import { act, fireEvent, screen } from "../helpers/dom";
import { entry, makeStore, noticesOf, sampleDoc, text } from "../editor/fixtures";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { LANE_LEFT, ZOOM, installTimelineStubs, pendingFrames, renderTimeline, x, y } from "../helpers/timeline-harness";

// Both stay the real functions; the spies only count calls. ClipView calls cx once per render with
// its fill class, which nothing else on the timeline uses.
vi.mock("@/lib/editor/drag", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/editor/drag")>();
  return { ...real, resolveDrag: vi.fn(real.resolveDrag) };
});
vi.mock("@/components/ui/cx", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/cx")>();
  return { ...real, cx: vi.fn(real.cx) };
});

installTimelineStubs();

const T1 = y(1);
const V1 = y(2);
it("dragging a clip more than 3 px moves it and saves one edit", () => {
  const { st, clip, press, move, release, frame, startOf } = renderTimeline();
  expect(clip("x2").className).toContain("touch-none"); // a touch drag moves the clip, not the timeline
  press(clip("x2"), x(94), T1);
  move(x(114), T1);
  frame();
  expect(findClip(viewDoc(st()), "x2")!.clip.start).toBe(110); // shown while dragging, not saved yet
  expect(st().queue).toHaveLength(0);
  release(x(114), T1);
  expect(startOf("x2")).toBe(110);
  expect(st().gesture).toBeNull();
  expect(st().queue).toHaveLength(1);
  expect(st().undoStack.map((e) => e.label)).toEqual(["move"]);
});

it("dragging one clip of a two-clip selection moves both", () => {
  const { st, clip, press, move, release, frame, startOf } = renderTimeline();
  act(() => st().select(["x1", "x2"]));
  press(clip("x2"), x(94), T1);
  expect(st().selection.clipIds).toEqual(["x1", "x2"]);
  move(x(114), T1);
  frame();
  release(x(114), T1);
  expect(startOf("x1")).toBe(20);
  expect(startOf("x2")).toBe(110);
  expect(st().undoStack).toHaveLength(1);
});

it("a press and release within 3 px makes no edit and selects the clip alone", () => {
  const { st, clip, press, move, release, frame, startOf } = renderTimeline();
  act(() => st().select(["x1", "x2"]));
  press(clip("x2"), x(94), T1);
  move(x(94) + 2, T1);
  frame();
  release(x(94) + 2, T1);
  expect(startOf("x2")).toBe(90);
  expect(st().queue).toHaveLength(0);
  expect(st().selection.clipIds).toEqual(["x2"]);
});

it("Escape during a drag cancels it, makes no edit and keeps the selection", () => {
  const { st, clip, press, move, release, frame, startOf } = renderTimeline();
  act(() => st().select(["x1", "x2"]));
  press(clip("x2"), x(94), T1);
  move(x(114), T1);
  frame();
  expect(st().gesture).not.toBeNull();
  const later = vi.fn();
  window.addEventListener("keydown", later);
  const escape = fireEvent.keyDown(document.body, { key: "Escape" });
  window.removeEventListener("keydown", later);
  expect(escape).toBe(false); // handled: the default was prevented
  expect(later).not.toHaveBeenCalled();
  expect(st().gesture).toBeNull();
  move(x(130), T1);
  frame();
  release(x(130), T1);
  expect(startOf("x2")).toBe(90);
  expect(st().queue).toHaveLength(0);
  expect(st().selection.clipIds).toEqual(["x1", "x2"]);
});

it("a drop onto an occupied spot shows the attempted place, makes no edit and shows the store's message", () => {
  const { st, view, scroller, clip, press, move, release, frame, startOf } = renderTimeline();
  press(clip("x2"), x(94), T1);
  move(x(114), T1); // a free place: x2 is shown at 110
  frame();
  expect(view.container.querySelector("[data-drag-ghost]")).toBeNull();
  move(x(34), T1); // x2 would start at 30, over x1
  frame();
  const ghost = view.container.querySelector<HTMLElement>("[data-drag-ghost]")!;
  expect(ghost.className).toContain("border-ed-danger");
  expect(parseFloat(ghost.style.left)).toBe(LANE_LEFT + 30 * ZOOM);
  expect(parseFloat(ghost.style.top)).toBe(1 * ROW_HEIGHT + parseFloat(clip("x1").style.top)); // row t1, level with its clips
  expect(ghost.style.height).toBe(clip("x1").style.height);
  expect(scroller.dataset.drag).toBe("refused");
  expect(findClip(viewDoc(st()), "x2")!.clip.start).toBe(110); // the clip stays at the last place that fit
  expect(startOf("x2")).toBe(90);
  release(x(34), T1);
  expect(startOf("x2")).toBe(90);
  expect(st().queue).toHaveLength(0);
  expect(st().notice?.text).toBe(explainOpError("OVERLAP"));
  expect(view.container.querySelector("[data-drag-ghost]")).toBeNull();
  expect(scroller.dataset.drag).toBeUndefined();
});

it("a viewer cannot drag and sees no trim handles", () => {
  const { st, view, clip, press, move, release, frame, startOf } = renderTimeline(makeStore({ canEdit: false }));
  expect(view.container.querySelector("[data-trim-handle]")).toBeNull();
  press(clip("x2"), x(94), T1);
  move(x(114), T1);
  frame();
  release(x(114), T1);
  expect(startOf("x2")).toBe(90);
  expect(st().gesture).toBeNull();
  expect(st().queue).toHaveLength(0);
  expect(st().selection.clipIds).toEqual(["x2"]);
});

it("a trim by the right handle changes the duration in one edit", () => {
  const { st, clip, press, move, release, frame } = renderTimeline();
  const handle = clip("x2").querySelector<HTMLElement>('[data-trim-handle="end"]')!;
  press(handle, x(119), T1);
  move(x(129), T1);
  frame();
  release(x(129), T1);
  const x2 = findClip(st().doc, "x2")!.clip;
  expect([x2.start, x2.duration]).toEqual([90, 40]);
  expect(st().undoStack.map((e) => e.label)).toEqual(["trim"]);
});

it("box selection from empty row space selects the clips it covers", () => {
  const { st, view, lanes, press, move, release, frame } = renderTimeline();
  act(() => st().select(["x2"]));
  press(lanes[1], x(70), T1); // t1's lane, between x1 and x2
  expect(st().selection.clipIds).toEqual([]);
  move(x(10), V1);
  frame();
  expect(st().selection.clipIds).toEqual(["x1", "c1", "c2"]);
  expect(view.container.querySelector("[data-select-box]")).not.toBeNull();
  release(x(10), V1);
  expect(view.container.querySelector("[data-select-box]")).toBeNull();
  expect(st().selection.clipIds).toEqual(["x1", "c1", "c2"]);
  expect(st().queue).toHaveLength(0);
});

it("a viewer can box-select too", () => {
  const { st, lanes, press, move, release, frame } = renderTimeline(makeStore({ canEdit: false }));
  press(lanes[2], x(70), V1); // v1's lane, after c2
  move(x(40), V1);
  frame();
  release(x(40), V1);
  expect(st().selection.clipIds).toEqual(["c2"]);
});

it("a teammate's edit elsewhere keeps the drag going, and removing the dragged clip ends it", () => {
  const { store, st, scroller, clip, press, move, release, frame, startOf } = renderTimeline();
  press(clip("x2"), x(94), T1);
  move(x(114), T1);
  frame();
  act(() => void st().applyRemote([entry(6, [{ op: "move_clip", clipId: "c1", start: 200 }])]));
  frame();
  expect(findClip(viewDoc(st()), "x2")!.clip.start).toBe(110);
  const notices = noticesOf(store);
  act(() => void st().applyRemote([entry(7, [{ op: "remove_clip", clipId: "x2" }])]));
  frame();
  expect(st().gesture).toBeNull();
  expect(notices).toEqual([MESSAGES.clipGone]); // the store's message, once
  expect(scroller.dataset.drag).toBeUndefined();
  release(x(114), T1);
  expect(st().queue).toHaveLength(0);
  expect(startOf("c1")).toBe(200);
});

it("a drag with nothing to save yet still says so when its clip is removed", () => {
  const { st, clip, press, move, release, frame } = renderTimeline();
  press(clip("x2"), x(94), T1);
  move(x(94), T1 + 5); // a drag, but still on the same frame and row
  frame();
  expect(st().gesture).toBeNull();
  act(() => void st().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x2" }])]));
  expect(st().notice).toBeNull();
  frame();
  expect(st().notice?.text).toBe(MESSAGES.clipGone);
  release(x(94), T1 + 5);
  expect(st().queue).toHaveLength(0);
});

it("a teammate taking the spot mid-drag shows the attempt, refuses the drop and keeps the clip where it was", () => {
  const { st, view, scroller, clip, press, move, release, frame, startOf, shownStart } = renderTimeline();
  press(clip("x2"), x(94), T1);
  move(x(204), T1); // x2 to 200, a free place
  frame();
  expect(shownStart("x2")).toBe(200);
  act(() => void st().applyRemote([entry(6, [{ op: "move_clip", clipId: "x1", start: 190 }])])); // now 190 to 250
  frame();
  expect(scroller.dataset.drag).toBe("refused");
  expect(parseFloat(view.container.querySelector<HTMLElement>("[data-drag-ghost]")!.style.left)).toBe(LANE_LEFT + 200 * ZOOM);
  release(x(204), T1);
  expect(startOf("x2")).toBe(90);
  expect(st().queue).toHaveLength(0);
  expect(st().notice?.text).toBe(explainOpError("OVERLAP"));
});

it("a clip removed between the press and the start of the drag ends the press with one message", () => {
  const { store, st, clip, press, move, release, frame } = renderTimeline();
  press(clip("x2"), x(94), T1);
  const notices = noticesOf(store);
  act(() => void st().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x2" }])]));
  expect(notices).toEqual([]);
  move(x(114), T1);
  move(x(120), T1);
  frame();
  release(x(120), T1);
  expect(notices).toEqual([MESSAGES.clipGone]);
  expect(st().queue).toHaveLength(0);
});

it("turning snapping off, moving the playhead or zooming during a drag updates it without a pointer move", () => {
  const { st, view, clip, press, move, frame, shownStart } = renderTimeline();
  const guide = () => view.container.querySelector<HTMLElement>("[data-snap-guide]");
  press(clip("x2"), x(94), T1);
  move(x(67), T1); // x2 to 63, snapped to the edge at 60
  frame();
  expect(shownStart("x2")).toBe(60);
  expect(guide()).not.toBeNull();
  act(() => st().setSnapping(false));
  frame();
  expect(shownStart("x2")).toBe(63);
  expect(guide()).toBeNull();
  act(() => st().setSnapping(true));
  frame();
  expect(shownStart("x2")).toBe(60);
  act(() => st().seek(65)); // closer than the edge at 60
  frame();
  expect(shownStart("x2")).toBe(65);
  expect(parseFloat(guide()!.style.left)).toBe(LANE_LEFT + 65 * ZOOM);
  act(() => st().setZoom(1)); // the pointer is now over frame 134, 40 frames after the grab
  frame();
  expect(shownStart("x2")).toBe(130);
});

it("works out several pointer moves in one animation frame once", () => {
  const { clip, press, move, frame } = renderTimeline();
  const resolve = vi.mocked(resolveDrag);
  press(clip("x2"), x(94), T1);
  resolve.mockClear();
  move(x(110), T1);
  move(x(114), T1);
  move(x(118), T1);
  expect(resolve).not.toHaveBeenCalled();
  frame();
  expect(resolve).toHaveBeenCalledTimes(1);
});

it("losing edit access mid-drag ends the drag and saves nothing", () => {
  const { st, scroller, clip, press, move, release, frame } = renderTimeline();
  press(clip("x2"), x(94), T1);
  move(x(114), T1);
  frame();
  act(() => st().revokeEditing());
  frame();
  expect(scroller.dataset.drag).toBeUndefined();
  expect(st().gesture).toBeNull();
  release(x(114), T1);
  expect(st().queue).toHaveLength(0);
});

it("pointercancel, lost capture and unmount each end the drag with nothing left behind", () => {
  for (const exit of ["pointercancel", "lostpointercapture", "unmount"] as const) {
    const { st, view, scroller, clip, press, move, frame } = renderTimeline();
    const spies = [scroller, window].map((target) => ({
      add: vi.spyOn(target, "addEventListener"),
      remove: vi.spyOn(target, "removeEventListener"),
    }));
    press(clip("x2"), x(94), T1);
    move(x(114), T1);
    frame();
    move(x(118), T1); // an animation frame is pending
    expect(st().gesture, exit).not.toBeNull();
    expect(pendingFrames(), exit).toBe(1);
    if (exit === "pointercancel") fireEvent.pointerCancel(scroller, { pointerId: 1 });
    else if (exit === "lostpointercapture") fireEvent.lostPointerCapture(scroller, { pointerId: 1 });
    else view.unmount();
    expect(st().gesture, exit).toBeNull();
    expect(pendingFrames(), exit).toBe(0);
    expect(st().queue, exit).toHaveLength(0);
    for (const { add, remove } of spies) {
      const left = add.mock.calls.filter(([type, fn]) => !remove.mock.calls.some(([t, f]) => t === type && f === fn));
      expect(left.map(([type]) => type), exit).toEqual([]);
    }
    expect(spies.reduce((n, { add }) => n + add.mock.calls.length, 0), exit).toBeGreaterThan(0);
    if (exit !== "unmount") view.unmount();
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1400);
  }
});

it("a Shift box keeps the selection held at the press, gives clips back as it shrinks, and Escape restores it", () => {
  const { st, lanes, press, move, release, frame } = renderTimeline();
  const selected = () => st().selection.clipIds;
  act(() => st().select(["c1"]));
  press(lanes[1], x(70), T1, { shiftKey: true }); // t1's lane, between x1 and x2
  expect(selected()).toEqual(["c1"]);
  move(x(50), T1);
  frame();
  expect(selected()).toEqual(["c1", "x1"]);
  move(x(40), V1);
  frame();
  expect(selected()).toEqual(["c1", "x1", "c2"]);
  move(x(65), T1);
  frame();
  expect(selected()).toEqual(["c1"]);
  move(x(50), T1);
  frame();
  expect(selected()).toEqual(["c1", "x1"]);
  expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(false);
  expect(selected()).toEqual(["c1"]);
  release(x(50), T1);
  expect(selected()).toEqual(["c1"]);
});

it("moving one clip re-renders only that clip, not the others on screen", () => {
  const doc = sampleDoc();
  doc.tracks[1].clips = Array.from({ length: 300 }, (_, i) => text(`k${i}`, i * 30, 20));
  const { st, view } = renderTimeline(makeStore({ doc }));
  act(() => st().setZoom(0.5));
  expect(view.container.querySelectorAll("[data-clip-id]").length).toBeGreaterThan(50);
  const clipRenders = () => vi.mocked(cx).mock.calls.filter((parts) => parts.some((p) => typeof p === "string" && p.startsWith("bg-ed-clip-"))).length;
  vi.mocked(cx).mockClear();
  act(() => void st().setGesture([{ op: "move_clip", clipId: "k5", start: 155 }]));
  expect(findClip(viewDoc(st()), "k5")!.clip.start).toBe(155);
  expect(clipRenders()).toBe(1);
});

it("a focused clip leaves Space to play and pause, and Enter selects it", () => {
  const { st, clip } = renderTimeline();
  act(() => st().select(["x1"]));
  clip("x2").focus();
  expect(fireEvent.keyDown(clip("x2"), { key: " " })).toBe(true); // not prevented: the window's play/pause shortcut gets it
  expect(st().selection.clipIds).toEqual(["x1"]);
  expect(fireEvent.keyDown(clip("x2"), { key: "Enter" })).toBe(false);
  expect(st().selection.clipIds).toEqual(["x2"]);
});

it("an end trim on the timeline stops at the end of the media", () => {
  // c2 is frames 30 to 60, from the start of asset "a". A 2 s asset is 60 frames at 30 fps, so c2 can end at 90.
  const dragEnd = (media?: MediaServices) => {
    const { st, clip, press, move, release, frame, view } = renderTimeline(makeStore(), { media });
    const handle = clip("c2").querySelector<HTMLElement>('[data-trim-handle="end"]')!;
    press(handle, x(59), V1);
    move(x(300), V1);
    frame();
    release(x(300), V1);
    const ops = st().queue.flatMap((e) => e.ops);
    view.unmount();
    return ops;
  };
  expect(dragEnd(pretendMediaServices([assetView({ durationMs: 2_000 })]))).toEqual([{ op: "trim_clip", clipId: "c2", edge: "end", to: 90 }]);
  expect(dragEnd()).toEqual([{ op: "trim_clip", clipId: "c2", edge: "end", to: 300 }]);
});

it("the library is read when a trim starts, not when the timeline is drawn", () => {
  const media = pretendMediaServices([]);
  const { st, clip, press, move, release, frame } = renderTimeline(makeStore(), { media });
  // The library learns the asset after the timeline is drawn: the next trim stops at its end.
  act(() => media.library.getState().put(assetView({ durationMs: 2_000 })));
  const handle = clip("c2").querySelector<HTMLElement>('[data-trim-handle="end"]')!;
  press(handle, x(59), V1);
  move(x(300), V1);
  frame();
  release(x(300), V1);
  expect(st().queue.flatMap((e) => e.ops)).toEqual([{ op: "trim_clip", clipId: "c2", edge: "end", to: 90 }]);
});

// Track drags. A track is pressed by its name, left of the lanes, and dragged by its header.
const HEAD_X = 50;
const rowOrder = (st: () => { doc: TimelineDoc }) => displayRows(st().doc).map((t) => t.id);
const insertLine = (view: { container: HTMLElement }) => view.container.querySelector<HTMLElement>("[data-track-insert]");

it("dragging a track's header to the top moves it there in one change", () => {
  const { st, view, scroller, press, move, release, frame } = renderTimeline();
  const name = screen.getByRole("button", { name: "Video 1" });
  expect(name.parentElement!.className).toContain("cursor-grab");
  const capture = vi.spyOn(scroller, "setPointerCapture");
  press(name, HEAD_X, y(2));
  move(HEAD_X, y(2) - 2); // within 3 px: still a press, not captured
  expect(capture).not.toHaveBeenCalled();
  move(HEAD_X, RULER_HEIGHT);
  expect(capture).toHaveBeenCalledWith(1);
  expect(insertLine(view)).toBeNull(); // worked out on the next animation frame
  frame();
  const line = insertLine(view)!;
  expect(line.style.top).toBe("-1px");
  expect(line.className).toContain("bg-ed-accent");
  expect(line.className).toContain("z-30");
  const tint = view.container.querySelector<HTMLElement>("[data-track-drag-row]")!;
  expect(tint.className).toContain("bg-ed-accent-weak");
  expect(tint.className).toContain("pointer-events-none");
  expect(tint.style.top).toBe(`${2 * ROW_HEIGHT}px`);
  expect(scroller.dataset.drag).toBe("track");
  expect(scroller.className).toContain("[&[data-drag=track]_*]:cursor-grabbing");
  expect(rowOrder(st)).toEqual(["cap", "t1", "v1", "a1"]); // the rows stay put meanwhile
  release(HEAD_X, RULER_HEIGHT);
  expect(rowOrder(st)).toEqual(["v1", "cap", "t1", "a1"]);
  expect(st().queue.map((e) => e.label)).toEqual(["reorder tracks"]);
  expect(insertLine(view)).toBeNull();
  expect(scroller.dataset.drag).toBeUndefined();
});

it("a track drag does not scroll the lanes sideways", () => {
  const { scroller, press, move, release, frame } = renderTimeline();
  scroller.scrollLeft = 300;
  press(screen.getByRole("button", { name: "Video 1" }), HEAD_X, y(2));
  move(HEAD_X, RULER_HEIGHT);
  frame();
  frame();
  expect(scroller.scrollLeft).toBe(300);
  release(HEAD_X, RULER_HEIGHT);
});

it("a track drag near the rows' bottom scrolls them down by 12 per frame, and never below 0 at the top", () => {
  const { scroller, press, move, release, frame } = renderTimeline();
  press(screen.getByRole("button", { name: "Text 1" }), HEAD_X, y(1));
  move(HEAD_X, RULER_HEIGHT + 4 * ROW_HEIGHT - 10); // 10 px above the rows' bottom
  frame();
  expect(scroller.scrollTop).toBe(12);
  frame();
  expect(scroller.scrollTop).toBe(24);
  move(HEAD_X, y(2)); // the middle of the rows: no scroll
  frame();
  expect(scroller.scrollTop).toBe(24);
  move(HEAD_X, RULER_HEIGHT + 5); // near the rows' top
  frame();
  expect(scroller.scrollTop).toBe(12);
  frame();
  frame();
  expect(scroller.scrollTop).toBe(0);
  expect(scroller.scrollLeft).toBe(0);
  release(HEAD_X, RULER_HEIGHT + 5);
});

it("an audio track stops at the audio rows", () => {
  const doc = sampleDoc();
  doc.tracks.push({ id: "a2", kind: "audio", name: "Audio 2", muted: false, hidden: false, locked: false, clips: [] });
  const { st, view, press, move, release, frame } = renderTimeline(makeStore({ doc })); // rows: cap, t1, v1, a1, a2
  press(screen.getByRole("button", { name: "Audio 2" }), HEAD_X, y(4));
  move(HEAD_X, RULER_HEIGHT);
  frame();
  expect(insertLine(view)!.style.top).toBe(`${3 * ROW_HEIGHT - 1}px`);
  release(HEAD_X, RULER_HEIGHT);
  expect(rowOrder(st)).toEqual(["cap", "t1", "v1", "a2", "a1"]);
  press(screen.getByRole("button", { name: "Video 1" }), HEAD_X, y(2));
  move(HEAD_X, y(4));
  frame();
  expect(insertLine(view)).toBeNull(); // below Video 1 is the audio rows: it stays where it is
  release(HEAD_X, y(4));
  expect(rowOrder(st)).toEqual(["cap", "t1", "v1", "a2", "a1"]);
  expect(st().queue).toHaveLength(1);
});

it("Escape puts the track back", () => {
  const { st, view, scroller, press, move, release, frame } = renderTimeline();
  press(screen.getByRole("button", { name: "Video 1" }), HEAD_X, y(2));
  move(HEAD_X, RULER_HEIGHT);
  frame();
  expect(insertLine(view)).not.toBeNull();
  const later = vi.fn();
  window.addEventListener("keydown", later);
  const escape = fireEvent.keyDown(document.body, { key: "Escape" });
  window.removeEventListener("keydown", later);
  expect(escape).toBe(false);
  expect(later).not.toHaveBeenCalled();
  expect(insertLine(view)).toBeNull();
  expect(scroller.dataset.drag).toBeUndefined();
  move(HEAD_X, RULER_HEIGHT + 2);
  frame();
  release(HEAD_X, RULER_HEIGHT + 2);
  expect(rowOrder(st)).toEqual(["cap", "t1", "v1", "a1"]);
  expect(st().queue).toHaveLength(0);
});

it("a viewer's press moves nothing", () => {
  const { st, view, scroller, press, move, release, frame } = renderTimeline(makeStore({ canEdit: false }));
  const name = screen.getByRole("button", { name: "Video 1" });
  expect(name.parentElement!.className).not.toContain("cursor-grab");
  const listen = vi.spyOn(window, "addEventListener");
  press(name, HEAD_X, y(2));
  expect(listen).not.toHaveBeenCalled(); // no press begins
  move(HEAD_X, RULER_HEIGHT);
  frame();
  expect(insertLine(view)).toBeNull();
  expect(scroller.dataset.drag).toBeUndefined();
  release(HEAD_X, RULER_HEIGHT);
  expect(rowOrder(st)).toEqual(["cap", "t1", "v1", "a1"]);
  expect(st().queue).toHaveLength(0);
});

it("a locked track drags", () => {
  const doc = sampleDoc();
  doc.tracks[0].locked = true; // v1
  const { st, press, move, release, frame } = renderTimeline(makeStore({ doc }));
  press(screen.getByRole("button", { name: "Video 1" }), HEAD_X, y(2));
  move(HEAD_X, RULER_HEIGHT);
  frame();
  release(HEAD_X, RULER_HEIGHT);
  expect(rowOrder(st)).toEqual(["v1", "cap", "t1", "a1"]);
});

it("on a Mac a Ctrl press on a header drags nothing, and a press on the options popup never drags", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const { st, scroller, press, move, release, frame } = renderTimeline();
  const name = screen.getByRole("button", { name: "Video 1" });
  press(name, HEAD_X, y(2), { ctrlKey: true });
  move(HEAD_X, RULER_HEIGHT);
  frame();
  release(HEAD_X, RULER_HEIGHT);
  expect(scroller.dataset.drag).toBeUndefined();
  expect(st().queue).toHaveLength(0);
  // Opened from the keyboard: an earlier test's drag may still be swallowing the next click.
  fireEvent.keyDown(screen.getAllByRole("button", { name: "Track options" })[2], { key: "ArrowDown" });
  press(screen.getByRole("menu"), HEAD_X, y(2));
  move(HEAD_X, RULER_HEIGHT);
  frame();
  release(HEAD_X, RULER_HEIGHT);
  expect(scroller.dataset.drag).toBeUndefined();
  expect(st().queue).toHaveLength(0);
  expect(rowOrder(st)).toEqual(["cap", "t1", "v1", "a1"]);
});

it("a press without moving opens the name field; a drag does not", async () => {
  const { st, scroller, press, move, release, frame } = renderTimeline();
  const name = () => screen.getByRole("button", { name: "Video 1" });
  const field = () => screen.queryByRole("textbox", { name: "Track name" });
  // A press on a switch is the switch's own, and only the main button drags.
  press(screen.getAllByRole("button", { name: "Lock track" })[2], HEAD_X + 120, y(2));
  move(HEAD_X + 120, RULER_HEIGHT);
  frame();
  release(HEAD_X + 120, RULER_HEIGHT);
  press(name(), HEAD_X, y(2), { button: 2 });
  move(HEAD_X, RULER_HEIGHT);
  frame();
  release(HEAD_X, RULER_HEIGHT);
  expect(scroller.dataset.drag).toBeUndefined();
  expect(st().queue).toHaveLength(0);
  // A drag: the click that follows its release is swallowed, once.
  press(name(), HEAD_X, y(2));
  move(HEAD_X, RULER_HEIGHT);
  frame();
  release(HEAD_X, RULER_HEIGHT);
  expect(fireEvent.click(name())).toBe(false);
  expect(field()).toBeNull();
  expect(st().selection.trackId).toBeNull();
  // A plain press keeps the click: the field opens.
  press(name(), HEAD_X, y(0));
  release(HEAD_X, y(0));
  fireEvent.click(name());
  expect(field()).not.toBeNull();
  expect(st().selection.trackId).toBe("v1");
  // A press in the field is the field's own.
  press(field()!, HEAD_X, y(0));
  move(HEAD_X, y(2));
  frame();
  release(HEAD_X, y(2));
  expect(st().queue).toHaveLength(1);
  fireEvent.keyDown(field()!, { key: "Escape" });
  // A drag released with no click after it: the swallower goes on the next task.
  press(name(), HEAD_X, y(0));
  move(HEAD_X, y(2));
  frame();
  release(HEAD_X, y(2));
  await act(() => new Promise((done) => setTimeout(done, 0)));
  fireEvent.click(name());
  expect(field()).not.toBeNull();
  expect(rowOrder(st)).toEqual(["cap", "t1", "v1", "a1"]);
  expect(st().queue.map((e) => e.label)).toEqual(["reorder tracks", "reorder tracks"]);
});

it("a track removed during the drag ends it with a message", () => {
  const { store, st, view, scroller, press, move, release, frame } = renderTimeline();
  const spies = [scroller, window].map((target) => ({
    add: vi.spyOn(target, "addEventListener"),
    remove: vi.spyOn(target, "removeEventListener"),
  }));
  press(screen.getByRole("button", { name: "Video 1" }), HEAD_X, y(2));
  move(HEAD_X, RULER_HEIGHT);
  frame();
  move(HEAD_X, RULER_HEIGHT + 2); // an animation frame is pending
  expect(insertLine(view)).not.toBeNull();
  const notices = noticesOf(store);
  act(() => void st().applyRemote([entry(6, [{ op: "remove_track", trackId: "v1" }])]));
  frame();
  expect(notices).toEqual([MESSAGES.trackGone]);
  expect(insertLine(view)).toBeNull();
  expect(scroller.dataset.drag).toBeUndefined();
  expect(pendingFrames()).toBe(0);
  for (const { add, remove } of spies) {
    const left = add.mock.calls.filter(([type, fn]) => !remove.mock.calls.some(([t, f]) => t === type && f === fn));
    expect(left.map(([type]) => type)).toEqual([]);
  }
  expect(spies.reduce((n, { add }) => n + add.mock.calls.length, 0)).toBeGreaterThan(0);
  release(HEAD_X, RULER_HEIGHT + 2);
  expect(st().queue).toHaveLength(0);
  expect(notices).toEqual([MESSAGES.trackGone]);
});

it("losing edit access mid-drag ends a track drag and saves nothing", () => {
  const { st, view, scroller, press, move, release, frame } = renderTimeline();
  press(screen.getByRole("button", { name: "Video 1" }), HEAD_X, y(2));
  move(HEAD_X, RULER_HEIGHT);
  frame();
  act(() => st().revokeEditing());
  frame();
  expect(insertLine(view)).toBeNull();
  expect(scroller.dataset.drag).toBeUndefined();
  release(HEAD_X, RULER_HEIGHT);
  expect(rowOrder(st)).toEqual(["cap", "t1", "v1", "a1"]);
  expect(st().queue).toHaveLength(0);
});
