// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider } from "@/components/editor/media/media-context";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import { findClip } from "@/lib/editor/store";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

const NAMES = ["Add title", "Add subtitle", "Add lower third"];

function setup(canEdit = true) {
  const store = makeStore({ canEdit });
  render(<EditorProvider store={store}><ContextMenuProvider><LeftPanel /></ContextMenuProvider></EditorProvider>);
  return store;
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("offers three text presets that add a clip and are disabled for a viewer", () => {
  const store = setup();
  const buttons = NAMES.map((name) => screen.getByRole("button", { name }));
  for (const b of buttons) expect(b.hasAttribute("data-edit-control")).toBe(true);
  const texts = () => store.getState().doc.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").length;
  const before = texts();
  for (const b of buttons) fireEvent.click(b);
  expect(texts()).toBe(before + 3);
});

it("disables the preset buttons for a viewer", () => {
  const store = setup(false);
  for (const name of NAMES) {
    const b = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
  }
  expect(store.getState().queue).toEqual([]);
});

it("a text preset and a library image last the lengths from Settings", () => {
  const store = makeStore();
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, textSeconds: 5, stillSeconds: 4 } });
  const media = pretendMediaServices([assetView({ id: "i1", kind: "image", name: "logo", durationMs: null, fps: null, hasAudio: false })]);
  render(
    <EditorProvider store={store} settings={settings}>
      <MediaProvider services={media}>
        <LeftPanel />
      </MediaProvider>
    </EditorProvider>,
  );
  const added = () => findClip(store.getState().doc, store.getState().selection.clipIds[0])!.clip;
  fireEvent.click(screen.getByRole("button", { name: "Add title" }));
  expect(added()).toMatchObject({ type: "text", duration: 150 });
  // Read at the click: a change in Settings counts from the next one.
  act(() => settings.getState().set({ textSeconds: 2 }));
  fireEvent.click(screen.getByRole("button", { name: "Add subtitle" }));
  expect(added()).toMatchObject({ type: "text", duration: 60 });

  fireEvent.click(screen.getByRole("tab", { name: "Media" }));
  fireEvent.click(screen.getByRole("button", { name: "Add logo to the timeline" }));
  expect(added()).toMatchObject({ type: "image", assetId: "i1", duration: 120 });
});

it("shows the Media tab as loading when there is no provider", () => {
  setup();
  fireEvent.click(screen.getByRole("tab", { name: "Media" }));
  expect(screen.getByText("Loading media")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add title" })).toBeNull();
});

it("a text preset's right-click menu adds it at the playhead", () => {
  const store = makeStore();
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, textSeconds: 5 } });
  render(
    <EditorProvider store={store} settings={settings}>
      <ContextMenuProvider>
        <LeftPanel />
      </ContextMenuProvider>
    </EditorProvider>,
  );
  act(() => store.getState().seek(200));
  const title = screen.getByRole("button", { name: "Add title" });
  expect(fireEvent.contextMenu(title, { clientX: 10, clientY: 10, button: 2 })).toBe(false);
  const menu = screen.getByRole("menu", { name: "More for Title" });
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Add to timeline"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Add to timeline" }));
  expect(menu.isConnected).toBe(false);
  expect(store.getState().queue.map((e) => e.label)).toEqual(["add text"]);
  const added = findClip(store.getState().doc, store.getState().selection.clipIds[0])!.clip;
  expect(added).toMatchObject({ type: "text", start: 200, duration: 150 });
  expect(document.activeElement).toBe(title);
});

it("a viewer's right-click on a preset opens nothing", () => {
  setup(false);
  expect(fireEvent.contextMenu(screen.getByRole("button", { name: "Add title" }), { button: 2 })).toBe(false);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("on a Mac, Ctrl+click on a preset adds nothing", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const store = setup();
  fireEvent.click(screen.getByRole("button", { name: "Add title" }), { ctrlKey: true });
  expect(store.getState().queue).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Add title" }));
  expect(store.getState().queue.map((e) => e.label)).toEqual(["add text"]);
});
