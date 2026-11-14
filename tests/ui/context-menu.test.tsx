// @vitest-environment happy-dom
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { ContextMenuProvider, menuPoint, placeAtPoint, useContextMenu, type ContextMenuRequest } from "@/components/ui/context-menu";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ROW_HEIGHT, RULER_HEIGHT } from "@/lib/editor/geometry";
import { MESSAGES } from "@/lib/editor/messages";
import { findClip } from "@/lib/editor/store";
import { DEFAULT_TRANSFORM, isCropped } from "@/lib/timeline";
import { makeStore, sampleDoc, video } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";
import { happyDOM, rect } from "../helpers/layout";
import { LANE_LEFT, installTimelineStubs, renderTimeline, x, y } from "../helpers/timeline-harness";

const ITEMS: MenuItem[] = [
  { id: "cut", label: "Cut", disabled: true },
  { id: "copy", label: "Copy" },
  { id: "delete", label: "Delete", danger: true, separatorBefore: true },
];

// A test button that asks for a menu where it was right-clicked, and gives focus back to itself.
function Target({ label = "Clip", items = ITEMS, onSelect = () => {} }: { label?: string; items?: MenuItem[]; onSelect?(id: string): void }) {
  const menu = useContextMenu();
  return (
    <button
      type="button"
      onContextMenu={(e) => {
        e.preventDefault();
        menu?.({ ...menuPoint(e), label, items, onSelect, returnFocus: e.currentTarget });
      }}
    >
      Target
    </button>
  );
}

function show(props: Parameters<typeof Target>[0] = {}) {
  render(
    <ContextMenuProvider>
      <Target {...props} />
      <input aria-label="Field" />
    </ContextMenuProvider>,
  );
  return { target: screen.getByRole("button", { name: "Target" }), field: screen.getByRole("textbox", { name: "Field" }) };
}

const menus = () => screen.queryAllByRole("menu");

