// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { LEAVE_SETTLE_MS } from "@/components/editor/leave-link";
import { MediaProvider } from "@/components/editor/media/media-context";
import { PresenceProvider } from "@/components/editor/presence-context";
import { TopBar } from "@/components/editor/top-bar";
import type { ProjectApi } from "@/lib/editor/api";
import { createClipboard } from "@/lib/editor/clipboard";
import { createPresenceStore } from "@/lib/editor/presence";
import { DEFAULT_PREFS, createSettingsStore, type SettingsStore } from "@/lib/editor/settings";
import type { SyncStatus } from "@/lib/editor/types";
import { makeStore, text } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen, waitFor } from "../helpers/dom";
import { pretendMediaServices } from "../helpers/media-services";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("undo and redo are disabled once the project is deleted, and stay on while signed out", () => {
  const store = makeStore();
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  act(() => {
    store.getState().edit([{ op: "remove_clip", clipId: "c1" }], "Delete");
  });
  const undo = () => screen.getByRole("button", { name: /^Undo/ }) as HTMLButtonElement;
  expect(undo().disabled).toBe(false);
  act(() => store.getState().setStatus("signed-out"));
  expect(undo().disabled).toBe(false);
  act(() => store.getState().setStatus("deleted"));
  expect(undo().disabled).toBe(true);
});

it("'Sign in' opens in a new tab, so the editor and its unsent edits stay", () => {
  const store = makeStore();
  store.getState().setStatus("signed-out");
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  const link = screen.getByRole("link", { name: "Sign in" });
  expect(link.getAttribute("href")).toBe("/login");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener");
});

// Clicks "Projects" in a top bar whose store has `queued` unsent edits and the given status, with `uploading`
// uploads running. Returns whether the page was loaded for real (the browser then asks before anything is lost).
function leaveWith(queued: number, status: SyncStatus, click: Partial<MouseEventInit> = {}, uploading = 0) {
  const store = makeStore();
  for (let i = 0; i < queued; i++) store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 + i }], "move");
  store.getState().setStatus(status);
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  const media = pretendMediaServices([]);
  const { unmount } = render(
    <EditorProvider store={store}>
      <MediaProvider services={{ ...media, queue: { ...media.queue, active: () => uploading } }}>
        <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
      </MediaProvider>
    </EditorProvider>,
  );
  const leftToTheApp = fireEvent.click(screen.getByRole("link", { name: "Projects" }), click);
  unmount();
  const assigned = assign.mock.calls.map(([href]) => String(href));
  assign.mockRestore();
  return { reloaded: !leftToTheApp, assigned };
}

it("'Projects' stays inside the app while queued edits can still be sent", () => {
  expect(leaveWith(0, "saved")).toEqual({ reloaded: false, assigned: [] });
  // A save in flight holds the link back until it ends (the tests after "Back to projects"), loading nothing yet.
  expect(leaveWith(2, "saving")).toEqual({ reloaded: true, assigned: [] });
  expect(leaveWith(0, "offline")).toEqual({ reloaded: false, assigned: [] });
});

it("'Projects' loads the page for real when queued edits cannot be sent, so the browser asks first", () => {
  expect(leaveWith(1, "offline")).toEqual({ reloaded: true, assigned: ["/s/seattle-solvers"] });
  expect(leaveWith(2, "signed-out")).toEqual({ reloaded: true, assigned: ["/s/seattle-solvers"] });
  // A click that opens a new tab leaves this one as it is.
  expect(leaveWith(1, "offline", { metaKey: true })).toEqual({ reloaded: false, assigned: [] });
});

it("'Projects' loads the page for real while an upload runs, so the browser asks before stopping it", () => {
  expect(leaveWith(0, "saved", {}, 1)).toEqual({ reloaded: true, assigned: ["/s/seattle-solvers"] });
  expect(leaveWith(2, "saving", {}, 1)).toEqual({ reloaded: true, assigned: ["/s/seattle-solvers"] });
  expect(leaveWith(1, "deleted", {}, 2)).toEqual({ reloaded: true, assigned: ["/s/seattle-solvers"] });
  expect(leaveWith(0, "saved", { metaKey: true }, 1)).toEqual({ reloaded: false, assigned: [] });
});

