// @vitest-environment happy-dom
import { Plus } from "lucide-react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Menu } from "@/components/ui/menu";
import { NumberInput } from "@/components/ui/number-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Splitter, type SplitterProps } from "@/components/ui/splitter";
import { Tabs } from "@/components/ui/tabs";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { Toggle } from "@/components/ui/toggle";
import { fireEvent, render, screen } from "../helpers/dom";

afterEach(() => vi.restoreAllMocks());

const ALIGN = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
] as const;

it("puts data-edit-control and disabled on the native control itself", () => {
  const { container } = render(
    <>
      <Button data-edit-control disabled>Remove</Button>
      <IconButton data-edit-control disabled label="Split">
        <Plus />
      </IconButton>
      <TextInput data-edit-control disabled aria-label="Name" />
      <NumberInput data-edit-control disabled ariaLabel="Size" value={1} onCommit={() => {}} />
      <TextArea data-edit-control disabled aria-label="Text" />
      <Select data-edit-control disabled aria-label="Weight">
        <option>400</option>
      </Select>
      <Toggle data-edit-control disabled label="Locked" checked={false} onChange={() => {}} />
      <Segmented data-edit-control disabled label="Align" value="left" options={[...ALIGN]} onChange={() => {}} />
      <Menu data-edit-control disabled label="Track options" icon={<Plus />} items={[]} onSelect={() => {}} />
    </>,
  );
  const marked = [...container.querySelectorAll<HTMLButtonElement>("[data-edit-control]")];
  expect(marked.map((el) => el.tagName)).toEqual(["BUTTON", "BUTTON", "INPUT", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "BUTTON", "BUTTON", "BUTTON"]);
  for (const el of marked) expect(el.disabled, el.outerHTML.slice(0, 80)).toBe(true);
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  expect(screen.getByRole("switch", { name: "Locked" }).hasAttribute("data-edit-control")).toBe(true);
});

it("a caller's onClick on Toggle and Segmented does not stop onChange", () => {
  const onClick = vi.fn();
  const onToggle = vi.fn();
  const onAlign = vi.fn();
  render(
    <>
      <Toggle label="Locked" checked={false} onChange={onToggle} onClick={onClick} />
      <Segmented label="Align" value="left" options={[...ALIGN]} onChange={onAlign} onClick={onClick} />
    </>,
  );
  fireEvent.click(screen.getByRole("switch", { name: "Locked" }));
  fireEvent.click(screen.getByRole("radio", { name: "Right" }));
  expect(onClick).toHaveBeenCalledTimes(2);
  expect(onToggle).toHaveBeenCalledWith(true);
  expect(onAlign).toHaveBeenCalledWith("right");
});

function DisablingMenu() {
  const [disabled, setDisabled] = useState(false);
  return (
    <>
      <Menu label="Track options" icon={<Plus />} items={[{ id: "rename", label: "Rename" }]} onSelect={() => {}} disabled={disabled} />
      <button type="button" onClick={() => setDisabled((d) => !d)}>
        Switch
      </button>
    </>
  );
}

it("a menu disabled while open stays closed when it is enabled again", () => {
  render(<DisablingMenu />);
  fireEvent.click(screen.getByRole("button", { name: "Track options" }));
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  expect(screen.queryByRole("menu")).toBeNull();
});