beforeEach(() => {
  happyDOM().setViewport({ width: 1024, height: 768 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("placeAtPoint flips at the window's edges", () => {
  const view = { width: 1024, height: 768 };
  const size = { width: 200, height: 150 };
  expect(placeAtPoint({ x: 100, y: 100 }, size, view)).toEqual({ top: 100, left: 100 });
  expect(placeAtPoint({ x: 900, y: 100 }, size, view)).toEqual({ top: 100, left: 700 });
  expect(placeAtPoint({ x: 100, y: 700 }, size, view)).toEqual({ top: 550, left: 100 });
  expect(placeAtPoint({ x: 2, y: 2 }, size, view)).toEqual({ top: 8, left: 8 });
  // A menu that just fits stays at the point; flipped past the other edge, it is kept inside.
  expect(placeAtPoint({ x: 816, y: 610 }, size, view)).toEqual({ top: 610, left: 816 });
  expect(placeAtPoint({ x: 150, y: 120 }, { width: 200, height: 150 }, { width: 300, height: 260 })).toEqual({ top: 8, left: 8 });
  expect(placeAtPoint({ x: 1020, y: 760 }, size, view)).toEqual({ top: 610, left: 816 });
});

it("menuPoint gives the pointer inside the element, else the element's lower-left corner", () => {
  const el = document.createElement("div");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(50, 60, 100, 40));
  expect(menuPoint({ clientX: 70, clientY: 80, currentTarget: el })).toEqual({ x: 70, y: 80 });
  expect(menuPoint({ clientX: 50, clientY: 100, currentTarget: el })).toEqual({ x: 50, y: 100 });
  expect(menuPoint({ clientX: 0, clientY: 0, currentTarget: el })).toEqual({ x: 50, y: 100 });
  expect(menuPoint({ clientX: 160, clientY: 80, currentTarget: el })).toEqual({ x: 50, y: 100 });
  expect(menuPoint({ clientX: 70, clientY: 110, currentTarget: el })).toEqual({ x: 50, y: 100 });
});

it("a request opens a menu with its label, its first item focused", () => {
  const { target } = show();
  expect(menus()).toHaveLength(0);
  fireEvent.contextMenu(target, { clientX: 5, clientY: 5 });
  const menu = screen.getByRole("menu", { name: "Clip" });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Cut", "Copy", "Delete"]);
  expect(screen.getAllByRole("separator")).toHaveLength(1);
  // The arrow keys move as in any menu, and the browser's own menu stays shut over it.
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
  expect(fireEvent.contextMenu(menu)).toBe(false);
  expect(fireEvent.contextMenu(screen.getByRole("menuitem", { name: "Copy" }))).toBe(false);
});

it("a pick closes the menu and puts focus back before it runs", () => {
  let focused: Element | null = null;
  let open = -1;
  const onSelect = vi.fn(() => {
    focused = document.activeElement;
    open = menus().length;
  });
  const { target } = show({ onSelect });
  fireEvent.contextMenu(target);
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith("copy");
  expect(focused).toBe(target);
  expect(open).toBe(1); // still drawn while it runs: the close is drawn after
  expect(menus()).toHaveLength(0);
  expect(document.activeElement).toBe(target);
});

it("a pick that focuses a field keeps the focus there", () => {
  const onSelect = () => screen.getByRole("textbox", { name: "Field" }).focus();
  const { target, field } = show({ onSelect });
  fireEvent.contextMenu(target);
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
  expect(menus()).toHaveLength(0);
  expect(document.activeElement).toBe(field);
});

it("Escape closes it and puts focus back", () => {
  const onSelect = vi.fn();
  const { target, field } = show({ onSelect });
  field.focus();
  fireEvent.contextMenu(target);
  const pressed = fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(pressed).toBe(false);
  expect(menus()).toHaveLength(0);
  expect(document.activeElement).toBe(target);
  expect(onSelect).not.toHaveBeenCalled();
});

it("Tab closes it and leaves focus to the browser", () => {
  const { target, field } = show();
  fireEvent.contextMenu(target);
  const item = screen.getByRole("menuitem", { name: "Copy" });
  field.focus();
  fireEvent.keyDown(item, { key: "Tab" });
  expect(menus()).toHaveLength(0);
  expect(document.activeElement).toBe(field);
});

// A sender with no element of its own: the test calls the provider's function directly.
function Sender({ onReady }: { onReady(open: (request: ContextMenuRequest) => void): void }) {
  const menu = useContextMenu();
  useEffect(() => {
    if (menu) onReady(menu);
  }, [menu, onReady]);
  return null;
}

function showSender() {
  let open!: (request: ContextMenuRequest) => void;
  render(
    <ContextMenuProvider>
      <Sender onReady={(fn) => (open = fn)} />
      <input aria-label="Field" />
    </ContextMenuProvider>,
  );
  return { open: (request: Partial<ContextMenuRequest>) => act(() => open({ x: 10, y: 10, label: "Track", items: ITEMS, onSelect: () => {}, ...request })) };
}

it("focus goes back to what had it when the element to return to is gone", () => {
  const { open } = showSender();
  const field = screen.getByRole("textbox", { name: "Field" });
  const gone = document.createElement("button");
  field.focus();
  open({ returnFocus: gone });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(document.activeElement).toBe(field);

  // With none named, the same.
  field.focus();
  const onSelect = vi.fn(() => expect(document.activeElement).toBe(field));
  open({ onSelect });
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(field);
});

it("a second request replaces the menu", () => {
  const { open } = showSender();
  const field = screen.getByRole("textbox", { name: "Field" });
  field.focus();
  open({ label: "Track", items: [{ id: "a", label: "Rename" }] });
  const first = screen.getByRole("menu", { name: "Track" });
  fireEvent.keyDown(first, { key: "End" });
  open({ label: "Clip", items: [{ id: "b", label: "Paste" }, { id: "c", label: "Remove" }] });
  expect(menus()).toHaveLength(1);
  expect(first.isConnected).toBe(false); // drawn afresh
  expect(screen.getByRole("menu", { name: "Clip" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Paste" }));
  // Focus still goes back to what had it before the first menu.
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(document.activeElement).toBe(field);
});

it("a press outside, a scroll and a resize close it", () => {
  vi.useFakeTimers();
  const { target } = show();

  fireEvent.contextMenu(target);
  fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Copy" }));
  fireEvent.scroll(screen.getByRole("menu"));
  expect(menus()).toHaveLength(1); // a press or a scroll inside keeps it
  fireEvent.pointerDown(document.body);
  expect(menus()).toHaveLength(0);
  act(() => vi.advanceTimersByTime(0));
  expect(document.activeElement).toBe(target); // nothing took the focus, so it comes back

  fireEvent.contextMenu(target);
  fireEvent.scroll(window);
  expect(menus()).toHaveLength(0);

  fireEvent.contextMenu(target);
  act(() => happyDOM().setViewport({ width: 900, height: 700 }));
  expect(menus()).toHaveLength(0);

  // Closed, it no longer listens: a press with nothing focused leaves focus where it is.
  target.blur();
  fireEvent.pointerDown(document.body);
  act(() => vi.advanceTimersByTime(0));
  expect(document.activeElement).toBe(document.body);
});

it("a press outside on something that takes focus keeps it", () => {
  vi.useFakeTimers();
  const { target, field } = show();
  fireEvent.contextMenu(target);
  fireEvent.pointerDown(field);
  field.focus();
  act(() => vi.advanceTimersByTime(0));
  expect(menus()).toHaveLength(0);
  expect(document.activeElement).toBe(field);
});

it("opened from the keyboard, the menu sits at the element", () => {
  const { target } = show();
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect(50, 60, 100, 40));
  fireEvent.contextMenu(target, { clientX: 0, clientY: 0 });
  const menu = screen.getByRole("menu");
  expect(menu.style.left).toBe("50px");
  expect(menu.style.top).toBe("100px");
  expect(menu.style.visibility).toBe("visible");
});

it("near the window's corner the menu opens to the left of and above the pointer", () => {
  const { target } = show();
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect(0, 0, 1024, 768));
  const real = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "menu" ? rect(0, 0, 200, 150) : real.call(this);
  });
  fireEvent.contextMenu(target, { clientX: 900, clientY: 700 });
  const menu = screen.getByRole("menu");
  expect(menu.style.left).toBe("700px");
  expect(menu.style.top).toBe("550px");
});

it("a menu with nothing enabled focuses the list, and Escape closes it", () => {
  const { target } = show({ items: [{ id: "paste", label: "Paste", disabled: true }] });
  fireEvent.contextMenu(target);
  const menu = screen.getByRole("menu", { name: "Clip" });
  expect(menu.getAttribute("tabindex")).toBe("-1");
  expect(document.activeElement).toBe(menu);
  fireEvent.keyDown(menu, { key: "ArrowDown" }); // nothing to move to
  expect(document.activeElement).toBe(menu);
  fireEvent.keyDown(menu, { key: "Escape" });
  expect(menus()).toHaveLength(0);
  expect(document.activeElement).toBe(target);
});

it("outside a provider there is no menu to ask for", () => {
  const seen: unknown[] = [];
  function Probe() {
    seen.push(useContextMenu());
    return null;
  }
  render(<Probe />);
  expect(seen.at(-1)).toBeNull();
  // Right-clicking such an element does nothing but keep the browser's menu shut.
  render(<Target />);
  expect(fireEvent.contextMenu(screen.getByRole("button", { name: "Target" }))).toBe(false);
  expect(menus()).toHaveLength(0);
});

it("a menu button still opens its list under itself, or above it near the bottom", () => {
  render(<Menu label="Edit" items={ITEMS} onSelect={() => {}} />);
  const trigger = screen.getByRole("button", { name: "Edit" });
  const box = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect(100, 20, 40, 28));
  fireEvent.click(trigger);
  const menu = screen.getByRole("menu", { name: "Edit" });
  expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
  expect([menu.style.top, menu.style.left]).toEqual(["52px", "100px"]);
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));
  expect(fireEvent.contextMenu(menu)).toBe(false);
  fireEvent.keyDown(menu, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);

  box.mockReturnValue(rect(100, 740, 40, 28));
  const real = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "menu" ? rect(0, 0, 200, 150) : real.call(this);
  });
  fireEvent.keyDown(trigger, { key: "ArrowUp" });
  const above = screen.getByRole("menu", { name: "Edit" });
  expect([above.style.top, above.style.left]).toEqual([`${740 - 4 - 150}px`, "100px"]);
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
});