it("'Projects' asks inside the app while an export runs, and Leave stays inside the app so queued edits are still sent", () => {
  const store = makeStore();
  store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 }], "move");
  store.getState().setStatus("saving"); // the queued edit can still be sent
  store.getState().setExporting(true);
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} onExport={() => {}} exportPercent={50} />
    </EditorProvider>,
  );
  const projects = screen.getByRole("link", { name: "Projects" });
  const asking = () => screen.queryByText("An export is running. Leaving stops it.");
  expect(fireEvent.click(projects, { metaKey: true })).toBe(true); // a click that opens another tab leaves this one alone
  expect(asking()).toBeNull();
  expect(fireEvent.click(projects)).toBe(false);
  expect(screen.getByText("Leave the editor?", { selector: "h2" })).toBeTruthy();
  expect(asking()).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  expect(asking()).toBeNull();
  act(() => store.getState().setStatus("deleted")); // a project deleted during the export still asks
  expect(fireEvent.click(projects)).toBe(false);
  expect(fireEvent.click(screen.getByRole("link", { name: "Leave" }))).toBe(true); // the app's own navigation, not a page load
  expect(assign).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Exporting 50%" })).toBeTruthy();
});

it("'Projects' still loads the page for real during an export when edits cannot be sent", () => {
  const store = makeStore();
  store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 }], "move");
  store.getState().setStatus("offline");
  store.getState().setExporting(true);
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  render(<EditorProvider store={store}><TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} /></EditorProvider>);
  expect(fireEvent.click(screen.getByRole("link", { name: "Projects" }))).toBe(false);
  expect(assign).toHaveBeenCalledWith("/s/seattle-solvers");
  expect(screen.queryByText("An export is running. Leaving stops it.")).toBeNull();
});

it("'Leave the editor?' follows the export: it closes when the export ends, speaks of a file waiting for Download, and does not come back by itself", () => {
  const store = makeStore();
  store.getState().setExporting(true);
  render(<EditorProvider store={store}><TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} /></EditorProvider>);
  const question = () => screen.queryByText("Leave the editor?", { selector: "h2" });
  fireEvent.click(screen.getByRole("link", { name: "Projects" }));
  expect(question()).toBeTruthy();
  act(() => store.getState().setExporting(false)); // saved to a file: nothing is left to stop
  expect(question()).toBeNull();
  act(() => store.getState().setExporting(true)); // the next export does not bring the old question back
  expect(question()).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Projects" }));
  act(() => { store.getState().setExportHeld(true); store.getState().setExporting(false); });
  expect(screen.getByText("Your exported video hasn't been downloaded. Leaving discards it.")).toBeTruthy();
  expect(screen.queryByText("An export is running. Leaving stops it.")).toBeNull();
  act(() => store.getState().setExportHeld(false)); // downloaded
  expect(question()).toBeNull();
});

it("Leave loads the page for real when the queued edits can no longer be sent", () => {
  const store = makeStore();
  store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 }], "move");
  store.getState().setStatus("saving"); // can still be sent when the question opens
  store.getState().setExporting(true);
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  render(<EditorProvider store={store}><TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} /></EditorProvider>);
  fireEvent.click(screen.getByRole("link", { name: "Projects" }));
  act(() => store.getState().setStatus("signed-out")); // the session ended while the question was open
  expect(fireEvent.click(screen.getByRole("link", { name: "Leave" }))).toBe(false);
  expect(assign).toHaveBeenCalledWith("/s/seattle-solvers");
});

// Added beyond the brief: Leave's own click leaves a click that opens another tab alone, as the link's does.
it("Leave opened in another tab leaves this one as it is, even with the queued edits at risk", () => {
  const store = makeStore();
  store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 }], "move");
  store.getState().setStatus("saving");
  store.getState().setExporting(true);
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  render(<EditorProvider store={store}><TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} /></EditorProvider>);
  fireEvent.click(screen.getByRole("link", { name: "Projects" }));
  act(() => store.getState().setStatus("signed-out"));
  expect(fireEvent.click(screen.getByRole("link", { name: "Leave" }), { metaKey: true })).toBe(true);
  expect(assign).not.toHaveBeenCalled();
});

