// @vitest-environment happy-dom
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "@/components/dashboard/dashboard";
import { PROJECT_DRAG_TYPE } from "@/components/dashboard/drag";
import { ProjectCard } from "@/components/dashboard/project-card";
import type { FormState } from "@/lib/projects/dashboard-actions";
import { FOLDERS, NOW, PROJECTS, RECENT_IDS, dashProject, fakeActions, renderDashboard } from "../helpers/dashboard";
import { act, fireEvent, screen, within } from "../helpers/dom";
import { dragEvent } from "../helpers/drag-events";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
  router.bfcacheId = "b0";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const EDITOR_ITEMS = ["Open", "Rename", "Duplicate", "Move to folder…", "Delete"];

const region = (name: string) => screen.getByRole("region", { name });
// The section of project cards: headed Projects under the folder tiles, otherwise named by the title.
const grid = () => screen.getByRole("region", { name: /^(All projects|Projects|Recent)$/ });
const card = (name: string) => within(grid()).getByRole("link", { name }).closest("li")!;
const options = (li: HTMLElement) => within(li).getByRole("button", { name: "Project options" });
const menuItems = () =>
  within(screen.getByRole("menu", { name: "Project options" }))
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
const escape = () => fireEvent.keyDown(document.activeElement!, { key: "Escape" });
const sent = (fn: { mock: { calls: [FormData][] } }, call = 0) => Object.fromEntries(fn.mock.calls[call][0].entries());

// Opens the card's ⋯ menu and picks an item, letting any action it starts settle.
async function pick(li: HTMLElement, label: string) {
  fireEvent.click(options(li));
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
  });
}

