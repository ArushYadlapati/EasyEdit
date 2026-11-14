// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { memoryTarget } from "@/lib/export/sinks";
import { act, fireEvent, screen } from "../helpers/dom";
import { click, dialog, emit, flush, show, startExport } from "./export-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MOD = () => (navigator.platform.startsWith("Mac") ? { metaKey: true } : { ctrlKey: true });
const exportDialog = () => screen.queryByText("Export", { selector: "h2" })?.closest("dialog") ?? null;

it("Cmd/Ctrl+E opens the export dialog and keeps the key from the browser", async () => {
  show();
  let passedOn = true;
  await act(async () => { passedOn = fireEvent.keyDown(document.body, { key: "e", ...MOD() }); });
  await flush();
  expect(passedOn).toBe(false); // false: preventDefault was called
  expect(exportDialog()?.open).toBe(true);
});

it("a viewer can export: nothing about it is an edit control", async () => {
  const { workers, target } = show({}, { canEdit: false });
  const button = screen.getByRole("button", { name: "Export" }) as HTMLButtonElement;
  expect([button.disabled, button.hasAttribute("data-edit-control")]).toEqual([false, false]);
  const d = await startExport();
  expect(exportDialog()!.querySelectorAll("[data-edit-control]")).toHaveLength(0);
  await emit(workers[0], { type: "done", bytes: 1_000, hasAudio: true });
  expect(d.getByRole("status").textContent).toContain("Saved Qual recap.mp4");
  expect(target.sinks[0].closed).toBe(1);
});

it("Export is off for a deleted project with no export running, by button and by key", async () => {
  const { store } = show();
  act(() => store.getState().setStatus("deleted"));
  expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { fireEvent.keyDown(document.body, { key: "e", ...MOD() }); });
  expect(exportDialog()).toBeNull();
});

it("announces the end of an export when the dialog is closed, and stays quiet when it is open", async () => {
  const closed = show();
  await startExport();
  await click("Close");
  await emit(closed.workers[0], { type: "done", bytes: 1_000, hasAudio: true });
  expect(closed.store.getState().notice).toMatchObject({ tone: "info", text: "Export saved as Qual recap.mp4." });
  closed.view.unmount();

  let saved: Blob | null = null;
  const memory = memoryTarget((blob) => { saved = blob; });
  const held = show({ savesToFile: false, pickTarget: async (name) => ({ target: memory, fileName: name, held: () => saved }) });
  await startExport();
  await click("Close");
  await emit(held.workers[0], { type: "chunk", seq: 0, position: 0, data: new Uint8Array([1]) });
  await emit(held.workers[0], { type: "done", bytes: 1, hasAudio: true });
  expect(held.store.getState().notice).toMatchObject({ tone: "info", text: "Export finished. Open Export to download it." });
  await click("Export");
  expect(dialog().getByRole("button", { name: "Download" })).toBeTruthy();
  held.view.unmount();

  vi.spyOn(console, "error").mockImplementation(() => {});
  const failed = show();
  await startExport();
  await click("Close");
  await emit(failed.workers[0], { type: "failed", code: "write", detail: "disk full" });
  expect(failed.store.getState().notice).toMatchObject({ tone: "error", text: "The file couldn't be saved. Check that the disk has room and try again." });
  failed.view.unmount();

  const open = show();
  await startExport();
  await emit(open.workers[0], { type: "done", bytes: 1_000, hasAudio: true });
  expect(open.store.getState().notice).toBeNull();
});

it("Export has its own row under General in Settings → Shortcuts, and switching it off frees the key", async () => {
  show();
  await click("Keyboard shortcuts");
  const toggle = screen.getByRole("switch", { name: "Shortcut for Export" });
  expect(screen.getByRole("button", { name: "Change the key for Export" })).toBeTruthy();
  await act(async () => { fireEvent.click(toggle); });
  await click("Close");
  let passedOn = false;
  await act(async () => { passedOn = fireEvent.keyDown(document.body, { key: "e", ...MOD() }); });
  await flush();
  expect(passedOn).toBe(true); // the browser gets the key
  expect(exportDialog()).toBeNull();
});

// Beyond the brief: each catches a rule the tests above leave free.

it("says nothing when an export is canceled, even with its dialog closed", async () => {
  const { store, view } = show();
  await startExport();
  await click("Close");
  await act(async () => { view.unmount(); });
  await flush();
  expect(store.getState().notice).toBeNull();
});

it("the Export button's tooltip is its name alone once its shortcut is off", async () => {
  show();
  await click("Keyboard shortcuts");
  await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Shortcut for Export" })); });
  await click("Close");
  expect(screen.getByRole("button", { name: "Export" }).getAttribute("title")).toBe("Export");
});
