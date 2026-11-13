// @vitest-environment happy-dom
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContextMenuProvider, menuPoint, placeAtPoint, useContextMenu, type ContextMenuRequest } from "@/components/ui/context-menu";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { act, fireEvent, render, screen } from "../helpers/dom";
import { happyDOM, rect } from "../helpers/layout";

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