it("a dialog opens with focus on its marked field, text selected; with none marked the browser's choice stands", () => {
  // As a browser's showModal: the first control takes focus, here the header's Close.
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>("button, input")?.focus();
  });
  function Shown({ marked }: { marked: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog title="Rename" open={open} onClose={() => setOpen(false)}>
          <TextInput aria-label="Name" defaultValue="field" data-autofocus={marked || undefined} />
        </Dialog>
      </>
    );
  }
  const { unmount } = render(<Shown marked />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  const name = screen.getByLabelText("Name") as HTMLInputElement;
  expect(document.activeElement).toBe(name);
  expect([name.selectionStart, name.selectionEnd]).toEqual([0, 5]);
  unmount();

  render(<Shown marked={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
});

it("a dialog's bar sits between its header and its scrolling body, and its marked tab takes focus", () => {
  const tabs = [{ id: "a", label: "First" }, { id: "b", label: "Second" }];
  render(
    <Dialog title="Settings" open onClose={() => {}} bar={<Tabs label="Sections" value="b" tabs={tabs} onChange={() => {}} autoFocusSelected />}>
      <p>Body</p>
    </Dialog>,
  );
  const header = screen.getByRole("heading", { name: "Settings" }).closest("header")!;
  const bar = screen.getByRole("tablist").parentElement!;
  const body = screen.getByText("Body").parentElement!;
  expect([...header.parentElement!.children]).toEqual([header, bar, body]);
  expect(body.className).toContain("overflow-y-auto");
  expect(bar.className).not.toContain("overflow-y-auto");
  expect(screen.getByRole("tab", { name: "Second" }).hasAttribute("data-autofocus")).toBe(true);
  expect(screen.getByRole("tab", { name: "First" }).hasAttribute("data-autofocus")).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Second" }));
});

it("a dialog's footer stays under its scrolling body", () => {
  render(
    <Dialog title="New project" open onClose={() => {}} footer={<button>Create project</button>}>
      <p>Body</p>
    </Dialog>,
  );
  const header = screen.getByRole("heading", { name: "New project" }).closest("header")!;
  const body = screen.getByText("Body").parentElement!;
  const footer = screen.getByRole("button", { name: "Create project" }).parentElement!;
  expect([...header.parentElement!.children]).toEqual([header, body, footer]);
  expect(body.className).toContain("overflow-y-auto");
  expect(footer.className).not.toContain("overflow-y-auto");
  expect(footer.className.split(" ")).toEqual(
    expect.arrayContaining(["flex", "shrink-0", "items-center", "justify-end", "gap-2", "border-t", "border-ed-line", "px-4", "py-3"]),
  );
});

it("a large dialog takes most of the window", () => {
  const { unmount } = render(
    <Dialog title="New project" open onClose={() => {}} size="lg">
      <p>Body</p>
    </Dialog>,
  );
  const large = screen.getByRole("dialog");
  const classes = large.className.split(" ");
  expect(classes).toEqual(expect.arrayContaining(["w-[min(92vw,1120px,calc(100vw-32px))]", "h-[min(92vh,760px)]", "max-h-[min(92vh,760px)]"]));
  expect(classes).not.toContain("w-[min(32rem,calc(100vw-32px))]");
  expect(classes).not.toContain("max-h-[min(80vh,640px)]");
  expect(screen.getByText("Body").parentElement!.className.split(" ")).toContain("flex-1");
  unmount();

  render(
    <Dialog title="Rename" open onClose={() => {}}>
      <p>Body</p>
    </Dialog>,
  );
  const regular = screen.getByRole("dialog").className.split(" ");
  expect(regular).toEqual(expect.arrayContaining(["w-[min(32rem,calc(100vw-32px))]", "max-h-[min(80vh,640px)]"]));
  expect(regular).not.toContain("h-[min(92vh,760px)]");
  expect(screen.getByText("Body").parentElement!.className.split(" ")).not.toContain("flex-1");
});

it("tabs mark no tab for focus unless asked", () => {
  render(<Tabs label="Sections" value="a" tabs={[{ id: "a", label: "First" }]} onChange={() => {}} />);
  expect(screen.getByRole("tab", { name: "First" }).hasAttribute("data-autofocus")).toBe(false);
});

it("a splitter moves 16 px a key, 64 with Shift, and to its ends with Home and End", () => {
  function keysOn(over: Partial<SplitterProps>) {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { unmount } = render(
      <Splitter
        label="Left panel width"
        orientation="vertical"
        value={240}
        min={200}
        max={480}
        grow={1}
        controls="pane"
        onChange={onChange}
        onCommit={onCommit}
        onReset={() => {}}
        {...over}
      />,
    );
    const bar = screen.getByRole("separator", { name: "Left panel width" });
    const press = (key: string, extra: object = {}) => {
      onChange.mockClear();
      const notHandled = fireEvent.keyDown(bar, { key, ...extra });
      return { notHandled, value: onChange.mock.calls.at(-1)?.[0] as number | undefined };
    };
    return { bar, press, onCommit, unmount };
  }

  const vertical = keysOn({});
  expect(vertical.bar.className).toContain("cursor-col-resize");
  expect(vertical.bar.getAttribute("aria-orientation")).toBe("vertical");
  expect([vertical.bar.getAttribute("aria-valuenow"), vertical.bar.getAttribute("aria-valuemin"), vertical.bar.getAttribute("aria-valuemax")]).toEqual([
    "240",
    "200",
    "480",
  ]);
  expect(vertical.bar.getAttribute("aria-controls")).toBe("pane");
  expect(vertical.bar.tabIndex).toBe(0);
  expect(vertical.bar.hasAttribute("data-edit-control")).toBe(false);
  expect(vertical.press("ArrowRight")).toEqual({ notHandled: false, value: 256 });
  expect(vertical.press("ArrowRight", { shiftKey: true })).toEqual({ notHandled: false, value: 304 });
  expect(vertical.press("ArrowLeft")).toEqual({ notHandled: false, value: 224 });
  expect(vertical.press("Home")).toEqual({ notHandled: false, value: 200 });
  expect(vertical.press("End")).toEqual({ notHandled: false, value: 480 });
  expect(vertical.onCommit).toHaveBeenCalledTimes(5);
  expect(vertical.press("a")).toEqual({ notHandled: true, value: undefined });
  expect(vertical.press("ArrowDown")).toEqual({ notHandled: true, value: undefined });
  expect(vertical.onCommit).toHaveBeenCalledTimes(5);
  // A right-click opens nothing, not even the browser's menu.
  expect(fireEvent.contextMenu(vertical.bar)).toBe(false);
  vertical.unmount();

  const shrinking = keysOn({ grow: -1 });
  expect(shrinking.press("ArrowRight")).toEqual({ notHandled: false, value: 224 });
  expect(shrinking.press("ArrowLeft", { shiftKey: true })).toEqual({ notHandled: false, value: 304 });
  shrinking.unmount();

  const horizontal = keysOn({ orientation: "horizontal", grow: -1 });
  expect(horizontal.bar.className).toContain("cursor-row-resize");
  expect(horizontal.press("ArrowUp")).toEqual({ notHandled: false, value: 256 });
  expect(horizontal.press("ArrowDown")).toEqual({ notHandled: false, value: 224 });
  expect(horizontal.press("ArrowRight")).toEqual({ notHandled: true, value: undefined });
  horizontal.unmount();

  // Clamped to the bounds at either end.
  const nearEnd = keysOn({ value: 470 });
  expect(nearEnd.press("ArrowRight")).toEqual({ notHandled: false, value: 480 });
  nearEnd.unmount();
});

it("Escape during a splitter drag goes back to the start, then cancels, then ends the drag", () => {
  const calls: string[] = [];
  render(
    <Splitter
      label="Left panel width"
      orientation="vertical"
      value={240}
      min={200}
      max={480}
      grow={1}
      controls="pane"
      onChange={(px) => calls.push(`change ${px}`)}
      onCommit={() => calls.push("commit")}
      onReset={() => {}}
      onCancel={() => calls.push("cancel")}
      onDraggingChange={(dragging) => calls.push(`dragging ${dragging}`)}
    />,
  );
  const bar = screen.getByRole("separator", { name: "Left panel width" });
  fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 240 });
  fireEvent.pointerMove(bar, { pointerId: 1, clientX: 260 });
  expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
  expect(calls).toEqual(["dragging true", "change 260", "change 240", "cancel", "commit", "dragging false"]);
});

