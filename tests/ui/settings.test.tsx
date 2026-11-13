// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import type { Keymap } from "@/lib/editor/keymap";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import type { EditorInit } from "@/lib/editor/types";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

afterEach(() => {
  vi.restoreAllMocks();
});

function show(over: Partial<EditorInit> = {}, keymap?: Keymap) {
  const store = makeStore(over);
  const save = { prefs: vi.fn(), keymap: vi.fn() };
  const settings = createSettingsStore({ prefs: DEFAULT_PREFS, keymap }, save);
  render(
    <EditorProvider store={store} settings={settings}>
      <EditorScreen />
    </EditorProvider>,
  );
  return { store, settings, save, st: () => store.getState() };
}

// The inspector behind the dialog has its own "Format" select, so every query looks inside Settings.
const dialog = () => within(screen.getByRole("dialog", { name: "Settings" }));
const openDialog = () => document.querySelector<HTMLDialogElement>("dialog[open]");
const tab = (name: string) => dialog().getByRole("tab", { name });
const selected = (name: string) => tab(name).getAttribute("aria-selected");
const gear = () => screen.getByRole("button", { name: "Settings" }) as HTMLButtonElement;
const format = () => dialog().getByRole("combobox", { name: "Format" }) as HTMLSelectElement;
const press = (target: Element, key: string, mods: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(target, { key, ...mods });

it("the gear opens Settings at Project with the format", () => {
  const { st } = show();
  expect(openDialog()).toBeNull();
  fireEvent.click(gear());
  expect(openDialog()).not.toBeNull();
  expect(dialog().getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(openDialog()!.classList.contains("h-[min(80vh,640px)]")).toBe(true); // the same height on every tab
  // The tabs stay put above the scrolling body.
  expect(dialog().getByRole("tablist").closest(".overflow-y-auto")).toBeNull();
  expect(dialog().getByRole("tabpanel").closest(".overflow-y-auto")).not.toBeNull();
  expect(selected("Project")).toBe("true");
  expect(document.activeElement).toBe(tab("Project"));
  expect(dialog().getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab("Project").id);
  expect(format().value).toBe("short_9x16");
  expect(format().hasAttribute("data-edit-control")).toBe(true);
  expect(dialog().getByText("Frame rate")).toBeTruthy();
  expect(dialog().getByText("30 fps")).toBeTruthy();
  fireEvent.change(format(), { target: { value: "long_16x9" } });
  expect(st().queue.map((e) => e.label)).toEqual(["format change"]);
  expect(st().doc.width).toBe(1920);
});

it("a viewer sees the format and cannot change it", () => {
  show({ canEdit: false });
  fireEvent.click(gear());
  expect(format().disabled).toBe(true);
  expect(dialog().getByText("Only editors can change the format.")).toBeTruthy();
  expect(dialog().queryByText("Changes this project for everyone who works on it.")).toBeNull();
  fireEvent.click(tab("General"));
  expect((dialog().getByRole("switch", { name: "Snapping" }) as HTMLButtonElement).disabled).toBe(false);
});

it("a deleted project's Settings still opens, and its format cannot change", () => {
  const { st } = show();
  act(() => st().setStatus("deleted"));
  expect(gear().disabled).toBe(false);
  fireEvent.click(gear());
  expect(format().disabled).toBe(true);
  expect(dialog().getByText("Only editors can change the format.")).toBeTruthy();
});

it("General sets the units, safe zones, snapping and lengths", () => {
  const { st, settings, save } = show();
  fireEvent.click(gear());
  fireEvent.click(tab("General"));
  expect(selected("General")).toBe("true");
  expect(dialog().getByRole("heading", { name: "Display" })).toBeTruthy();
  expect(dialog().getByRole("heading", { name: "Timeline" })).toBeTruthy();
  expect(dialog().getByText("Centimeters and inches count 96 pixels to the inch.")).toBeTruthy();
  expect(dialog().getByText("How long a new image or text clip lasts. Clips already on the timeline keep their length.")).toBeTruthy();

  expect(dialog().getByRole("radio", { name: "Pixels" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(dialog().getByRole("radio", { name: "Centimeters" }));
  expect(settings.getState().units).toBe("cm");
  expect(save.prefs).toHaveBeenCalledWith(expect.objectContaining({ units: "cm" }));
  expect(dialog().getByRole("radio", { name: "Centimeters" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(dialog().getByRole("radio", { name: "Inches" }));
  expect(settings.getState().units).toBe("in");

  const safeZones = dialog().getByRole("switch", { name: "Show safe zones" });
  expect(safeZones.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(safeZones);
  expect(st().showSafeZones).toBe(false);
  expect(safeZones.getAttribute("aria-checked")).toBe("false");
  const snapping = dialog().getByRole("switch", { name: "Snapping" });
  fireEvent.click(snapping);
  expect(st().snapping).toBe(false);
  expect(snapping.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(snapping);
  expect(st().snapping).toBe(true);

  const still = dialog().getByRole("textbox", { name: "Still image length" }) as HTMLInputElement;
  expect(still.value).toBe("3");
  fireEvent.change(still, { target: { value: "5" } });
  press(still, "Enter");
  expect(settings.getState().stillSeconds).toBe(5);
  const textLength = dialog().getByRole("textbox", { name: "Text clip length" }) as HTMLInputElement;
  fireEvent.change(textLength, { target: { value: "100" } });
  press(textLength, "Enter");
  expect(settings.getState().textSeconds).toBe(60);
  // Saved through clampSeconds: tenths of a second.
  fireEvent.change(still, { target: { value: "2.26" } });
  press(still, "Enter");
  expect(settings.getState().stillSeconds).toBe(2.3);
  fireEvent.change(still, { target: { value: "0.1" } });
  press(still, "Enter");
  expect(settings.getState().stillSeconds).toBe(0.5);
  press(still, "ArrowUp"); // in half seconds
  expect(settings.getState().stillSeconds).toBe(1);

  // A viewer's own preferences: nothing here is an edit control.
  expect(dialog().getByRole("tabpanel").querySelector("[data-edit-control]")).toBeNull();
});

it("each section says who it changes", () => {
  show();
  fireEvent.click(gear());
  const panel = () => dialog().getByRole("tabpanel");
  const firstLine = () => panel().querySelector("p")?.textContent;
  expect(firstLine()).toBe("Changes this project for everyone who works on it.");
  fireEvent.click(tab("General"));
  expect(firstLine()).toBe("Saved in this browser only.");
  fireEvent.click(tab("Shortcuts"));
  expect(firstLine()).toBe("Saved in this browser only.");
});

it("Keyboard shortcuts opens Settings at Shortcuts", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  expect(openDialog()).not.toBeNull();
  expect(selected("Shortcuts")).toBe("true");
  expect(document.activeElement).toBe(tab("Shortcuts"));
  for (const group of ["Playback", "Editing", "Timeline", "General", "Preview"]) {
    expect(dialog().getByRole("heading", { name: group })).toBeTruthy();
  }
  expect(openDialog()!.querySelectorAll("kbd").length).toBeGreaterThan(30);
});

// The keys of the row with this label, as shown.
function keysOf(scope: HTMLElement, label: string): string[] {
  const row = within(scope).getByText(label).closest("li")!;
  return [...row.querySelectorAll("kbd")].map((kbd) => kbd.textContent ?? "");
}

it("the Shortcuts list shows the keys chosen in this browser", () => {
  show({}, { on: true, keys: { split: ["Mod+Shift+S"], cut: [] }, off: [] });
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  const panel = dialog().getByRole("tabpanel");
  expect(keysOf(panel, "Split at the playhead")).toEqual(["Ctrl+Shift+S"]);
  expect(keysOf(panel, "Redo")).toEqual(["Ctrl+Shift+Z", "Ctrl+Y"]);
  expect(within(panel).getByText("Redo").closest("li")!.textContent).toBe("RedoCtrl+Shift+ZorCtrl+Y");
  expect(keysOf(panel, "Cut")).toEqual([]);
  expect(within(panel).getByText("Cut").closest("li")!.textContent).toBe("CutNo key");
  expect(keysOf(panel, "Delete and close the gap")).toEqual(["Shift+Del", "Shift+Backspace"]);
});

const PREVIEW_ROWS: [string, string[]][] = [
  ["Move along one line", ["Shift", "drag a clip"]],
  ["Keep the shape while resizing", ["Shift", "drag a handle"]],
  ["Crop instead of resizing", ["Alt", "drag a handle"]],
  ["Turn in 15° steps", ["Shift", "drag the turn handle"]],
  ["Type in place", ["double-click text"]],
];

function previewGroup(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  return dialog().getByRole("heading", { name: "Preview" }).closest("section")!;
}

it("the Preview group lists the mouse keys", () => {
  show();
  const group = previewGroup();
  expect(within(group).getAllByRole("listitem")).toHaveLength(PREVIEW_ROWS.length);
  for (const [label, keys] of PREVIEW_ROWS) expect(keysOf(group, label)).toEqual(keys);
  expect(within(group).queryAllByRole("switch")).toEqual([]);
  expect(within(group).queryAllByRole("button")).toEqual([]);
});

it("on a Mac the Preview group writes Alt as ⌥", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  show();
  expect(keysOf(previewGroup(), "Crop instead of resizing")).toEqual(["⌥", "drag a handle"]);
});

it("the gear opens the section shown last", () => {
  show();
  press(document.body, "?", { shiftKey: true });
  expect(selected("Shortcuts")).toBe("true");
  press(tab("Shortcuts"), "Escape");
  expect(openDialog()).toBeNull();
  fireEvent.click(gear());
  expect(selected("Shortcuts")).toBe("true");
  // A tab chosen inside the dialog counts too, by click or by arrow key.
  fireEvent.click(tab("General"));
  press(tab("General"), "Escape");
  fireEvent.click(gear());
  expect(selected("General")).toBe("true");
  press(tab("General"), "ArrowLeft");
  expect(selected("Project")).toBe("true");
  fireEvent.click(dialog().getByRole("button", { name: "Close" }));
  fireEvent.click(gear());
  expect(selected("Project")).toBe("true");
});

// Settings → Shortcuts, the playhead at 45 on c2 and nothing selected.
function showShortcuts(keymap?: Keymap, over: Partial<EditorInit> = {}) {
  const shown = show(over, keymap);
  act(() => shown.st().seek(45));
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  return shown;
}

const SPLIT = "Split at the playhead";
const keyButton = (label: string) => dialog().getByRole("button", { name: `Change the key for ${label}` });
const recorder = (label: string) => dialog().getByRole("button", { name: `Press the new key for ${label}` });
const rowSwitch = (label: string) => dialog().getByRole("switch", { name: `Shortcut for ${label}` }) as HTMLButtonElement;
const rowOf = (label: string) => dialog().getByText(label).closest("li")!;
const statusOf = (label: string) => within(rowOf(label)).getByRole("status");
const dimmed = (label: string) => [...rowOf(label).querySelectorAll("kbd")].map((kbd) => kbd.classList.contains("opacity-40"));
const closeSettings = () => fireEvent.click(dialog().getByRole("button", { name: "Close" }));

it("recording a new key for Split", () => {
  const { st, settings, save } = showShortcuts();
  fireEvent.click(keyButton(SPLIT));
  expect(recorder(SPLIT).textContent).toBe("Press a key");
  expect(document.activeElement).toBe(recorder(SPLIT));
  // A modifier alone keeps waiting for the key.
  expect(press(recorder(SPLIT), "Control", { ctrlKey: true })).toBe(false);
  // So do a held key's repeats and a key still being composed.
  expect(press(recorder(SPLIT), "x", { repeat: true })).toBe(false);
  expect(press(recorder(SPLIT), "x", { isComposing: true })).toBe(false);
  expect(recorder(SPLIT)).toBeTruthy();
  expect(settings.getState().keymap.keys).toEqual({});
  expect(fireEvent.keyDown(recorder(SPLIT), { key: "S", code: "KeyS", ctrlKey: true, shiftKey: true })).toBe(false);
  expect(settings.getState().keymap.keys.split).toEqual(["Mod+Shift+S"]);
  expect(save.keymap).toHaveBeenCalledWith(expect.objectContaining({ keys: { split: ["Mod+Shift+S"] } }));
  expect(document.activeElement).toBe(keyButton(SPLIT));
  expect(keysOf(dialog().getByRole("tabpanel"), SPLIT)).toEqual(["Ctrl+Shift+S"]);
  closeSettings();
  expect(press(document.body, "s")).toBe(true);
  expect(st().queue).toEqual([]);
  expect(press(document.body, "S", { ctrlKey: true, shiftKey: true })).toBe(false);
  expect(st().queue.map((e) => e.label)).toEqual(["split"]);
});

it("a key in use asks before taking it", () => {
  const { settings } = showShortcuts();
  fireEvent.click(keyButton(SPLIT));
  expect(press(recorder(SPLIT), "n")).toBe(false);
  expect(within(statusOf(SPLIT)).getByText("N is used by Snapping on or off.")).toBeTruthy();
  expect(settings.getState().keymap.keys).toEqual({});
  const useIt = within(statusOf(SPLIT)).getByRole("button", { name: "Use it here" });
  expect(document.activeElement).toBe(useIt);
  fireEvent.click(useIt);
  expect(settings.getState().keymap.keys).toEqual({ split: ["N"], "toggle-snapping": [] });
  expect(keyButton("Snapping on or off").textContent).toBe("No key");
  expect(keysOf(dialog().getByRole("tabpanel"), SPLIT)).toEqual(["N"]);
  expect(statusOf(SPLIT).textContent).toBe("");
  expect(document.activeElement).toBe(keyButton(SPLIT));
});

it("Cancel, or Escape, leaves a key in use where it was", () => {
  const { settings, save } = showShortcuts();
  const before = settings.getState().keymap;
  fireEvent.click(keyButton(SPLIT));
  press(recorder(SPLIT), "n");
  fireEvent.click(within(statusOf(SPLIT)).getByRole("button", { name: "Cancel" }));
  expect(settings.getState().keymap).toBe(before);
  expect(statusOf(SPLIT).textContent).toBe("");
  expect(document.activeElement).toBe(keyButton(SPLIT));
  // Escape while the question shows is Cancel, and Settings stays open.
  fireEvent.click(keyButton(SPLIT));
  press(recorder(SPLIT), "n");
  const useIt = within(statusOf(SPLIT)).getByRole("button", { name: "Use it here" });
  expect(press(useIt, "Escape")).toBe(false);
  expect(openDialog()).not.toBeNull();
  expect(statusOf(SPLIT).textContent).toBe("");
  expect(settings.getState().keymap).toBe(before);
  expect(document.activeElement).toBe(keyButton(SPLIT));
  expect(save.keymap).not.toHaveBeenCalled();
});

it("Escape while recording cancels recording and leaves Settings open", () => {
  const { settings, save } = showShortcuts();
  const before = settings.getState().keymap;
  fireEvent.click(keyButton(SPLIT));
  expect(press(recorder(SPLIT), "Escape")).toBe(false);
  expect(openDialog()).not.toBeNull();
  expect(settings.getState().keymap).toBe(before);
  expect(save.keymap).not.toHaveBeenCalled();
  expect(keyButton(SPLIT).textContent).toBe("S");
  expect(statusOf(SPLIT).textContent).toBe(""); // ended, not refused
  expect(document.activeElement).toBe(keyButton(SPLIT));
  press(keyButton(SPLIT), "Escape");
  expect(openDialog()).toBeNull();
});

it("Tab while recording cancels and moves on", () => {
  const { settings } = showShortcuts();
  const before = settings.getState().keymap;
  fireEvent.click(keyButton(SPLIT));
  expect(press(recorder(SPLIT), "Tab")).toBe(true);
  expect(keyButton(SPLIT).textContent).toBe("S");
  expect(settings.getState().keymap).toBe(before);
});

it("moving away while recording cancels it", () => {
  const { settings } = showShortcuts();
  const before = settings.getState().keymap;
  fireEvent.click(keyButton(SPLIT));
  fireEvent.blur(recorder(SPLIT));
  expect(keyButton(SPLIT).textContent).toBe("S");
  expect(press(keyButton(SPLIT), "n")).toBe(true);
  expect(settings.getState().keymap).toBe(before);
});

it("a browser key is refused with a reason", () => {
  const { settings } = showShortcuts();
  const before = settings.getState().keymap;
  fireEvent.click(keyButton(SPLIT));
  expect(press(recorder(SPLIT), "r", { code: "KeyR", ctrlKey: true })).toBe(false);
  expect(statusOf(SPLIT).textContent).toBe("That key belongs to the browser. Pick another key.");
  expect(settings.getState().keymap).toBe(before);
  expect(document.activeElement).toBe(keyButton(SPLIT));
  // The next recording starts afresh.
  fireEvent.click(keyButton(SPLIT));
  expect(statusOf(SPLIT).textContent).toBe("");
});

it("turning one shortcut off", () => {
  const { st, settings } = showShortcuts();
  expect(rowSwitch(SPLIT).getAttribute("aria-checked")).toBe("true");
  expect(dimmed(SPLIT)).toEqual([false]);
  fireEvent.click(rowSwitch(SPLIT));
  expect(settings.getState().keymap.off).toEqual(["split"]);
  expect(rowSwitch(SPLIT).getAttribute("aria-checked")).toBe("false");
  expect(dimmed(SPLIT)).toEqual([true]);
  expect(dimmed("Copy")).toEqual([false]);
  closeSettings();
  expect(press(document.body, "s")).toBe(true);
  expect(st().queue).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("menuitem", { name: "Split" }).querySelector("[data-shortcut]")).toBeNull();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  // On again, with its key.
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  fireEvent.click(rowSwitch(SPLIT));
  expect(settings.getState().keymap.off).toEqual([]);
});

it("turning all shortcuts off", () => {
  const { st, settings } = showShortcuts();
  const all = dialog().getByRole("switch", { name: "Use keyboard shortcuts" });
  expect(all.getAttribute("aria-checked")).toBe("true");
  // Above the groups.
  expect(all.compareDocumentPosition(dialog().getByRole("heading", { name: "Playback" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(rowSwitch(SPLIT).disabled).toBe(false);
  fireEvent.click(all);
  expect(settings.getState().keymap.on).toBe(false);
  expect(all.getAttribute("aria-checked")).toBe("false");
  expect(rowSwitch(SPLIT).disabled).toBe(true);
  expect(rowSwitch(SPLIT).getAttribute("aria-checked")).toBe("true");
  expect(dimmed(SPLIT)).toEqual([true]);
  expect(dimmed("Redo")).toEqual([true, true]);
  closeSettings();
  expect(press(document.body, " ")).toBe(true);
  expect(st().playing).toBe(false);
  expect(screen.getByRole("button", { name: "Split" }).getAttribute("title")).toBe("Split");
});

it("Escape stays with Clear the selection", () => {
  const { settings } = showShortcuts();
  expect(dialog().queryByRole("button", { name: "Change the key for Clear the selection" })).toBeNull();
  expect(keysOf(dialog().getByRole("tabpanel"), "Clear the selection")).toEqual(["Escape"]);
  fireEvent.click(rowSwitch("Clear the selection"));
  expect(settings.getState().keymap.off).toEqual(["clear-selection"]);
  expect(dimmed("Clear the selection")).toEqual([true]);
});

it("Restore default keys brings the default keys back and keeps the master switch", () => {
  const { settings } = showShortcuts({ on: false, keys: { split: ["Mod+Shift+S"] }, off: ["copy"] });
  const restore = () => dialog().getByRole("button", { name: "Restore default keys" }) as HTMLButtonElement;
  expect(restore().compareDocumentPosition(dialog().getByRole("heading", { name: "Playback" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(restore().disabled).toBe(false);
  fireEvent.click(restore());
  expect(settings.getState().keymap).toEqual({ on: false, keys: {}, off: [] });
  expect(restore().disabled).toBe(true);
  expect(keyButton(SPLIT).textContent).toBe("S");
  expect(dialog().getByRole("switch", { name: "Use keyboard shortcuts" }).getAttribute("aria-checked")).toBe("false");
});

it("a viewer changes their own keys, and nothing here is marked", () => {
  const { settings } = showShortcuts(undefined, { canEdit: false });
  expect(dialog().getByRole("tabpanel").querySelector("[data-edit-control]")).toBeNull();
  expect(rowSwitch(SPLIT).disabled).toBe(false);
  fireEvent.click(keyButton(SPLIT));
  press(recorder(SPLIT), "x");
  expect(settings.getState().keymap.keys).toEqual({ split: ["X"] });
});