const dialog = (name: string) => screen.getByRole("dialog", { name });
const radios = () => within(screen.getByRole("radiogroup", { name: "Folder" })).getAllByRole("radio") as HTMLInputElement[];
const radioNames = () => radios().map((radio) => radio.closest("label")!.textContent);
const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const button = (within_: HTMLElement, name: string) => within(within_).getByRole("button", { name }) as HTMLButtonElement;

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("a card's menu", () => {
  it("the ⋯ button and a right-click open the same menu", () => {
    const { unmount } = renderDashboard();
    const li = card("Qual recap");
    expect(options(li).querySelector("svg")?.getAttribute("class")).toContain("lucide-ellipsis");
    fireEvent.click(options(li));
    expect(menuItems()).toEqual(EDITOR_ITEMS);
    const del = screen.getByRole("menuitem", { name: "Delete" });
    expect(del.className).toContain("text-ed-danger");
    expect(del.previousElementSibling?.getAttribute("role")).toBe("separator");
    escape();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(fireEvent.contextMenu(li, { clientX: 5, clientY: 5 })).toBe(false);
    expect(menuItems()).toEqual(EDITOR_ITEMS);
    escape();
    unmount();

    renderDashboard({ canEdit: false });
    const viewed = card("Qual recap");
    fireEvent.click(options(viewed));
    expect(menuItems()).toEqual(["Open"]);
    escape();
    expect(fireEvent.contextMenu(viewed, { clientX: 5, clientY: 5 })).toBe(false);
    expect(menuItems()).toEqual(["Open"]);
  });

  it("the keyboard's menu key opens it at the card and gives focus back", () => {
    renderDashboard();
    const li = card("Qual recap");
    fireEvent.contextMenu(li, { clientX: 0, clientY: 0 });
    expect(menuItems()).toEqual(EDITOR_ITEMS);
    escape();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(options(li));
  });

  it("the menu opens at the pointer, or at the card's lower-left corner from the keyboard", () => {
    renderDashboard();
    const li = card("Qual recap");
    vi.spyOn(li, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 100, y: 50, width: 200, height: 200 }));
    const at = () => {
      const { left, top } = screen.getByRole("menu", { name: "Project options" }).style;
      return [left, top];
    };
    fireEvent.contextMenu(li, { clientX: 150, clientY: 120 });
    expect(at()).toEqual(["150px", "120px"]);
    escape();
    fireEvent.contextMenu(li, { clientX: 0, clientY: 0 });
    expect(at()).toEqual(["100px", "250px"]);
  });

  it("a right-click on the open ⋯ menu opens no second menu", () => {
    renderDashboard();
    fireEvent.click(options(card("Qual recap")));
    expect(fireEvent.contextMenu(screen.getByRole("menuitem", { name: "Rename" }), { clientX: 5, clientY: 5 })).toBe(false);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("a right-click in the rename field keeps the browser's own menu", async () => {
    renderDashboard();
    const li = card("Qual recap");
    await pick(li, "Rename");
    const field = within(li).getByRole("textbox", { name: "New name for Qual recap" });
    expect(fireEvent.contextMenu(field, { clientX: 5, clientY: 5 })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a right-click in a card's dialog keeps the browser's own menu", async () => {
    renderDashboard();
    await pick(card("Qual recap"), "Delete");
    expect(fireEvent.contextMenu(within(dialog("Delete project")).getByText('Delete "Qual recap"?'), { clientX: 5, clientY: 5 })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Open goes to the editor", async () => {
    renderDashboard();
    await pick(card("Qual recap"), "Open");
    expect(router.push).toHaveBeenCalledWith("/s/seattle-solvers/editor/a");
  });

  it("Open from a right-click goes to the editor too", async () => {
    renderDashboard({ canEdit: false });
    fireEvent.contextMenu(card("Poster"), { clientX: 5, clientY: 5 });
    await click(screen.getByRole("menuitem", { name: "Open" }));
    expect(router.push).toHaveBeenCalledWith("/s/seattle-solvers/editor/b");
  });
});

describe("renaming a card", () => {
  it("Rename happens in place", async () => {
    const { actions } = renderDashboard();
    const li = card("Qual recap");
    await pick(li, "Rename");
    const field = within(li).getByRole("textbox", { name: "New name for Qual recap" }) as HTMLInputElement;
    expect(field.value).toBe("Qual recap");
    expect(field.maxLength).toBe(100);
    expect(field.closest("a")).toBeNull();
    expect(within(li).queryByRole("link")).toBeNull();
    expect(li.querySelector("[data-blank-frame]")).not.toBeNull();
    fireEvent.change(field, { target: { value: "Finals" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(actions.rename).toHaveBeenCalledTimes(1);
    expect(sent(actions.rename)).toEqual({ id: "a", name: "Finals" });
    expect(document.activeElement).toBe(options(li));
    expect(within(li).getByRole("link", { name: "Qual recap" })).toBeTruthy();
  });

  it("Rename from a right-click opens the same field", async () => {
    const { actions } = renderDashboard();
    const li = card("Qual recap");
    fireEvent.contextMenu(li, { clientX: 5, clientY: 5 });
    await click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = within(li).getByRole("textbox", { name: "New name for Qual recap" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "Finals" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(sent(actions.rename)).toEqual({ id: "a", name: "Finals" });
  });

  it("blur submits a rename", async () => {
    const { actions } = renderDashboard();
    const li = card("Qual recap");
    await pick(li, "Rename");
    const field = within(li).getByRole("textbox", { name: "New name for Qual recap" });
    fireEvent.change(field, { target: { value: "Finals" } });
    await act(async () => {
      fireEvent.blur(field);
    });
    expect(actions.rename).toHaveBeenCalledTimes(1);
    expect(sent(actions.rename)).toEqual({ id: "a", name: "Finals" });
    // Focus went where the pointer took it, not back to the ⋯ button.
    expect(document.activeElement).not.toBe(options(li));
  });

  it("Escape keeps the name", async () => {
    const { actions } = renderDashboard();
    const li = card("Qual recap");
    await pick(li, "Rename");
    const field = within(li).getByRole("textbox", { name: "New name for Qual recap" });
    fireEvent.change(field, { target: { value: "Finals" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    expect(actions.rename).not.toHaveBeenCalled();
    expect(within(li).getByRole("link", { name: "Qual recap" })).toBeTruthy();
    expect(document.activeElement).toBe(options(li));
  });

  it("an unchanged name sends nothing", async () => {
    const { actions } = renderDashboard();
    const li = card("Qual recap");
    await pick(li, "Rename");
    const field = within(li).getByRole("textbox", { name: "New name for Qual recap" });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(actions.rename).not.toHaveBeenCalled();
    expect(within(li).getByRole("link", { name: "Qual recap" })).toBeTruthy();
  });

  it("a refused rename says why on the card", async () => {
    const { actions } = renderDashboard();
    actions.rename.mockResolvedValue({ error: "Enter a name up to 100 characters." });
    const li = card("Qual recap");
    await pick(li, "Rename");
    const field = within(li).getByRole("textbox", { name: "New name for Qual recap" });
    fireEvent.change(field, { target: { value: " " } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    const alert = within(li).getByRole("alert");
    expect(alert.textContent).toBe("Enter a name up to 100 characters.");
    expect(alert.className).toContain("text-ed-danger");
    expect(within(li).getByRole("link", { name: "Qual recap" })).toBeTruthy();
    // The next try clears it.
    actions.rename.mockResolvedValue({});
    await pick(li, "Rename");
    fireEvent.change(within(li).getByRole("textbox"), { target: { value: "Finals" } });
    await act(async () => {
      fireEvent.keyDown(within(li).getByRole("textbox"), { key: "Enter" });
    });
    expect(within(li).queryByRole("alert")).toBeNull();
  });
});

describe("duplicating a card", () => {
  it("Duplicate sends the project, and a refusal says why on the card", async () => {
    const { actions } = renderDashboard();
    const li = card("Qual recap");
    await pick(li, "Duplicate");
    expect(actions.duplicate).toHaveBeenCalledTimes(1);
    expect(sent(actions.duplicate)).toEqual({ id: "a" });
    expect(within(li).queryByRole("alert")).toBeNull();
    actions.duplicate.mockResolvedValue({ error: "Your role doesn't allow this." });
    await pick(li, "Duplicate");
    const alert = within(li).getByRole("alert");
    expect(alert.textContent).toBe("Your role doesn't allow this.");
    expect(alert.className).toContain("text-ed-danger");
  });

  it("a card's edits wait while one of them runs", async () => {
    const { actions } = renderDashboard();
    // The duplicate is held while the test looks, then finished: React holds every later transition until a running
    // async action settles, and that would reach the tests after this one.
    let finish: (state: FormState) => void = () => {};
    actions.duplicate.mockImplementation(() => new Promise<FormState>((resolve) => (finish = resolve)));
    const li = card("Qual recap");
    await pick(li, "Duplicate");
    fireEvent.click(options(li));
    const itemStates = () =>
      within(screen.getByRole("menu", { name: "Project options" }))
        .getAllByRole("menuitem")
        .map((item) => [item.textContent, (item as HTMLButtonElement).disabled]);
    expect(itemStates()).toEqual([
      ["Open", false],
      ["Rename", true],
      ["Duplicate", true],
      ["Move to folder…", true],
      ["Delete", true],
    ]);
    await click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(actions.duplicate).toHaveBeenCalledTimes(1);
    escape();
    await act(async () => finish({}));
    fireEvent.click(options(li));
    expect(itemStates().every(([, disabled]) => disabled === false)).toBe(true);
  });
});

describe("a project deleted elsewhere", () => {
  it.each(["Rename", "Duplicate", "Move to folder…", "Delete"])("%s says so in the bar after its card goes", async (option) => {
    const { actions, rerender } = renderDashboard();
    let answer: (state: FormState) => void = () => {};
    const wait = () => new Promise<FormState>((resolve) => (answer = resolve));
    const li = card("Qual recap");
    if (option === "Rename") {
      actions.rename.mockImplementation(wait);
      await pick(li, "Rename");
      const field = within(li).getByRole("textbox", { name: "New name for Qual recap" });
      fireEvent.change(field, { target: { value: "Qual recap 2" } });
      await act(async () => {
        fireEvent.keyDown(field, { key: "Enter" });
      });
    } else if (option === "Duplicate") {
      actions.duplicate.mockImplementation(wait);
      await pick(li, "Duplicate");
    } else if (option === "Move to folder…") {
      actions.move.mockImplementation(wait);
      await pick(li, "Move to folder…");
      fireEvent.click(radio("Sponsors"));
      await click(button(dialog("Move to folder"), "Move"));
    } else {
      actions.remove.mockImplementation(wait);
      await pick(li, "Delete");
      await click(button(dialog("Delete project"), "Delete"));
    }
    // The refusal refreshes the page, which no longer has the project.
    rerender(
      <Dashboard projects={PROJECTS.filter((p) => p.id !== "a")} folders={FOLDERS} recentIds={RECENT_IDS} view={{ kind: "all" }} canEdit now={NOW} actions={actions} spaceSlug="seattle-solvers" />,
    );
    await act(async () => answer({ error: "That project no longer exists." }));
    expect(screen.queryByRole("link", { name: "Qual recap" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("That project no longer exists.");
    expect(alert.closest("[class*=sticky]")).not.toBeNull();
    expect(alert.className).toContain("text-ed-danger");
  });

  it("a card in Recent says so in the bar too", async () => {
    const { actions, rerender } = renderDashboard({ view: { kind: "recent" } });
    let answer: (state: FormState) => void = () => {};
    actions.duplicate.mockImplementation(() => new Promise<FormState>((resolve) => (answer = resolve)));
    await pick(within(region("Recent")).getByRole("link", { name: "Finals" }).closest("li")!, "Duplicate");
    rerender(
      <Dashboard projects={PROJECTS.filter((p) => p.id !== "c")} folders={FOLDERS} recentIds={RECENT_IDS} view={{ kind: "recent" }} canEdit now={NOW} actions={actions} spaceSlug="seattle-solvers" />,
    );
    await act(async () => answer({ error: "That project no longer exists." }));
    expect(screen.queryByRole("link", { name: "Finals" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("That project no longer exists.");
  });
});

describe("moving a card to a folder", () => {
  it("Move to folder… offers the folders and No folder, with the current one chosen", async () => {
    const { actions } = renderDashboard();
    await pick(card("Poster"), "Move to folder…");
    const moving = dialog("Move to folder");
    expect(radioNames()).toEqual(["No folder", "Season 2026", "Sponsors"]);
    expect(radio("Season 2026").checked).toBe(true);
    expect(radios().filter((r) => r.checked)).toHaveLength(1);
    expect(document.activeElement).toBe(radio("Season 2026"));
    const move = button(moving, "Move");
    expect(move.disabled).toBe(true);
    expect(move.className).toContain("bg-ed-accent");
    expect(button(moving, "Cancel")).toBeTruthy();
    fireEvent.click(radio("Sponsors"));
    expect(move.disabled).toBe(false);
    await click(move);
    expect(actions.move).toHaveBeenCalledTimes(1);
    expect(sent(actions.move)).toEqual({ id: "b", folderId: "f2" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moving out of a folder sends no folder", async () => {
    const { actions } = renderDashboard();
    await pick(card("Poster"), "Move to folder…");
    fireEvent.click(radio("No folder"));
    await click(button(dialog("Move to folder"), "Move"));
    expect(sent(actions.move)).toEqual({ id: "b", folderId: "" });
  });

  it("a project in no folder starts on No folder", async () => {
    renderDashboard();
    await pick(card("Qual recap"), "Move to folder…");
    expect(radio("No folder").checked).toBe(true);
    expect(button(dialog("Move to folder"), "Move").disabled).toBe(true);
  });

  it("Cancel moves nothing, and the next opening starts from the current folder", async () => {
    const { actions } = renderDashboard();
    const li = card("Poster");
    await pick(li, "Move to folder…");
    fireEvent.click(radio("Sponsors"));
    await click(button(dialog("Move to folder"), "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.move).not.toHaveBeenCalled();
    await pick(li, "Move to folder…");
    expect(radio("Season 2026").checked).toBe(true);
  });

  it("Move is held while moving", async () => {
    const { actions } = renderDashboard();
    // The move never settles while the test looks. It is finished at the end: React holds every later transition
    // until a running async action settles, and that would reach the tests after this one.
    let finish: (state: FormState) => void = () => {};
    actions.move.mockImplementation(() => new Promise<FormState>((resolve) => (finish = resolve)));
    await pick(card("Poster"), "Move to folder…");
    fireEvent.click(radio("Sponsors"));
    const move = button(dialog("Move to folder"), "Move");
    await click(move);
    expect(move.disabled).toBe(true);
    await click(move);
    expect(actions.move).toHaveBeenCalledTimes(1);
    await act(async () => finish({}));
  });

  it("a folder deleted meanwhile is explained in the dialog", async () => {
    const { actions } = renderDashboard();
    actions.move.mockResolvedValue({ error: "That folder no longer exists." });
    await pick(card("Poster"), "Move to folder…");
    fireEvent.click(radio("Sponsors"));
    await click(button(dialog("Move to folder"), "Move"));
    const alert = within(dialog("Move to folder")).getByRole("alert");
    expect(alert.textContent).toBe("That folder no longer exists.");
    expect(alert.className).toContain("text-ed-danger");
  });
});

describe("deleting a card", () => {
  it("Delete asks first", async () => {
    const { actions } = renderDashboard();
    const li = card("Qual recap");
    await pick(li, "Delete");
    const asking = dialog("Delete project");
    expect(within(asking).getByText('Delete "Qual recap"?')).toBeTruthy();
    expect(document.activeElement).toBe(button(asking, "Cancel"));
    expect(button(asking, "Delete").className).toContain("text-ed-danger");
    await click(button(asking, "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.remove).not.toHaveBeenCalled();
    await pick(li, "Delete");
    await click(button(dialog("Delete project"), "Delete"));
    expect(actions.remove).toHaveBeenCalledTimes(1);
    expect(sent(actions.remove)).toEqual({ id: "a" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refused delete stays in the dialog", async () => {
    const { actions } = renderDashboard();
    actions.remove.mockResolvedValue({ error: "Your role doesn't allow this." });
    const li = card("Qual recap");
    await pick(li, "Delete");
    await click(button(dialog("Delete project"), "Delete"));
    const alert = within(dialog("Delete project")).getByRole("alert");
    expect(alert.textContent).toBe("Your role doesn't allow this.");
    expect(alert.className).toContain("text-ed-danger");
    expect(button(dialog("Delete project"), "Delete").disabled).toBe(false);
    // Closing and asking again starts without the old message.
    await click(button(dialog("Delete project"), "Cancel"));
    await pick(li, "Delete");
    expect(within(dialog("Delete project")).queryByRole("alert")).toBeNull();
  });

  it("Delete is held while deleting", async () => {
    const { actions } = renderDashboard();
    // The delete never settles while the test looks. It is finished at the end: React holds every later transition
    // until a running async action settles, and that would reach the tests after this one.
    let finish: (state: FormState) => void = () => {};
    actions.remove.mockImplementation(() => new Promise<FormState>((resolve) => (finish = resolve)));
    await pick(card("Qual recap"), "Delete");
    const del = button(dialog("Delete project"), "Delete");
    await click(del);
    expect(del.disabled).toBe(true);
    await act(async () => finish({}));
  });
});

describe("the card's picture", () => {
  const PICTURED = [dashProject({ id: "a", name: "Qual recap", thumbnailVersion: 3 }), PROJECTS[1], PROJECTS[2]];
  const picture = (li: HTMLElement) => li.querySelector<HTMLImageElement>("[data-blank-frame] > img");

  it("a card with a picture shows it in its frame, unnamed and not draggable on its own", () => {
    renderDashboard({ projects: PICTURED });
    const li = card("Qual recap");
    const img = picture(li)!;
    expect(img.getAttribute("src")).toBe("/api/projects/a/thumbnail?v=3");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("draggable")).toBe("false");
    expect(img.classList).toContain("size-full");
    expect(img.classList).toContain("object-cover");
    expect(within(li).getByRole("link", { name: "Qual recap" })).toBeTruthy();
    expect(li.getAttribute("draggable")).toBe("true");
  });

  it("a card without a picture shows only the blank frame", () => {
    renderDashboard({ projects: PICTURED });
    const li = card("Poster");
    expect(li.querySelector("[data-blank-frame] img")).toBeNull();
    expect(li.querySelector("[data-blank-frame]")?.getAttribute("style")).toContain("aspect-ratio: 816 / 1056");
  });

  it("a picture that fails to load leaves the blank frame, until a newer one comes", () => {
    const { actions, rerender } = renderDashboard({ projects: PICTURED });
    fireEvent.error(picture(card("Qual recap"))!);
    expect(picture(card("Qual recap"))).toBeNull();
    expect(card("Qual recap").querySelector("[data-blank-frame]")).not.toBeNull();
    rerender(
      <Dashboard spaceSlug="seattle-solvers"
        projects={[{ ...PICTURED[0], thumbnailVersion: 4 }, PROJECTS[1], PROJECTS[2]]}
        folders={FOLDERS}
        recentIds={RECENT_IDS}
        view={{ kind: "all" }}
        canEdit
        now={NOW}
        actions={actions}
      />,
    );
    expect(picture(card("Qual recap"))?.getAttribute("src")).toMatch(/\?v=4$/);
  });

  it("a picture of another shape is out of date and leaves the blank frame", () => {
    renderDashboard({ projects: PICTURED }); // Qual recap is 1080 × 1920
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(360);
    fireEvent.load(picture(card("Qual recap"))!);
    expect(picture(card("Qual recap"))).toBeNull();
    expect(card("Qual recap").querySelector("[data-blank-frame]")).not.toBeNull();
  });

  it("a picture in the project's shape stays once it loads", () => {
    renderDashboard({ projects: PICTURED });
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(360);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(640);
    fireEvent.load(picture(card("Qual recap"))!);
    expect(picture(card("Qual recap"))?.getAttribute("src")).toBe("/api/projects/a/thumbnail?v=3");
  });

  it("a card hydrated from the server's markup asks for its picture again, so its load or error still counts", () => {
    const element = (
      <ProjectCard project={PICTURED[0]} folderName={null} now={NOW} canEdit folders={FOLDERS} actions={fakeActions()} spaceSlug="seattle-solvers" onGone={() => {}} />
    );
    const list = document.createElement("ul");
    document.body.appendChild(list);
    list.innerHTML = renderToString(element);
    const setSrc = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    let root!: Root;
    act(() => {
      root = hydrateRoot(list, element);
    });
    expect(setSrc).toHaveBeenCalledWith("/api/projects/a/thumbnail?v=3");
    act(() => root.unmount());
    list.remove();
  });

  it("the card still drags with its id when it has a picture", () => {
    renderDashboard({ projects: PICTURED });
    const li = card("Qual recap");
    const event = dragEvent("dragstart");
    act(() => {
      li.dispatchEvent(event);
    });
    const transfer = (event as unknown as { dataTransfer: DataTransfer }).dataTransfer;
    expect(transfer.getData(PROJECT_DRAG_TYPE)).toBe("a");
  });

  it("a recent card and a custom-size card show their pictures in their own shape", () => {
    const all = renderDashboard({
      projects: [
        dashProject({ id: "a", name: "Qual recap", thumbnailVersion: 3 }),
        { ...PROJECTS[1], thumbnailVersion: 1 },
        { ...PROJECTS[2], thumbnailVersion: 2 },
      ],
    });
    const poster = card("Poster").querySelector("[data-blank-frame]")!;
    expect(poster.getAttribute("style")).toContain("aspect-ratio: 816 / 1056");
    expect(poster.querySelector("img")?.getAttribute("src")).toBe("/api/projects/b/thumbnail?v=1");
    all.unmount();
    renderDashboard({
      view: { kind: "recent" },
      projects: [dashProject({ id: "a", name: "Qual recap", thumbnailVersion: 3 }), { ...PROJECTS[1], thumbnailVersion: 1 }, { ...PROJECTS[2], thumbnailVersion: 2 }],
    });
    const recent = within(region("Recent")).getByRole("link", { name: "Finals" });
    const img = recent.querySelector("[data-blank-frame] > img")!;
    expect(img.getAttribute("src")).toBe("/api/projects/c/thumbnail?v=2");
    expect(img.parentElement!.getAttribute("style")).toContain("aspect-ratio: 1920 / 1080");
  });
});