it("an inline edit opens focused with its text selected, and Enter, Escape and blur end it", () => {
  function editWith(extra: object = {}) {
    const onDone = vi.fn();
    const { unmount } = render(
      <InlineEdit defaultValue="Qual recap" label="Project name" maxLength={100} onDone={onDone} data-edit-control className="w-72" {...extra} />,
    );
    const input = screen.getByRole("textbox", { name: "Project name" }) as HTMLInputElement;
    return { input, onDone, unmount };
  }

  const opened = editWith();
  expect(document.activeElement).toBe(opened.input);
  expect([opened.input.selectionStart, opened.input.selectionEnd]).toEqual([0, 10]);
  expect(opened.input.maxLength).toBe(100);
  expect(opened.input.hasAttribute("data-edit-control")).toBe(true);
  expect(opened.input.className).toContain("w-72");
  fireEvent.change(opened.input, { target: { value: "Finals" } });
  expect(fireEvent.keyDown(opened.input, { key: "Enter" })).toBe(false);
  expect(opened.onDone.mock.calls).toEqual([["Finals", true]]);
  // The blur that follows a key does not end it a second time.
  fireEvent.blur(opened.input);
  expect(opened.onDone).toHaveBeenCalledTimes(1);
  opened.unmount();

  const escaped = editWith();
  fireEvent.change(escaped.input, { target: { value: "Finals" } });
  expect(fireEvent.keyDown(escaped.input, { key: "Escape" })).toBe(false);
  expect(escaped.onDone.mock.calls).toEqual([[null, true]]);
  // A key it does not handle is left to the browser.
  expect(fireEvent.keyDown(escaped.input, { key: "a" })).toBe(true);
  escaped.unmount();

  const blurred = editWith();
  fireEvent.change(blurred.input, { target: { value: "Finals" } });
  fireEvent.blur(blurred.input);
  expect(blurred.onDone.mock.calls).toEqual([["Finals", false]]);
  blurred.unmount();
});