// Beyond the brief: a rule of LeaveLink's no test above catches the removal of.
it("Leave goes where the link it asked for goes, and looks like the primary button", () => {
  const store = makeStore();
  store.getState().setExporting(true);
  render(<EditorProvider store={store}><TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} /></EditorProvider>);
  fireEvent.click(screen.getByRole("link", { name: "Projects" }));
  const leave = screen.getByRole("link", { name: "Leave" });
  expect(leave.getAttribute("href")).toBe("/s/seattle-solvers");
  expect(leave.className.split(" ")).toEqual(expect.arrayContaining(["bg-ed-accent", "text-ed-bg"]));
});

it("'Back to projects' on a deleted project leaves without asking: its edits can never be saved", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const store = makeStore();
  store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 }], "move");
  store.getState().setStatus("deleted");
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  render(
    <EditorProvider store={store}>
      <EditorScreen spaceSlug="seattle-solvers" />
    </EditorProvider>,
  );
  expect(fireEvent.click(screen.getByRole("link", { name: "Back to projects" }))).toBe(true);
  expect(assign).not.toHaveBeenCalled();
});

// A top bar whose store has one queued edit being sent ("saving"). Records every click that reaches the window, and
// whether something had already stopped it there (the app's own navigation leaves a click alone; a link it holds back
// or a page load it does instead stops it).
function leaveWhileSaving() {
  const store = makeStore();
  store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 }], "move");
  store.getState().setStatus("saving");
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  const clicks: boolean[] = []; // defaultPrevented of each click on the link, once it has bubbled up
  const record = (event: Event) => clicks.push(event.defaultPrevented);
  window.addEventListener("click", record);
  const view = render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  const projects = screen.getByRole("link", { name: "Projects" });
  const sent = () => {
    const head = store.getState().queue[0];
    store.getState().ack(head.id, store.getState().server.version + 1, []);
    store.getState().setStatus("saved");
  };
  return { store, assign, clicks, projects, sent, view, done: () => window.removeEventListener("click", record) };
}

it("'Projects' during a save waits for it, then stays inside the app once it worked", () => {
  const { assign, clicks, projects, sent, done } = leaveWhileSaving();
  expect(fireEvent.click(projects)).toBe(false); // held back while the save is in flight
  expect(clicks).toEqual([true]);
  act(sent);
  expect(clicks).toEqual([true, false]); // the link clicked again, and left to the app's own navigation
  expect(assign).not.toHaveBeenCalled();
  expect(screen.queryByText("Leave the editor?")).toBeNull();
  done();
});

it("'Projects' during a save that then fails loads the page for real, so the browser asks before the edit is lost", () => {
  for (const failed of ["offline", "limited"] as const) {
    const { store, assign, clicks, projects, view, done } = leaveWhileSaving();
    expect(fireEvent.click(projects)).toBe(false);
    act(() => store.getState().setStatus(failed)); // the queued edit is kept
    expect(assign).toHaveBeenCalledWith("/s/seattle-solvers");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual([true, true]); // clicked again once the save ended, and held back again: no navigation inside the app
    done();
    view.unmount();
    assign.mockRestore();
  }
});

it("'Projects' during a save that never ends loads the page for real after 4 s", () => {
  vi.useFakeTimers();
  try {
    const { assign, clicks, projects, done } = leaveWhileSaving();
    expect(fireEvent.click(projects)).toBe(false);
    act(() => vi.advanceTimersByTime(LEAVE_SETTLE_MS - 1));
    expect(assign).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(assign).toHaveBeenCalledWith("/s/seattle-solvers");
    expect(clicks).toEqual([true]);
    done();
  } finally {
    vi.useRealTimers();
  }
});

