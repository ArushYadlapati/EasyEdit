// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { MediaProvider } from "@/components/editor/media/media-context";
import { TopBar } from "@/components/editor/top-bar";
import type { ProjectApi } from "@/lib/editor/api";
import type { SyncStatus } from "@/lib/editor/types";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen, waitFor } from "../helpers/dom";
import { pretendMediaServices } from "../helpers/media-services";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("undo and redo are disabled once the project is deleted, and stay on while signed out", () => {
  const store = makeStore();
  render(
    <EditorProvider store={store}>
      <TopBar onShowShortcuts={() => {}} />
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
      <TopBar onShowShortcuts={() => {}} />
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
        <TopBar onShowShortcuts={() => {}} />
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
  expect(leaveWith(2, "saving")).toEqual({ reloaded: false, assigned: [] });
  expect(leaveWith(0, "offline")).toEqual({ reloaded: false, assigned: [] });
});

it("'Projects' loads the page for real when queued edits cannot be sent, so the browser asks first", () => {
  expect(leaveWith(1, "offline")).toEqual({ reloaded: true, assigned: ["/dashboard"] });
  expect(leaveWith(2, "signed-out")).toEqual({ reloaded: true, assigned: ["/dashboard"] });
  // A click that opens a new tab leaves this one as it is.
  expect(leaveWith(1, "offline", { metaKey: true })).toEqual({ reloaded: false, assigned: [] });
});

it("'Projects' loads the page for real while an upload runs, so the browser asks before stopping it", () => {
  expect(leaveWith(0, "saved", {}, 1)).toEqual({ reloaded: true, assigned: ["/dashboard"] });
  expect(leaveWith(2, "saving", {}, 1)).toEqual({ reloaded: true, assigned: ["/dashboard"] });
  expect(leaveWith(1, "deleted", {}, 2)).toEqual({ reloaded: true, assigned: ["/dashboard"] });
  expect(leaveWith(0, "saved", { metaKey: true }, 1)).toEqual({ reloaded: false, assigned: [] });
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
      <EditorScreen />
    </EditorProvider>,
  );
  expect(fireEvent.click(screen.getByRole("link", { name: "Back to projects" }))).toBe(true);
  expect(assign).not.toHaveBeenCalled();
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
  };
  render(
    <EditorProvider store={store} api={api}>
      <TopBar onShowShortcuts={() => {}} />
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