it("Enter while composing does not save", () => {
  const onDone = vi.fn();
  render(<InlineEdit defaultValue="Qual recap" label="Project name" maxLength={100} onDone={onDone} />);
  const input = screen.getByRole("textbox", { name: "Project name" });
  expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(true);
  expect(fireEvent.keyDown(input, { key: "Escape", isComposing: true })).toBe(true);
  expect(onDone).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onDone).toHaveBeenCalledTimes(1);
});

it("a text menu button is named by its label", () => {
  render(<Menu label="Edit" items={[{ id: "undo", label: "Undo" }]} onSelect={() => {}} />);
  const trigger = screen.getByRole("button", { name: "Edit" });
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.textContent).toBe("Edit");
  expect(trigger.className.split(" ")).toEqual(expect.arrayContaining(["h-7", "rounded-md", "px-2", "text-xs", "font-medium", "text-ed-muted"]));
  expect(trigger.hasAttribute("data-edit-control")).toBe(false);
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("menu", { name: "Edit" })).toBeTruthy();
});

it("a text menu button can show other text, with a chevron, and keep its label as its name", () => {
  render(<Menu label="Preview zoom: Fill to size" text="Fill" title="Preview zoom" items={[{ id: "fill", label: "Fill to size" }]} onSelect={() => {}} />);
  const trigger = screen.getByRole("button", { name: "Preview zoom: Fill to size" });
  expect(trigger.getAttribute("aria-label")).toBe("Preview zoom: Fill to size");
  expect(trigger.textContent).toBe("Fill");
  expect(trigger.getAttribute("title")).toBe("Preview zoom");
  const chevron = trigger.querySelector("svg")!;
  expect(chevron.getAttribute("aria-hidden")).toBe("true");
  expect([chevron.getAttribute("width"), chevron.getAttribute("height")]).toEqual(["12", "12"]);
  expect(chevron.previousSibling?.textContent).toBe("Fill");
  fireEvent.click(trigger);
  expect(screen.getByRole("menu", { name: "Preview zoom: Fill to size" })).toBeTruthy();
});

it("a text menu button without text has no aria-label, no chevron, and only a shortcut's title", () => {
  const { rerender } = render(<Menu label="Edit" items={[]} onSelect={() => {}} />);
  const trigger = screen.getByRole("button", { name: "Edit" });
  expect(trigger.hasAttribute("aria-label")).toBe(false);
  expect(trigger.hasAttribute("title")).toBe(false);
  expect(trigger.querySelector("svg")).toBeNull();
  rerender(<Menu label="Edit" shortcut="E" items={[]} onSelect={() => {}} />);
  expect(trigger.getAttribute("title")).toBe("Edit (E)");
});

// eslint-disable-next-line @next/next/no-img-element -- the account menu's picture is a plain <img> from any host.
const PICTURE = <img src="https://x.test/a.png" alt="" />;