it("a second click on 'Projects' during the wait starts no second wait, and closing the editor ends the wait", () => {
  vi.useFakeTimers();
  try {
    const { store, assign, clicks, projects, view, done } = leaveWhileSaving();
    expect(fireEvent.click(projects)).toBe(false);
    expect(fireEvent.click(projects)).toBe(false);
    act(() => store.getState().setStatus("offline"));
    expect(assign).toHaveBeenCalledTimes(1);
    assign.mockClear();
    store.getState().setStatus("saving");
    expect(fireEvent.click(projects)).toBe(false);
    view.unmount(); // the editor closed some other way: nothing happens later
    act(() => store.getState().setStatus("offline"));
    act(() => vi.advanceTimersByTime(LEAVE_SETTLE_MS));
    expect(assign).not.toHaveBeenCalled();
    expect(clicks).toEqual([true, true, true, true]); // the third is the link clicked again when the save failed
    done();
  } finally {
    vi.useRealTimers();
  }
});

it("Leave during a save waits for it like the link: it stays inside the app once the save worked, and loads the page for real when it failed", () => {
  for (const outcome of ["saved", "offline"] as const) {
    const { store, assign, clicks, projects, sent, view, done } = leaveWhileSaving();
    act(() => store.getState().setExporting(true));
    expect(fireEvent.click(projects)).toBe(false); // asks first, without waiting
    expect(screen.getByText("An export is running. Leaving stops it.")).toBeTruthy();
    expect(fireEvent.click(screen.getByRole("link", { name: "Leave" }))).toBe(false); // held back while the save is in flight
    act(() => (outcome === "saved" ? sent() : store.getState().setStatus(outcome)));
    if (outcome === "saved") {
      expect(clicks).toEqual([true, true, false]); // Leave clicked again, and left to the app's own navigation
      expect(assign).not.toHaveBeenCalled();
    } else {
      expect(clicks).toEqual([true, true, true]); // Leave clicked again, and held back again
      expect(assign).toHaveBeenCalledWith("/s/seattle-solvers");
      expect(assign).toHaveBeenCalledTimes(1);
    }
    done();
    view.unmount();
    assign.mockRestore();
  }
});

