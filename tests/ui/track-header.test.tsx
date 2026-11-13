// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorProvider, useEditor } from "@/components/editor/context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { Toolbar } from "@/components/editor/timeline/toolbar";
import { TrackHeader } from "@/components/editor/timeline/track-header";
import { displayRows } from "@/lib/editor/geometry";
import { LIMITS } from "@/lib/limits";
import type { Op, Track } from "@/lib/timeline";
import { entry, makeStore, sampleDoc } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";

// One track's header, re-rendered from the store as the track changes.
function Header({ id }: { id: string }) {
  const track = useEditor((s) => s.doc.tracks.find((t) => t.id === id));
  return track ? <TrackHeader track={track} selected={false} /> : null;
}

function setup(id = "t1", store = makeStore(), others: string[] = []) {
  const view = render(
    <EditorProvider store={store}>
      <ContextMenuProvider>
        <Header id={id} />
        {others.map((other) => (
          <Header key={other} id={other} />
        ))}
      </ContextMenuProvider>
    </EditorProvider>,
  );
  const track = () => store.getState().doc.tracks.find((t) => t.id === id) as Track;
  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Track options" }));
  const item = (name: string) => screen.getByRole("menuitem", { name }) as HTMLButtonElement;
  const startRename = () => {
    openMenu();
    fireEvent.click(item("Rename"));
    return screen.getByRole("textbox", { name: "Track name" }) as HTMLInputElement;
  };
  return { store, view, track, openMenu, item, startRename };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// A track's header element, found from its name.
const headerOf = (name: string) => screen.getByRole("button", { name }).parentElement as HTMLElement;
const rightClick = (el: Element) => fireEvent.contextMenu(el, { clientX: 20, clientY: 10, button: 2 });

describe("track header", () => {
  it("renames from the menu: the input takes focus, Enter saves and is marked handled", () => {
    const { store, track, startRename } = setup();
    const input = startRename();
    expect(document.activeElement).toBe(input);
    expect(input.maxLength).toBe(LIMITS.trackNameChars);
    fireEvent.change(input, { target: { value: "Titles" } });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false); // false: defaultPrevented
    expect(track().name).toBe("Titles");
    expect(store.getState().queue.map((e) => e.label)).toEqual(["rename track"]);
    expect(screen.queryByRole("textbox", { name: "Track name" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Titles" }));
  });

  it("Escape cancels a rename and is marked handled", () => {
    const { store, track, startRename } = setup();
    const input = startRename();
    fireEvent.change(input, { target: { value: "Titles" } });
    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(false);
    expect(track().name).toBe("Text 1");
    expect(store.getState().queue).toEqual([]);
    expect(screen.queryByRole("textbox", { name: "Track name" })).toBeNull();
  });

  it("a blank name keeps the old one and makes no change", () => {
    const { store, track, startRename } = setup();
    const input = startRename();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(track().name).toBe("Text 1");
    expect(store.getState().queue).toEqual([]);
  });

  it("clicking a track's name opens its field and selects the track", () => {
    const { store, track } = setup();
    const name = screen.getByRole("button", { name: "Text 1" });
    expect(name.hasAttribute("data-edit-control")).toBe(false);
    expect(name.className).toContain("w-fit");
    expect(name.className).toContain("max-w-full");
    fireEvent.click(name);
    const input = screen.getByRole("textbox", { name: "Track name" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Text 1".length]);
    expect(input.hasAttribute("data-edit-control")).toBe(true);
    expect(input.maxLength).toBe(LIMITS.trackNameChars);
    expect(store.getState().selection.trackId).toBe("t1");
    fireEvent.change(input, { target: { value: "Titles" } });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(store.getState().queue.map((e) => e.label)).toEqual(["rename track"]);
    expect(track().name).toBe("Titles");
    expect(screen.queryByRole("textbox", { name: "Track name" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Titles" }));
  });

  it("a viewer's click on the name only selects the track", () => {
    const { store } = setup("t1", makeStore({ canEdit: false }));
    fireEvent.click(screen.getByRole("button", { name: "Text 1" }));
    expect(screen.queryByRole("textbox", { name: "Track name" })).toBeNull();
    expect(store.getState().selection.trackId).toBe("t1");
  });

  it("a click beside the name selects without opening the field", () => {
    const { store, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lock track" }));
    expect(store.getState().selection.trackId).toBeNull(); // a button in the header is not the background
    const header = view.container.firstElementChild as HTMLElement;
    const spacer = screen.getByRole("button", { name: "Text 1" }).nextElementSibling as HTMLElement;
    expect(spacer.tagName).not.toBe("BUTTON");
    expect(spacer.className).toContain("flex-1");
    fireEvent.click(spacer);
    expect(store.getState().selection.trackId).toBe("t1");
    act(() => store.getState().selectTrack(null));
    fireEvent.click(header);
    expect(store.getState().selection.trackId).toBe("t1");
    expect(screen.queryByRole("textbox", { name: "Track name" })).toBeNull();
  });

  it("a click in the open field or on the options popup keeps the clip selection", () => {
    const { store, openMenu, startRename } = setup();
    act(() => store.getState().select(["x1", "c1"]));
    openMenu();
    fireEvent.click(screen.getByRole("menu")); // the popup's own box, between its items
    expect(store.getState().selection).toMatchObject({ clipIds: ["x1", "c1"], trackId: null });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Rename" }), { key: "Escape" });
    const input = startRename();
    fireEvent.click(input); // placing the caret
    expect(store.getState().selection).toMatchObject({ clipIds: ["x1", "c1"], trackId: null });
    expect(screen.getByRole("textbox", { name: "Track name" })).toBe(input);
  });

  it("Enter while composing does not save", () => {
    const { store, track } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Text 1" }));
    const input = screen.getByRole("textbox", { name: "Track name" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Titles" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByRole("textbox", { name: "Track name" })).toBe(input);
    expect(track().name).toBe("Text 1");
    expect(store.getState().queue).toEqual([]);
  });

  it("the lock switch keeps its name and shows whether it is on", () => {
    const { track } = setup();
    const lock = screen.getByRole("button", { name: "Lock track" });
    expect(lock.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(lock);
    expect(track().locked).toBe(true);
    expect(screen.getByRole("button", { name: "Lock track" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide track" }));
    expect(track().hidden).toBe(true);
    expect(screen.getByRole("button", { name: "Hide track" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Remove track is disabled while the track is locked", () => {
    const { track, openMenu, item } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lock track" }));
    openMenu();
    expect(item("Remove track (unlock first)").disabled).toBe(true);
    fireEvent.keyDown(item("Rename"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Lock track" }));
    openMenu();
    fireEvent.click(item("Remove track"));
    expect(track()).toBeUndefined();
  });

  it("Move up is disabled for the top row of its group", () => {
    for (const [id, up, down] of [["cap", true, false], ["t1", false, false], ["a1", true, true]] as const) {
      const { view, openMenu, item } = setup(id);
      openMenu();
      expect([item("Move up").disabled, item("Move down").disabled], id).toEqual([up, down]);
      view.unmount();
    }
  });

  it("the track options list Duplicate, which adds 'Text 1 copy' above the track", () => {
    const { store, openMenu, item } = setup();
    openMenu();
    expect(screen.getAllByRole("menuitem").map((e) => e.textContent)).toEqual(["Rename", "Duplicate", "Move up", "Move down", "Remove track"]);
    expect((screen.getByRole("separator").nextElementSibling as HTMLElement).textContent).toBe("Remove track");
    for (const menuItem of screen.getAllByRole("menuitem")) expect(menuItem.hasAttribute("data-edit-control"), menuItem.textContent!).toBe(true);
    fireEvent.click(item("Duplicate"));
    const { doc, selection, queue } = store.getState();
    const copy = doc.tracks[2];
    expect(copy).toMatchObject({ kind: "text", name: "Text 1 copy" });
    expect(copy.clips).toHaveLength(2);
    expect(displayRows(doc).map((t) => t.id)).toEqual(["cap", copy.id, "t1", "v1", "a1"]);
    expect(selection).toEqual({ clipIds: [], trackId: copy.id });
    expect(queue.map((e) => e.label)).toEqual(["duplicate track"]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the header's right-click menu lists the track's actions", () => {
    const { store } = setup();
    expect(rightClick(headerOf("Text 1"))).toBe(false);
    expect(screen.getByRole("menu", { name: "Track options" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem").map((e) => e.textContent)).toEqual(["Rename", "Duplicate", "Move up", "Move down", "Remove track"]);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    const { doc, queue } = store.getState();
    const copy = doc.tracks.find((t) => t.name === "Text 1 copy")!;
    expect(displayRows(doc).map((t) => t.id)).toEqual(["cap", copy.id, "t1", "v1", "a1"]);
    expect(queue.map((e) => e.label)).toEqual(["duplicate track"]);
    expect(screen.queryByRole("menu")).toBeNull();
    // Focus goes back to the track's name.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Text 1" }));
  });

  it("Move up, Move down and Remove track from the header's right-click menu", () => {
    const { store, track } = setup("v1");
    rightClick(headerOf("Video 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(displayRows(store.getState().doc).map((t) => t.id)).toEqual(["cap", "v1", "t1", "a1"]);
    rightClick(headerOf("Video 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    rightClick(headerOf("Video 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove track" }));
    expect(track()).toBeUndefined();
    expect(store.getState().queue.map((e) => e.label)).toEqual(["reorder tracks", "reorder tracks", "remove track"]);
  });

  it("a right-click on another track's header selects that track before its menu opens", () => {
    const { store } = setup("t1", makeStore(), ["v1"]);
    act(() => store.getState().select(["x1"]));
    rightClick(headerOf("Text 1"));
    expect(store.getState().selection).toEqual({ clipIds: [], trackId: "t1" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    rightClick(headerOf("Video 1"));
    expect(store.getState().selection.trackId).toBe("v1");
    // The menu is the selected track's.
    expect(screen.getByRole("menuitem", { name: "Move down" })).toHaveProperty("disabled", true);
  });

  it("Rename from the header's right-click menu keeps its field focused", () => {
    const { store, track } = setup();
    rightClick(headerOf("Text 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Track name" });
    expect(document.activeElement).toBe(input);
    // The browser's own menu is left to the field.
    expect(rightClick(input)).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Titles" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(track().name).toBe("Titles");
    expect(store.getState().queue.map((e) => e.label)).toEqual(["rename track"]);
  });

  it("on a Mac, Ctrl+click on a track's name opens its menu and no field", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { store } = setup();
    const name = screen.getByRole("button", { name: "Text 1" });
    fireEvent.pointerDown(name, { button: 0, ctrlKey: true });
    fireEvent.click(name, { ctrlKey: true });
    expect(screen.queryByRole("textbox", { name: "Track name" })).toBeNull();
    expect(store.getState().selection.trackId).toBeNull();
    rightClick(name);
    expect(screen.getByRole("menu", { name: "Track options" })).toBeTruthy();
    expect(store.getState().selection.trackId).toBe("t1");
  });

  it("a right-click on the open options popup opens no second menu", () => {
    const { store, openMenu } = setup();
    openMenu();
    expect(rightClick(screen.getByRole("menu"))).toBe(false);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(store.getState().selection.trackId).toBeNull();
  });

  it("a viewer's right-click on a header opens no menu", () => {
    const { store } = setup("t1", makeStore({ canEdit: false }));
    expect(rightClick(headerOf("Text 1"))).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(store.getState().selection.trackId).toBe("t1");
  });

  it("the ⋯ menu reads the project when it opens", () => {
    // The header gets a fixed track, so nothing re-renders it when other tracks come in.
    const store = makeStore();
    render(
      <EditorProvider store={store}>
        <TrackHeader track={store.getState().doc.tracks[1]} selected={false} />
      </EditorProvider>,
    );
    const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Track options" }));
    const item = (name: string) => screen.getByRole("menuitem", { name }) as HTMLButtonElement;
    openMenu();
    expect(item("Duplicate").disabled).toBe(false);
    fireEvent.keyDown(item("Rename"), { key: "Escape" });
    const added: Op[] = Array.from({ length: LIMITS.tracksPerProject - 4 }, (_, i) => ({
      op: "add_track",
      track: { id: `r${i}`, kind: "audio", name: `Audio ${i + 2}` },
    }));
    act(() => void store.getState().applyRemote([entry(6, added)]));
    expect(store.getState().doc.tracks).toHaveLength(LIMITS.tracksPerProject);
    openMenu();
    expect(item("Duplicate").disabled).toBe(true);
    expect(item("Rename").disabled).toBe(false);
  });

  it("a viewer's header controls are native controls and all disabled", () => {
    const { view } = setup("v1", makeStore({ canEdit: false }));
    const controls = [...view.container.querySelectorAll<HTMLButtonElement>("[data-edit-control]")];
    expect(controls.map((c) => c.getAttribute("aria-label"))).toEqual(["Lock track", "Hide track", "Mute track", "Track options"]);
    for (const c of controls) {
      expect(["BUTTON", "INPUT"]).toContain(c.tagName);
      expect(c.disabled).toBe(true);
    }
  });
});

describe("toolbar", () => {
  it("Add track is disabled once the project has the most tracks it may have", () => {
    const full = sampleDoc();
    for (let i = full.tracks.length; i < LIMITS.tracksPerProject; i++) {
      full.tracks.push({ id: `a${i}`, kind: "audio", name: `Audio ${i}`, muted: false, hidden: false, locked: false, clips: [] });
    }
    const store = makeStore({ doc: full });
    render(
      <EditorProvider store={store}>
        <Toolbar duration={120} fps={30} />
      </EditorProvider>,
    );
    const add = screen.getByRole("button", { name: "Add track" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.hasAttribute("data-edit-control")).toBe(true);
    act(() => store.getState().edit([{ op: "remove_track", trackId: "a19" }], "remove track"));
    expect(add.disabled).toBe(false);
  });
});