it("a text menu button can show a picture before its text", () => {
  render(
    <Menu
      label="Account"
      text="Ada Lovelace"
      lead={PICTURE}
      items={[{ id: "sign-out", label: "Sign out" }]}
      onSelect={() => {}}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Account" });
  expect(trigger.textContent).toContain("Ada Lovelace");
  const picture = trigger.querySelector("img")!;
  expect(picture.getAttribute("src")).toBe("https://x.test/a.png");
  expect(picture.compareDocumentPosition(trigger.querySelector("svg")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(trigger.firstChild).toBe(picture);
  expect(trigger.className.split(" ")).toContain("gap-1.5");
  fireEvent.click(picture);
  expect(screen.getByRole("menu", { name: "Account" })).toBeTruthy();
});

it("a text menu button without a lead keeps no gap", () => {
  render(<Menu label="Account" text="Ada Lovelace" items={[]} onSelect={() => {}} />);
  expect(screen.getByRole("button", { name: "Account" }).className.split(" ")).not.toContain("gap-1.5");
});

it("an icon menu button ignores a lead", () => {
  render(<Menu label="Track options" icon={<Plus />} lead={PICTURE} items={[]} onSelect={() => {}} />);
  expect(screen.getByRole("button", { name: "Track options" }).querySelector("img")).toBeNull();
});

it("radio items carry aria-checked and win over the checkbox role", () => {
  render(
    <Menu
      label="Zoom"
      items={[
        { id: "fill", label: "Fill to size", radio: true, checked: true },
        { id: "25", label: "25%", radio: true, checked: false, separatorBefore: true },
        { id: "50", label: "50%", radio: true },
      ]}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
  expect(screen.queryAllByRole("menuitemcheckbox")).toHaveLength(0);
  const radios = screen.getAllByRole("menuitemradio");
  expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  expect(document.activeElement).toBe(radios[0]);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(radios[1]);
  // The check column lines the labels up, and only the checked one draws the mark.
  const columns = [...screen.getByRole("menu").querySelectorAll("[data-check]")];
  expect(columns.map((c) => c.querySelector("svg") !== null)).toEqual([true, false, false]);
});

it("a menu's items are read when it opens", () => {
  let n = 0;
  const items = vi.fn(() => [{ id: "a", label: `Item ${++n}` }]);
  const onSelect = vi.fn();
  const { rerender } = render(<Menu label="Edit" items={items} onSelect={onSelect} />);
  expect(items).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(items).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("menuitem").textContent).toBe("Item 1");
  // Kept while open: a render does not read them again.
  rerender(<Menu label="Edit" items={items} onSelect={onSelect} />);
  expect(items).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("menuitem").textContent).toBe("Item 1");
  fireEvent.click(screen.getByRole("menuitem"));
  expect(onSelect).toHaveBeenCalledWith("a");
  // Opening again, here with the keyboard, reads them afresh.
  fireEvent.keyDown(screen.getByRole("button", { name: "Edit" }), { key: "ArrowDown" });
  expect(items).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("menuitem").textContent).toBe("Item 2");
});

it("a shortcut shows but is not part of the item's name", () => {
  render(
    <Menu
      label="Edit"
      items={[
        { id: "split", label: "Split", shortcut: "S", edit: true },
        { id: "copy", label: "Copy" },
      ]}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const split = screen.getByRole("menuitem", { name: "Split" });
  const hint = split.querySelector("[data-shortcut]") as HTMLElement;
  expect(hint.textContent).toBe("S");
  expect(hint.getAttribute("aria-hidden")).toBe("true");
  expect(hint.className.split(" ")).toEqual(expect.arrayContaining(["ml-auto", "text-ed-muted"]));
  expect(split.textContent).toBe("SplitS");
  // edit marks the item's button; an item without it is not marked.
  expect(split.hasAttribute("data-edit-control")).toBe(true);
  expect(screen.getByRole("menuitem", { name: "Copy" }).hasAttribute("data-edit-control")).toBe(false);
  // With no checkable item there is no check column.
  expect(screen.getByRole("menu").querySelector("[data-check]")).toBeNull();
});

it("checkbox items carry aria-checked", () => {
  render(
    <Menu
      label="View"
      items={[
        { id: "fit", label: "Fit the timeline" },
        { id: "snap", label: "Snapping", checked: true, separatorBefore: true },
        { id: "safe", label: "Safe zones", checked: false },
      ]}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  const snap = screen.getByRole("menuitemcheckbox", { name: "Snapping" });
  expect(snap.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("menuitemcheckbox", { name: "Safe zones" }).getAttribute("aria-checked")).toBe("false");
  const fit = screen.getByRole("menuitem", { name: "Fit the timeline" });
  expect(fit.hasAttribute("aria-checked")).toBe(false);
  // Every item has the 16 px check column, so the labels line up; only a checked one draws the mark.
  const columns = [...screen.getByRole("menu").querySelectorAll("[data-check]")];
  expect(columns).toHaveLength(3);
  for (const column of columns) expect(column.className.split(" ")).toContain("w-4");
  expect(columns.map((c) => c.querySelector("svg") !== null)).toEqual([false, true, false]);
  // The separator is a 1 px rule just before its item.
  const separator = screen.getByRole("separator");
  expect(separator.nextElementSibling).toBe(snap);
  expect(separator.className.split(" ")).toEqual(expect.arrayContaining(["h-px", "bg-ed-line"]));
  expect(screen.getAllByRole("separator")).toHaveLength(1);
});

it("arrow keys skip separators and disabled items", () => {
  render(
    <Menu
      label="Edit"
      items={[
        { id: "undo", label: "Undo" },
        { id: "redo", label: "Redo", disabled: true },
        { id: "cut", label: "Cut", separatorBefore: true },
        { id: "snap", label: "Snapping", checked: false, separatorBefore: true },
      ]}
      onSelect={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const menu = screen.getByRole("menu");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Undo" }));
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Cut" }));
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: "Snapping" }));
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Undo" }));
  fireEvent.keyDown(menu, { key: "ArrowUp" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: "Snapping" }));
  fireEvent.keyDown(menu, { key: "Home" });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Undo" }));
  fireEvent.keyDown(menu, { key: "End" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: "Snapping" }));
});