// Beyond the brief: Stay after Leave was held back for a save ends the wait, so the editor does not close by itself later.
it("Stay after Leave was held back for a save keeps the editor open once the save ends", () => {
  const { store, assign, clicks, projects, sent, done } = leaveWhileSaving();
  act(() => store.getState().setExporting(true));
  fireEvent.click(projects);
  expect(fireEvent.click(screen.getByRole("link", { name: "Leave" }))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  act(sent);
  expect(clicks).toEqual([true, true, false]); // Projects, Leave, Stay (a plain button): nothing clicked after the save
  expect(assign).not.toHaveBeenCalled();
  done();
});

// A top bar whose api answers every rename with the name it was sent.
function showName(over: Parameters<typeof makeStore>[0] = {}) {
  const store = makeStore(over);
  const rename = vi.fn<ProjectApi["rename"]>(async (name) => ({ ok: true, name }));
  const api: ProjectApi = {
    postOps: async () => ({ ok: false, kind: "network" }),
    getVersion: async () => ({ ok: false, kind: "network" }),
    getOpsSince: async () => ({ ok: false, kind: "network" }),
    getProject: async () => ({ ok: false, kind: "network" }),
    rename,
    putThumbnail: async () => ({ ok: false, kind: "network" }),
  };
  render(
    <EditorProvider store={store} api={api}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  const open = () => {
    fireEvent.click(screen.getByRole("button", { name: store.getState().name }));
    return screen.getByRole("textbox", { name: "Project name" }) as HTMLInputElement;
  };
  return { store, rename, open };
}

it("clicking the project name opens a field with the name selected", () => {
  const { open } = showName();
  const button = screen.getByRole("button", { name: "Qual recap" });
  expect(button.closest("h1")).toBe(screen.getByRole("heading", { name: "Qual recap" }));
  expect(button.getAttribute("title")).toBe("Qual recap");
  expect(button.hasAttribute("data-edit-control")).toBe(false);
  const field = open();
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(10);
  expect(field.maxLength).toBe(100);
  expect(field.hasAttribute("data-edit-control")).toBe(true);
  // The field's box is full width, so its wrapper sets the width.
  expect(field.parentElement?.className.split(" ")).toContain("w-72");
  expect(screen.queryByRole("button", { name: "Qual recap" })).toBeNull();
});

it("Enter saves the new name and returns focus to it", async () => {
  const { store, rename, open } = showName();
  const field = open();
  fireEvent.change(field, { target: { value: "Finals" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(rename).toHaveBeenCalledTimes(1);
  expect(rename).toHaveBeenCalledWith("Finals");
  expect(screen.getByRole("heading").textContent).toBe("Finals");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Finals" }));
  await waitFor(() => expect(store.getState().name).toBe("Finals"));
});

it("Escape keeps the old name, and blur saves", async () => {
  const { store, rename, open } = showName();
  let field = open();
  fireEvent.change(field, { target: { value: "Finals" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(rename).not.toHaveBeenCalled();
  expect(screen.getByRole("heading").textContent).toBe("Qual recap");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Qual recap" }));

  field = open();
  fireEvent.change(field, { target: { value: "Finals" } });
  fireEvent.blur(field);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("heading").textContent).toBe("Finals");
  // Clicking away leaves focus where the click put it.
  expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Finals" }));
  await waitFor(() => expect(store.getState().name).toBe("Finals"));
});

it("on a Mac a Ctrl+click on the project name opens no field", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const { open } = showName();
  fireEvent.click(screen.getByRole("button", { name: "Qual recap" }), { ctrlKey: true });
  expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull();
  expect(open()).toBeTruthy();
});

it("a viewer sees the name as a heading with no button", () => {
  showName({ canEdit: false });
  expect(screen.getByRole("heading", { name: "Qual recap" }).getAttribute("title")).toBe("Qual recap");
  expect(screen.queryByRole("button", { name: "Qual recap" })).toBeNull();
});

it("a deleted project shows the name as a heading with no button", () => {
  const { store } = showName();
  act(() => store.getState().setStatus("deleted"));
  expect(screen.getByRole("heading", { name: "Qual recap" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Qual recap" })).toBeNull();
});

// A top bar with its own clipboard, so a test can copy into it.
function showMenus(
  over: Parameters<typeof makeStore>[0] = {},
  props: { onResetLayout?(): void; onShowShortcuts?(): void } = {},
  settings?: SettingsStore,
) {
  const store = makeStore(over);
  const clipboard = createClipboard();
  render(
    <EditorProvider store={store} clipboard={clipboard} settings={settings}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={props.onShowShortcuts ?? (() => {})} onResetLayout={props.onResetLayout} />
    </EditorProvider>,
  );
  const open = (name: "Edit" | "View") => fireEvent.click(screen.getByRole("button", { name }));
  const item = (name: string) => screen.getByRole("menuitem", { name }) as HTMLButtonElement;
  const check = (name: string) => screen.getByRole("menuitemcheckbox", { name }) as HTMLButtonElement;
  return { store, clipboard, open, item, check };
}

it("Edit → Split splits at the playhead", () => {
  const { store, open, item } = showMenus();
  act(() => store.getState().seek(45));
  open("Edit");
  fireEvent.click(item("Split"));
  expect(store.getState().queue.map((e) => e.label)).toEqual(["split"]);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("the Edit menu shows each item's key", () => {
  const { open, item } = showMenus();
  open("Edit");
  const hint = (name: string) => item(name).querySelector("[data-shortcut]")?.textContent;
  expect(hint("Undo")).toBe("Ctrl+Z");
  expect(hint("Redo")).toBe("Ctrl+Shift+Z");
  expect(hint("Paste")).toBe("Ctrl+V");
  expect(hint("Split")).toBe("S");
  expect(hint("Ripple delete")).toBe("Shift+Del");
  expect(hint("Deselect all")).toBe("Escape");
  // Undo changes the project, so it is marked; Copy does not.
  expect(item("Undo").hasAttribute("data-edit-control")).toBe(true);
  expect(item("Copy").hasAttribute("data-edit-control")).toBe(false);
});

it("Edit menu hints follow the custom key", () => {
  const settings = createSettingsStore({ prefs: DEFAULT_PREFS, keymap: { on: true, keys: { split: ["Mod+Shift+S"] }, off: [] } });
  const { open, item } = showMenus({}, {}, settings);
  const hint = (name: string) => item(name).querySelector("[data-shortcut]")?.textContent;
  open("Edit");
  expect(hint("Split")).toBe("Ctrl+Shift+S");
  expect(hint("Undo")).toBe("Ctrl+Z");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  // The keys are read as the menu opens: an item that is off, or every item with all off, shows none.
  act(() => settings.getState().setKeymap({ on: true, keys: {}, off: ["undo"] }));
  open("Edit");
  expect([hint("Split"), hint("Undo")]).toEqual(["S", undefined]);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  act(() => settings.getState().setKeymap({ on: false, keys: {}, off: [] }));
  open("View");
  expect(hint("Zoom in on the timeline")).toBeUndefined();
});

it("Edit → Paste is greyed until something is copied", () => {
  const { store, clipboard, open, item } = showMenus();
  open("Edit");
  expect(item("Paste").disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  clipboard.write({ clips: [{ clip: text("x9", 0, 30), trackId: "t1" }] });
  open("Edit");
  expect(item("Paste").disabled).toBe(false);
  act(() => store.getState().seek(200));
  fireEvent.click(item("Paste"));
  expect(store.getState().queue.map((e) => e.label)).toEqual(["paste"]);
});

it("View → Snapping turns snapping off", () => {
  const { store, open, check } = showMenus();
  open("View");
  expect(check("Snapping").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(check("Snapping"));
  expect(store.getState().snapping).toBe(false);
  open("View");
  expect(check("Snapping").getAttribute("aria-checked")).toBe("false");
});

it("View → Safe area shows it, and hides it again", () => {
  const { store, open, check } = showMenus();
  open("View");
  expect(check("Safe area").getAttribute("aria-checked")).toBe("false"); // hidden at first
  fireEvent.click(check("Safe area"));
  expect(store.getState().showSafeZones).toBe(true);
  open("View");
  expect(check("Safe area").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(check("Safe area"));
  expect(store.getState().showSafeZones).toBe(false);
});

it("View → Reset panel sizes calls onResetLayout", () => {
  const onResetLayout = vi.fn();
  const onShowShortcuts = vi.fn();
  const { open, item } = showMenus({}, { onResetLayout, onShowShortcuts });
  open("View");
  fireEvent.click(item("Reset panel sizes"));
  expect(onResetLayout).toHaveBeenCalledTimes(1);
  open("View");
  fireEvent.click(item("Keyboard shortcuts"));
  expect(onShowShortcuts).toHaveBeenCalledTimes(1);
  expect(onResetLayout).toHaveBeenCalledTimes(1);
});

it("View → Zoom in on the timeline zooms, and is greyed at the limit", () => {
  const { store, open, item } = showMenus();
  const before = store.getState().zoom;
  open("View");
  fireEvent.click(item("Zoom in on the timeline"));
  expect(store.getState().zoom).toBeCloseTo(before * 1.25, 6);
  act(() => store.getState().setZoom(40));
  open("View");
  expect(item("Zoom in on the timeline").disabled).toBe(true);
  expect(item("Zoom out on the timeline").disabled).toBe(false);
});

it("a viewer's Edit → Delete is disabled and nothing is queued", () => {
  const { store, open, item } = showMenus({ canEdit: false });
  act(() => store.getState().select(["x1"]));
  open("Edit");
  expect(item("Delete").disabled).toBe(true);
  fireEvent.click(item("Delete"));
  expect(store.getState().queue).toEqual([]);
  expect(item("Copy").disabled).toBe(false);
});

it("Edit and View are greyed once the project is deleted", () => {
  const { store } = showMenus();
  const trigger = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
  expect(trigger("Edit").disabled).toBe(false);
  expect(trigger("Edit").hasAttribute("data-edit-control")).toBe(false);
  expect(trigger("View").hasAttribute("data-edit-control")).toBe(false);
  act(() => store.getState().setStatus("deleted"));
  expect(trigger("Edit").disabled).toBe(true);
  expect(trigger("View").disabled).toBe(true);
});

it("the top row reads Projects, (Menu on a phone,) Edit, View, Help, the name, Undo, Redo, Settings, Keyboard shortcuts, Export", () => {
  showMenus();
  const header = screen.getByRole("banner");
  const names = [...header.querySelectorAll<HTMLElement>("a, button")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
  expect(names).toEqual(["Projects", "Menu", "Edit", "View", "Help", "Qual recap", "Undo", "Redo", "Settings", "Keyboard shortcuts", "Export"]);
  // For a viewer the name is a heading, between View and the "View only" badge.
  cleanup();
  showMenus({ canEdit: false });
  const order = [screen.getByRole("button", { name: "View" }), screen.getByRole("heading", { name: "Qual recap" }), screen.getByText("View only")];
  expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("Help lists the guide's lessons on a server with the guide, and the AI agents page always; each opens in a tab of its own", () => {
  const store = makeStore();
  const opened = vi.fn();
  vi.stubGlobal("open", opened);
  const guide = [
    { title: "The basics", path: "/learn", chapters: ["Welcome"] },
    { title: "Sound", path: "/learn/sound", chapters: ["Levels"] },
  ];
  const { unmount } = render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  // No guide on this server: Help still leads to the AI agents page, beside the project, and the shortcuts.
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.replace(/\?$/, ""))).toEqual(["AI agents", "Keyboard shortcuts"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "AI agents" }));
  expect(opened).toHaveBeenCalledWith("/agents", "_blank", "noopener");
  unmount();
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} guide={guide} />
    </EditorProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.replace(/\?$/, ""))).toEqual(["The basics", "Sound", "AI agents", "Keyboard shortcuts"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Sound" }));
  expect(opened).toHaveBeenCalledWith("/learn/sound", "_blank", "noopener");
});

it("the search finds a lesson of the guide and opens it beside the project", () => {
  const store = makeStore();
  const opened = vi.fn();
  vi.stubGlobal("open", opened);
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} guide={[{ title: "Sound", path: "/learn/sound", chapters: ["Levels", "Music"] }]} />
    </EditorProvider>,
  );
  const search = screen.getByRole("combobox", { name: "Search tools and actions" });
  fireEvent.focus(search);
  fireEvent.change(search, { target: { value: "guide" } });
  fireEvent.click(screen.getByRole("option", { name: /Guide: Sound/ }));
  expect(opened).toHaveBeenCalledWith("/learn/sound", "_blank", "noopener");
});


// Whether an element is in something the narrow layout removes.
const goneBelowLg = (el: Element | null | undefined) => {
  for (let n = el ?? null; n; n = n.parentElement) if (n.classList.contains("max-lg:hidden")) return true;
  return false;
};

it("below the lg width the search stays, folded to its mark, and opens across the bar", () => {
  render(
    <EditorProvider store={makeStore()}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  const field = screen.getByRole("combobox", { name: "Search tools and actions" });
  expect(goneBelowLg(field)).toBe(false);
  const box = field.parentElement!.className.split(" ");
  expect(box).toEqual(expect.arrayContaining(["max-lg:size-7", "max-lg:focus-within:absolute", "max-lg:focus-within:inset-x-1.5"]));
  // The bar is what the opened field spans.
  expect(field.closest("header")!.className.split(" ")).toContain("relative");
});

it("below the lg width the save status is a mark with a word when it matters, and its words are still heard once", () => {
  const store = makeStore();
  store.getState().edit([{ op: "remove_clip", clipId: "c1" }], "Delete");
  store.getState().setStatus("offline");
  // The browser itself is offline (online, the same state reads "Can't reach EasyEdit").
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  online.mockRestore();
  const said = screen.getAllByRole("status").filter((s) => s.textContent?.startsWith("Offline"));
  expect(said).toHaveLength(1);
  expect(said[0].textContent).toBe("Offline. Changes will save when you reconnect.");
  expect(goneBelowLg(said[0])).toBe(false);
  // Narrow, the words are kept for a screen reader, and the mark beside them is what shows.
  expect(said[0].closest("[class*='max-lg:[&_[role=status]]:sr-only']")).not.toBeNull();
  const mark = document.querySelector<HTMLElement>("[data-save-mark]")!;
  expect(mark.getAttribute("aria-hidden")).toBe("true");
  expect(mark.className.split(" ")).toContain("lg:hidden");
  expect(mark.dataset.word).toBe("Offline");
  expect(mark.title).toBe("Offline. Changes will save when you reconnect.");
  // All well: the mark alone.
  act(() => store.getState().setStatus("saved"));
  expect(document.querySelector<HTMLElement>("[data-save-mark]")!.dataset.word).toBeUndefined();
  act(() => store.getState().setStatus("signed-out"));
  expect(document.querySelector<HTMLElement>("[data-save-mark]")!.dataset.word).toBe("Signed out");
  expect(goneBelowLg(screen.getByRole("link", { name: "Sign in" }))).toBe(false);
});

it("below the lg width who else is here is one count that names them", () => {
  const presence = createPresenceStore("u1");
  presence.getState().receive([{ userId: "u2", name: "Grace Hopper", clipIds: [], trackId: null }, { userId: "u3", name: "Linus", clipIds: [], trackId: null }], Date.now());
  render(
    <EditorProvider store={makeStore()}>
      <PresenceProvider store={presence}>
        <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
      </PresenceProvider>
    </EditorProvider>,
  );
  const count = screen.getByRole("img", { name: "Also here: Grace Hopper, Linus" });
  expect(count.textContent).toBe("2");
  expect(count.className.split(" ")).toContain("lg:hidden");
  // The dots stay at the lg width and up; narrow, their group is what gives way.
  const dots = screen.getByRole("group", { name: "Also here" });
  expect(goneBelowLg(dots)).toBe(false);
  expect(dots.parentElement!.className).toContain("max-lg:[&>[role=group]]:hidden");
});

it("Undo that takes the last change hands focus to Redo, and Redo the last undone one hands it back", () => {
  const store = makeStore();
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  act(() => store.getState().edit([{ op: "remove_clip", clipId: "c1" }], "Delete"));
  const undo = screen.getByRole("button", { name: /^Undo/ }) as HTMLButtonElement;
  act(() => undo.focus());
  fireEvent.click(undo);
  const redo = screen.getByRole("button", { name: /^Redo/ }) as HTMLButtonElement;
  expect(undo.disabled).toBe(true);
  expect(document.activeElement).toBe(redo);
  fireEvent.click(redo);
  expect(redo.disabled).toBe(true);
  expect(document.activeElement).toBe(undo);
});

it("Undo with more to undo keeps focus where it is", () => {
  const store = makeStore();
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  act(() => {
    store.getState().edit([{ op: "remove_clip", clipId: "c1" }], "Delete");
    store.getState().edit([{ op: "remove_clip", clipId: "c2" }], "Delete");
  });
  const undo = screen.getByRole("button", { name: /^Undo/ }) as HTMLButtonElement;
  act(() => undo.focus());
  fireEvent.click(undo);
  expect(undo.disabled).toBe(false);
  expect(document.activeElement).toBe(undo);
});

it("below the lg width the Edit, View and Help menus are one Menu button, so the bar keeps room on a phone", () => {
  const store = makeStore();
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" onShowShortcuts={() => {}} />
    </EditorProvider>,
  );
  const menu = screen.getByRole("button", { name: "Menu" });
  expect(menu.closest("[class~='lg:hidden']")).not.toBeNull();
  expect(screen.getByRole("button", { name: "View" }).closest("[class~='max-lg:hidden']")).not.toBeNull();
  expect(menu.closest("[class~='max-lg:hidden']")).toBeNull();
  fireEvent.click(menu);
  const names = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
  // One of the Edit menu's, one of the View menu's and one of the Help menu's.
  expect(names.some((n) => n.startsWith("Undo"))).toBe(true);
  expect(names.some((n) => n.startsWith("Zoom in"))).toBe(true);
  expect(names.some((n) => n.startsWith("AI agents"))).toBe(true);
  // The keyboard shortcuts are in both View and Help, and listed once here.
  expect(names.filter((n) => n.startsWith("Keyboard shortcuts"))).toHaveLength(1);
});
