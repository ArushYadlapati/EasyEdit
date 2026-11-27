// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/editor/brand/brand-context";
import { EditorProvider } from "@/components/editor/context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider } from "@/components/editor/media/media-context";
import { createMediaDrop } from "@/lib/editor/media-drop";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import { findClip } from "@/lib/editor/store";
import { cssFontFamily } from "@/lib/editor/fonts";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/types";
import { makeStore } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

const NAMES = ["Add title", "Add subtitle", "Add body text"];

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

function withDrop(options: { canEdit?: boolean; setUp?: boolean } = {}) {
  const store = makeStore({ canEdit: options.canEdit ?? true });
  const media = pretendMediaServices([]);
  media.library.setState({ setUp: options.setUp ?? true });
  const drop = createMediaDrop({ store, library: media.library, queue: media.queue });
  render(
    <EditorProvider store={store}>
      <MediaProvider services={media} drop={drop}>
        <LeftPanel />
      </MediaProvider>
    </EditorProvider>,
  );
  return { store, media, drop };
}

const selectedTab = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
const DRAG_LINE = "You can also drag files here, onto the timeline or onto the preview.";

it("a file over the window shows the Media tab and its drop text", () => {
  const { drop } = withDrop();
  expect(selectedTab()).toBe("Text");
  act(() => drop.setIncoming("files"));
  expect(selectedTab()).toBe("Media");
  expect(screen.getByText("Drop to upload")).toBeTruthy();
  expect(screen.getByRole("tabpanel").className).toContain("outline-ed-accent");
  // The panel stays on Media once the file has gone.
  act(() => drop.setIncoming(null));
  expect(selectedTab()).toBe("Media");
  expect(screen.queryByText("Drop to upload")).toBeNull();
  expect(screen.getByRole("tabpanel").className).not.toContain("outline-ed-accent");
  // A library item dragged in does not switch the tab.
  fireEvent.click(screen.getByRole("tab", { name: "Text" }));
  act(() => drop.setIncoming("asset"));
  expect(selectedTab()).toBe("Text");
});

it("without uploads set up the tab still switches, with no drop text", () => {
  const { drop } = withDrop({ setUp: false });
  act(() => drop.setIncoming("files"));
  expect(selectedTab()).toBe("Media");
  expect(screen.queryByText("Drop to upload")).toBeNull();
});

it("a viewer's Media tab shows no drop text", () => {
  const { drop } = withDrop({ canEdit: false });
  fireEvent.click(screen.getByRole("tab", { name: "Media" }));
  act(() => drop.setIncoming("files"));
  expect(screen.queryByText("Drop to upload")).toBeNull();
  expect(screen.getByRole("tabpanel").className).not.toContain("outline-ed-accent");
});

it("the Media tab says files can be dragged in", () => {
  withDrop();
  fireEvent.click(screen.getByRole("tab", { name: "Media" }));
  const line = screen.getByText(DRAG_LINE);
  expect(line.className).toBe("text-[13px] leading-5 text-ed-muted");
  // Under the Upload button.
  expect(line.previousElementSibling).toBe(screen.getByRole("button", { name: "Upload" }));
  cleanup();

  withDrop({ canEdit: false });
  fireEvent.click(screen.getByRole("tab", { name: "Media" }));
  expect(screen.queryByText(DRAG_LINE)).toBeNull();
  cleanup();

  withDrop({ setUp: false });
  fireEvent.click(screen.getByRole("tab", { name: "Media" }));
  expect(screen.queryByText(DRAG_LINE)).toBeNull();
});

it("Text tab buttons are drawn in the kit fonts and add text in them", () => {
  const store = makeStore({ canEdit: true });
  const initial = { ...DEFAULT_BRAND_KIT, fonts: { title: "Orbitron", subtitle: "Geist", body: "Inter" } };
  render(
    <EditorProvider store={store}>
      <BrandProvider spaceId="team1" canEdit initial={initial} api={{ fetch: vi.fn(), save: vi.fn() }}>
        <ContextMenuProvider><LeftPanel /></ContextMenuProvider>
      </BrandProvider>
    </EditorProvider>,
  );
  const title = screen.getByRole("button", { name: "Add title" });
  expect(title.style.fontFamily).toBe(cssFontFamily("Orbitron"));
  expect(screen.getByRole("button", { name: "Add body text" }).style.fontFamily).toBe(cssFontFamily("Inter"));
  fireEvent.click(title);
  const clip = findClip(store.getState().doc, store.getState().selection.clipIds[0])?.clip;
  expect(clip?.type === "text" && clip.style.fontFamily).toBe("Orbitron");
});

it("keeps its four tabs on one row: their names where there is room, else their icons, named either way", () => {
  setup();
  const list = screen.getByRole("tablist", { name: "Add" });
  expect(list.className).not.toMatch(/\bflex-wrap\b/);
  // The row is a container: under 13.5rem its tabs show icons and share it, from there their names.
  expect(list.parentElement!.className).toMatch(/@container/);
  expect(list.className).toMatch(/\[&_\[data-tab-label\]\]:hidden/);
  expect(list.className).toMatch(/@min-\[13\.5rem\]:\[&_\[data-tab-label\]\]:inline/);
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Text", "Media", "Captions", "Brand kit"]);
  for (const tab of tabs) {
    expect(tab.querySelector("[data-tab-icon] svg"), tab.textContent ?? "").not.toBeNull();
    expect(tab.querySelector("[data-tab-label]")!.textContent).toBe(tab.getAttribute("aria-label"));
  }
});