describe("the timeline's right-click menus", () => {
  installTimelineStubs();

  const withMenus = { wrap: (timeline: ReactNode) => <ContextMenuProvider>{timeline}</ContextMenuProvider> };
  const BELOW = RULER_HEIGHT + 4 * ROW_HEIGHT + 20; // under the last of the four rows
  // Each item's text without its key hint.
  const labels = () =>
    screen.getAllByRole("menuitem").map((item) => {
      const copy = item.cloneNode(true) as HTMLElement;
      copy.querySelector("[data-shortcut]")?.remove();
      return copy.textContent;
    });
  const pick = (name: string) => fireEvent.click(screen.getByRole("menuitem", { name }));

  function setup(store = makeStore()) {
    const t = renderTimeline(store, withMenus);
    // Rows top to bottom: cap, t1, v1, a1.
    const lane = (row: number) => t.lanes[row];
    const content = t.scroller.firstElementChild as HTMLElement;
    const rightClick = (el: Element, clientX: number, clientY: number) => fireEvent.contextMenu(el, { clientX, clientY, button: 2 });
    // Copies c2 through its own menu.
    const copyC2 = () => {
      rightClick(t.clip("c2"), x(40), y(2));
      pick("Copy");
    };
    return { ...t, lane, content, rightClick, copyC2 };
  }

  it("right-clicking a clip opens its menu instead of the browser's", () => {
    const { clip } = setup();
    expect(fireEvent.contextMenu(clip("x2"), { clientX: 300, clientY: 200, button: 2 })).toBe(false);
    const menu = screen.getByRole("menu", { name: "Clip actions" });
    expect(labels()).toEqual(["Cut", "Copy", "Duplicate", "Split at the playhead", "Edit text", "Crop", "Reset crop", "Delete"]);
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
    // Hints follow the keys.
    expect(menu.querySelector("[data-shortcut]")?.textContent).toBe("Ctrl+X");
  });

  it("a right-click on a clip is not replaced by its row's menu", () => {
    const { clip } = setup();
    fireEvent.contextMenu(clip("c1"), { clientX: x(10), clientY: y(2), button: 2 });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu", { name: "Clip actions" })).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "Timeline" })).toBeNull();
  });

  it("an unselected clip becomes the selection; a clip in a selection keeps it", () => {
    const { st, clip, rightClick } = setup();
    act(() => st().select(["x1", "c1"]));
    rightClick(clip("c1"), x(10), y(2));
    expect(st().selection.clipIds).toEqual(["x1", "c1"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    rightClick(clip("x2"), x(100), y(1));
    expect(st().selection.clipIds).toEqual(["x2"]);
    // Never a toggle, even with a modifier held.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.contextMenu(clip("x2"), { clientX: x(100), clientY: y(1), button: 2, ctrlKey: true, shiftKey: true });
    expect(st().selection.clipIds).toEqual(["x2"]);
  });

  it("Delete from the menu removes the selected clips", () => {
    const { st, clip, rightClick } = setup();
    act(() => st().select(["x1", "c1"]));
    rightClick(clip("x1"), x(10), y(1));
    pick("Delete");
    expect(findClip(st().doc, "x1")).toBeNull();
    expect(findClip(st().doc, "c1")).toBeNull();
    expect(st().queue.map((e) => e.label)).toEqual(["delete"]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Split and Duplicate from the menu run as their keys do", () => {
    const { st, clip, rightClick } = setup();
    act(() => st().seek(45));
    rightClick(clip("c2"), x(40), y(2));
    pick("Split at the playhead");
    rightClick(clip("x2"), x(100), y(1));
    pick("Duplicate");
    expect(st().queue.map((e) => e.label)).toEqual(["split", "duplicate"]);
  });

  it("Reset crop from a clip's right-click menu removes its crop", () => {
    const doc = sampleDoc();
    doc.tracks[0].clips[1] = video("c2", 30, 30, { transform: { ...DEFAULT_TRANSFORM, crop: { left: 0.1, top: 0, right: 0.2, bottom: 0 } } });
    const { st, clip, rightClick } = setup(makeStore({ doc }));
    rightClick(clip("c2"), x(40), y(2));
    expect((screen.getByRole("menuitem", { name: "Reset crop" }) as HTMLButtonElement).disabled).toBe(false);
    pick("Reset crop");
    expect(st().queue.map((e) => e.label)).toEqual(["crop"]);
    expect(isCropped(findClip(st().doc, "c2")!.clip.transform.crop)).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    // Uncropped now: greyed.
    rightClick(clip("c2"), x(40), y(2));
    expect((screen.getByRole("menuitem", { name: "Reset crop" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Crop in a clip's menu selects the clip and arms the crop", () => {
    const { st, clip, rightClick } = setup();
    act(() => {
      st().seek(45);
      st().play();
    });
    rightClick(clip("c1"), x(10), y(2));
    pick("Crop");
    expect(st().notice?.text).toBe("Drag a handle to crop. Next time, you can hold Ctrl while you drag.");
    expect(st().selection.clipIds).toEqual(["c1"]);
    expect(st().cropArmed).toBe("c1");
    expect(st().playhead).toBe(0);
    expect(st().playing).toBe(false);
    expect(st().queue).toEqual([]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Crop keeps the playhead when it is inside the clip, and on a Mac says Option", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st, clip, rightClick } = setup();
    act(() => st().seek(29));
    rightClick(clip("c1"), x(10), y(2));
    pick("Crop");
    expect(st().notice?.text).toBe(MESSAGES.cropHintMac);
    expect(MESSAGES.cropHintMac).toBe("Drag a handle to crop. Next time, you can hold Control while you drag.");
    expect(st().playhead).toBe(29);
    expect(st().cropArmed).toBe("c1");
  });

  it("Edit text in a text clip's menu opens it for typing, paused, with the playhead in the clip", () => {
    const { st, clip, rightClick } = setup();
    act(() => {
      st().seek(45);
      st().play();
    });
    rightClick(clip("x2"), x(100), y(1));
    pick("Edit text");
    expect(st().textEditId).toBe("x2");
    expect(st().selection.clipIds).toEqual(["x2"]);
    expect(st().playhead).toBe(90);
    expect(st().playing).toBe(false);
    expect(st().queue).toEqual([]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape closes it and puts focus back on the clip", () => {
    const { clip, rightClick } = setup();
    rightClick(clip("x2"), x(100), y(1));
    expect(fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(clip("x2"));
  });

  it("on a Mac, Ctrl+click opens the menu and does not toggle", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { st, clip, lane, press, release } = setup();
    act(() => st().select(["x1"]));
    press(clip("x2"), x(100), y(1), { ctrlKey: true });
    release(x(100), y(1));
    expect(st().selection.clipIds).toEqual(["x1"]);
    fireEvent.contextMenu(clip("x2"), { clientX: x(100), clientY: y(1), button: 2, ctrlKey: true });
    expect(st().selection.clipIds).toEqual(["x2"]);
    expect(screen.getByRole("menu", { name: "Clip actions" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    // Nor does a Ctrl press on a row clear the selection.
    press(lane(2), x(200), y(2), { ctrlKey: true });
    expect(st().selection.clipIds).toEqual(["x2"]);
  });

  it("Paste from empty space lands where you right-clicked", () => {
    const { st, lane, rightClick, copyC2 } = setup();
    copyC2();
    expect(fireEvent.contextMenu(lane(2), { clientX: x(200), clientY: y(2), button: 2 })).toBe(false);
    expect(screen.getByRole("menu", { name: "Timeline" })).toBeTruthy();
    expect(labels()).toEqual(["Paste", "Duplicate track", "Remove track", "Add video track", "Add overlay track", "Add text track", "Add audio track"]);
    pick("Paste");
    const v1 = st().doc.tracks.find((t) => t.id === "v1")!;
    expect(v1.clips.map((c) => c.start)).toEqual([0, 30, 200]);
    expect(st().queue.map((e) => e.label)).toEqual(["paste"]);
    // The text track's row takes text, not video: the copy goes to Video 1 again. The frame is a whole one.
    rightClick(lane(1), x(300) + 1, y(1));
    pick("Paste");
    expect(st().doc.tracks.find((t) => t.id === "v1")!.clips.map((c) => c.start)).toEqual([0, 30, 200, 301]);
  });

  it("Paste is greyed with nothing copied", () => {
    const { lane, rightClick } = setup();
    rightClick(lane(2), x(200), y(2));
    expect((screen.getByRole("menuitem", { name: "Paste" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("right-clicking empty space on Video 1's row offers Remove track, which removes it", () => {
    const { st, lane, rightClick } = setup();
    rightClick(lane(2), x(200), y(2));
    pick("Remove track");
    expect(st().doc.tracks.some((t) => t.id === "v1")).toBe(false);
    expect(st().queue.map((e) => e.label)).toEqual(["remove track"]);
  });

  it("Duplicate track from empty space copies the row's track", () => {
    const { st, lane, rightClick } = setup();
    rightClick(lane(1), x(200), y(1));
    pick("Duplicate track");
    expect(st().doc.tracks.some((t) => t.name === "Text 1 copy")).toBe(true);
    expect(st().queue.map((e) => e.label)).toEqual(["duplicate track"]);
  });

  it("Add text track from empty space adds a text track", () => {
    const { st, lane, rightClick } = setup();
    rightClick(lane(2), x(200), y(2));
    pick("Add text track");
    expect(st().doc.tracks.filter((t) => t.kind === "text").map((t) => t.name)).toEqual(["Text 1", "Text 2"]);
    expect(st().queue.map((e) => e.label)).toEqual(["add track"]);
  });

  it("a right-click below the last row opens 'Timeline' without track entries, and Paste lands at that frame", () => {
    const { st, content, rightClick, copyC2 } = setup();
    copyC2();
    expect(fireEvent.contextMenu(content, { clientX: x(200), clientY: BELOW, button: 2 })).toBe(false);
    expect(screen.getByRole("menu", { name: "Timeline" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Remove track" })).toBeNull();
    expect(labels()).toEqual(["Paste", "Add video track", "Add overlay track", "Add text track", "Add audio track"]);
    pick("Paste");
    expect(st().doc.tracks.find((t) => t.id === "v1")!.clips.map((c) => c.start)).toEqual([0, 30, 200]);
    // Left of the lanes in view, it is their first frame in view.
    for (const lane of document.querySelectorAll<HTMLElement>("[data-lane]")) lane.getBoundingClientRect = () => rect(LANE_LEFT - 1000, 0, 2400, ROW_HEIGHT);
    rightClick(content, 100, BELOW);
    pick("Paste");
    expect(st().doc.tracks.find((t) => t.id === "v1")!.clips.map((c) => c.start)).toContain((1000 - (LANE_LEFT - 240)) / 2);
  });

  it("below the last row a paste has no wished track, so placement takes the top free row of its kind", () => {
    // Rows top to bottom: cap, t1, v2, v1; c2 was copied from v1, and v2 is free at 200.
    const doc = makeStore().getState().doc;
    const [v1, ...rest] = doc.tracks.filter((t) => t.kind !== "audio");
    doc.tracks = [v1, { id: "v2", kind: "video", name: "Video 2", muted: false, hidden: false, locked: false, clips: [] }, ...rest];
    const { st, content, rightClick, copyC2 } = setup(makeStore({ doc }));
    copyC2();
    rightClick(content, x(200), BELOW);
    pick("Paste");
    expect(st().doc.tracks.find((t) => t.id === "v2")!.clips.map((c) => c.start)).toEqual([200]);
    expect(st().doc.tracks.find((t) => t.id === "v1")!.clips.map((c) => c.start)).toEqual([0, 30]);
  });

  it("the rename field keeps the browser's menu, and its row opens none", () => {
    const { st } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Video 1" }));
    const field = screen.getByRole("textbox", { name: "Track name" });
    expect(fireEvent.contextMenu(field, { clientX: 60, clientY: y(2), button: 2 })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(field);
    expect(st().queue).toEqual([]);
  });

  it("outside a menu provider a right-click only keeps the browser's menu shut", () => {
    const { st, clip, lanes, scroller } = renderTimeline();
    expect(fireEvent.contextMenu(clip("x2"), { clientX: x(100), clientY: y(1), button: 2 })).toBe(false);
    expect(st().selection.clipIds).toEqual([]);
    expect(fireEvent.contextMenu(lanes[2], { clientX: x(200), clientY: y(2), button: 2 })).toBe(false);
    expect(fireEvent.contextMenu(scroller.firstElementChild!, { clientX: x(200), clientY: BELOW, button: 2 })).toBe(false);
    expect(fireEvent.contextMenu(screen.getByRole("button", { name: "Video 1" }), { clientX: 60, clientY: y(2), button: 2 })).toBe(false);
    expect(st().selection.trackId).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a right-click on the ruler opens no menu of the timeline's", () => {
    setup();
    fireEvent.contextMenu(screen.getByRole("slider", { name: "Playhead" }), { clientX: x(10), clientY: 10, button: 2 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a viewer's right-click on a clip offers only Copy; on a row it opens no menu and no browser menu", () => {
    const { st, clip, lane, content, rightClick } = setup(makeStore({ canEdit: false }));
    rightClick(clip("x2"), x(100), y(1));
    expect(labels()).toEqual(["Copy"]);
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(st().selection.clipIds).toEqual(["x2"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(rightClick(lane(2), x(200), y(2))).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(rightClick(content, x(200), BELOW)).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

it("a key while the menu is open runs nothing", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  try {
    const store = makeStore();
    store.getState().seek(45);
    render(
      <EditorProvider store={store}>
        <EditorScreen />
      </EditorProvider>,
    );
    const c2 = document.querySelector<HTMLElement>('[data-clip-id="c2"]')!;
    fireEvent.contextMenu(c2, { clientX: 5, clientY: 5, button: 2 });
    expect(screen.getByRole("menu", { name: "Clip actions" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "s" });
    expect(store.getState().queue).toEqual([]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(document.activeElement).toBe(c2);
    fireEvent.keyDown(c2, { key: "s" });
    expect(store.getState().queue.map((e) => e.label)).toEqual(["split"]);
  } finally {
    vi.unstubAllGlobals();
  }
});
