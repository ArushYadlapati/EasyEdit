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
