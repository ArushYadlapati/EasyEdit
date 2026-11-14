// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "@/components/dashboard/dashboard";
import { PROJECT_DRAG_TYPE } from "@/components/dashboard/drag";
import type { FormState } from "@/lib/projects/dashboard-actions";
import { FOLDERS, NOW, PROJECTS, RECENT_IDS, renderDashboard } from "../helpers/dashboard";
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

const nav = () => screen.getByRole("navigation", { name: "Folders" });
const navLink = (name: string | RegExp) => within(nav()).getByRole("link", { name });
const card = (name: string) => within(screen.getByRole("region", { name: "All projects" })).getByRole("link", { name }).closest("li")!;
const dialog = (name: string) => screen.getByRole("dialog", { name });
const button = (inside: HTMLElement, name: string) => within(inside).getByRole("button", { name }) as HTMLButtonElement;
const nameField = (inside: HTMLElement) => within(inside).getByRole("textbox", { name: "Name" }) as HTMLInputElement;
const sent = (fn: { mock: { calls: [FormData][] } }, call = 0) => Object.fromEntries(fn.mock.calls[call][0].entries());
const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(" ");

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

// Opens the folder's ⋯ menu and picks an item.
async function pickFolderOption(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Folder options" }));
  await click(screen.getByRole("menuitem", { name: label }));
}

// dragEvent's MouseEvent carries a dataTransfer that its type does not name.
const transferOf = (event: MouseEvent) => (event as unknown as { dataTransfer: DataTransfer }).dataTransfer;

// Sends a drag event and says whether a handler took it (called preventDefault), letting any action it starts settle.
async function drag(
  target: Element,
  type: "dragstart" | "dragover" | "dragleave" | "drop",
  init: Parameters<typeof dragEvent>[1] = {},
) {
  const event = dragEvent(type, init);
  let notTaken = true;
  await act(async () => {
    notTaken = target.dispatchEvent(event);
  });
  return { taken: !notTaken, transfer: transferOf(event) };
}
const projectDrag = { types: [PROJECT_DRAG_TYPE] };
const dropOf = (id: string) => ({ data: { [PROJECT_DRAG_TYPE]: id } });

describe("folders in the sidebar", () => {
  it("New folder asks for a name and creates it", async () => {
    const { actions } = renderDashboard();
    await click(within(nav()).getByRole("button", { name: "New folder" }));
    const asking = dialog("New folder");
    const field = nameField(asking);
    expect(document.activeElement).toBe(field);
    expect(field.maxLength).toBe(60);
    fireEvent.change(field, { target: { value: "Season 2027" } });
    await click(button(asking, "Create folder"));
    expect(actions.createFolder).toHaveBeenCalledTimes(1);
    expect(sent(actions.createFolder)).toEqual({ name: "Season 2027" });
    expect(screen.queryByRole("dialog", { name: "New folder" })).toBeNull();
  });

  it("Enter in Name creates the folder, and Cancel creates nothing", async () => {
    const { actions } = renderDashboard();
    const newFolder = within(nav()).getByRole("button", { name: "New folder" });
    expect(newFolder.querySelector("svg")?.getAttribute("class")).toContain("lucide-plus");
    await click(newFolder);
    expect(nameField(dialog("New folder")).value).toBe("");
    await click(button(dialog("New folder"), "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await click(newFolder);
    const field = nameField(dialog("New folder"));
    const create = button(dialog("New folder"), "Create folder");
    expect(create.getAttribute("type")).toBe("submit");
    expect(create.getAttribute("form")).toBe(field.form!.id);
    expect(create.className).toContain("bg-ed-accent");
    fireEvent.change(field, { target: { value: "Sponsors 2" } });
    await act(async () => {
      fireEvent.submit(field.form!);
    });
    expect(actions.createFolder).toHaveBeenCalledTimes(1);
    expect(sent(actions.createFolder)).toEqual({ name: "Sponsors 2" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a taken name is explained in the dialog", async () => {
    const { actions } = renderDashboard();
    actions.createFolder.mockResolvedValue({ error: "There's already a folder with that name." });
    await click(within(nav()).getByRole("button", { name: "New folder" }));
    fireEvent.change(nameField(dialog("New folder")), { target: { value: "Sponsors" } });
    await click(button(dialog("New folder"), "Create folder"));
    expect(within(dialog("New folder")).getByRole("alert").textContent).toBe("There's already a folder with that name.");
    // The next opening starts afresh.
    await click(button(dialog("New folder"), "Cancel"));
    await click(within(nav()).getByRole("button", { name: "New folder" }));
    expect(within(dialog("New folder")).queryByRole("alert")).toBeNull();
    expect(nameField(dialog("New folder")).value).toBe("");
  });

  it("Create folder is held while it runs", async () => {
    const { actions } = renderDashboard();
    // The create never settles while the test looks. It is finished at the end: React holds every later transition
    // until a running async action settles, and that would reach the tests after this one.
    let finish: (state: FormState) => void = () => {};
    actions.createFolder.mockImplementation(() => new Promise<FormState>((resolve) => (finish = resolve)));
    await click(within(nav()).getByRole("button", { name: "New folder" }));
    fireEvent.change(nameField(dialog("New folder")), { target: { value: "Season 2027" } });
    const create = button(dialog("New folder"), "Create folder");
    await click(create);
    expect(create.disabled).toBe(true);
    await click(create);
    await act(async () => {
      fireEvent.submit(nameField(dialog("New folder")).form!);
    });
    expect(actions.createFolder).toHaveBeenCalledTimes(1);
    await act(async () => finish({}));
  });

  it("New folder stays in the folder row on a phone, after the folders", () => {
    renderDashboard();
    const newFolder = within(nav()).getByRole("button", { name: "New folder" });
    const heading = within(nav()).getByRole("heading", { name: "Folders" });
    expect(newFolder.parentElement).toBe(heading.parentElement);
    expect(classes(newFolder.parentElement)).toEqual(expect.arrayContaining(["contents", "md:flex"]));
    expect(classes(newFolder)).toEqual(expect.arrayContaining(["order-last", "md:order-none"]));
    expect(classes(newFolder)).not.toContain("sr-only");
  });

  it("a folder's menu renames it", async () => {
    const { actions } = renderDashboard({ view: "f1" });
    const menuButton = screen.getByRole("button", { name: "Folder options" });
    expect(menuButton.closest("[class*=sticky]")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).nextElementSibling?.contains(menuButton)).toBe(true);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(classes(heading)).not.toContain("flex-1");
    expect(classes(heading.parentElement)).toContain("flex-1");
    expect(heading.parentElement!.contains(menuButton)).toBe(true);
    expect(menuButton.querySelector("svg")?.getAttribute("class")).toContain("lucide-ellipsis");
    fireEvent.click(menuButton);
    const items = within(screen.getByRole("menu", { name: "Folder options" })).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Rename folder", "Delete folder"]);
    expect(items[1].className).toContain("text-ed-danger");
    await click(items[0]);
    const renaming = dialog("Rename folder");
    const field = nameField(renaming);
    expect(field.value).toBe("Season 2026");
    expect(field.maxLength).toBe(60);
    fireEvent.change(field, { target: { value: "Season 2027" } });
    await click(button(renaming, "Save"));
    expect(actions.renameFolder).toHaveBeenCalledTimes(1);
    expect(sent(actions.renameFolder)).toEqual({ id: "f1", name: "Season 2027" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deleting a folder asks first and keeps its projects", async () => {
    const { actions } = renderDashboard({ view: "f1" });
    await pickFolderOption("Delete folder");
    const asking = dialog("Delete folder");
    expect(within(asking).getByText('Delete the folder "Season 2026"? Its projects stay in All projects.')).toBeTruthy();
    expect(button(asking, "Delete folder").className).toContain("text-ed-danger");
    await click(button(asking, "Delete folder"));
    expect(actions.deleteFolder).toHaveBeenCalledTimes(1);
    expect(sent(actions.deleteFolder)).toEqual({ id: "f1" });
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("a refused folder delete stays in the dialog, and Cancel deletes nothing", async () => {
    const { actions } = renderDashboard({ view: "f1" });
    await pickFolderOption("Delete folder");
    await click(button(dialog("Delete folder"), "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.deleteFolder).not.toHaveBeenCalled();
    actions.deleteFolder.mockResolvedValue({ error: "That folder no longer exists." });
    await pickFolderOption("Delete folder");
    await click(button(dialog("Delete folder"), "Delete folder"));
    expect(within(dialog("Delete folder")).getByRole("alert").textContent).toBe("That folder no longer exists.");
    expect(button(dialog("Delete folder"), "Delete folder").disabled).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
    // The next opening starts with no message.
    await click(button(dialog("Delete folder"), "Cancel"));
    await pickFolderOption("Delete folder");
    expect(within(dialog("Delete folder")).queryByRole("alert")).toBeNull();
  });

  // The refusal refreshes the page, and the address's folder is then unknown, so the page shows the main view.
  it.each([
    ["Rename folder", "Save", "renameFolder"],
    ["Delete folder", "Delete folder", "deleteFolder"],
  ] as const)("%s on a folder deleted elsewhere says so in the dialog", async (option, confirmLabel, actionName) => {
    const { actions, rerender } = renderDashboard({ view: "f1" });
    let answer: (state: FormState) => void = () => {};
    actions[actionName].mockImplementation(() => new Promise<FormState>((resolve) => (answer = resolve)));
    await pickFolderOption(option);
    await click(button(dialog(option), confirmLabel));
    rerender(
      <Dashboard
        projects={PROJECTS.map((p) => ({ ...p, folderId: p.folderId === "f1" ? null : p.folderId }))}
        folders={FOLDERS.filter((f) => f.id !== "f1")}
        recentIds={RECENT_IDS}
        view={null}
        canEdit
        now={NOW}
        actions={actions}
      />,
    );
    await act(async () => {
      answer({ error: "That folder no longer exists." });
    });
    const asking = dialog(option);
    expect(within(asking).getByRole("alert").textContent).toBe("That folder no longer exists.");
    expect(asking.contains(document.activeElement)).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
    await click(button(asking, "Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Delete folder is held while it runs", async () => {
    const { actions } = renderDashboard({ view: "f1" });
    // The delete never settles while the test looks. It is finished at the end: React holds every later transition
    // until a running async action settles, and that would reach the tests after this one.
    let finish: (state: FormState) => void = () => {};
    actions.deleteFolder.mockImplementation(() => new Promise<FormState>((resolve) => (finish = resolve)));
    await pickFolderOption("Delete folder");
    const confirm = button(dialog("Delete folder"), "Delete folder");
    await click(confirm);
    expect(confirm.disabled).toBe(true);
    await click(confirm);
    expect(actions.deleteFolder).toHaveBeenCalledTimes(1);
    await act(async () => finish({}));
  });

  it("the main view has no folder menu", () => {
    renderDashboard();
    expect(screen.queryByRole("button", { name: "Folder options" })).toBeNull();
  });

  it("a viewer has no New folder and no folder menu", () => {
    renderDashboard({ canEdit: false, view: "f1" });
    expect(screen.queryByRole("button", { name: "New folder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Folder options" })).toBeNull();
  });
});

describe("dragging projects into folders", () => {
  it("the card hands its id to the drag", async () => {
    renderDashboard();
    const li = card("Qual recap");
    expect(li.getAttribute("draggable")).toBe("true");
    expect(within(li).getByRole("link", { name: "Qual recap" }).getAttribute("draggable")).toBe("false");
    expect(PROJECT_DRAG_TYPE).toBe("application/x-easyedit-project");
    const { transfer } = await drag(li, "dragstart");
    expect(transfer.getData(PROJECT_DRAG_TYPE)).toBe("a");
    expect(transfer.effectAllowed).toBe("move");
    // A drag that starts on something inside the card, such as selected text, is not the card's.
    const inner = await drag(within(li).getByText("Vertical 9:16"), "dragstart");
    expect(inner.transfer.getData(PROJECT_DRAG_TYPE)).toBe("");
  });

  it("a card being renamed is not dragged, and a drag from inside it carries no project", async () => {
    renderDashboard();
    const li = card("Qual recap");
    fireEvent.click(within(li).getByRole("button", { name: "Project options" }));
    await click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(li.getAttribute("draggable")).toBe("false");
    const { transfer } = await drag(within(li).getByRole("textbox"), "dragstart");
    expect(transfer.getData(PROJECT_DRAG_TYPE)).toBe("");
  });

  it("drag a card onto a folder to move it there, or onto Projects to take it out", async () => {
    const { actions } = renderDashboard();
    const sponsors = navLink(/^Sponsors/);
    const over = await drag(sponsors, "dragover", projectDrag);
    expect(over.taken).toBe(true);
    expect(over.transfer.dropEffect).toBe("move");
    expect(sponsors.hasAttribute("data-drop-over")).toBe(true);
    expect(classes(sponsors)).toEqual(
      expect.arrayContaining(["data-drop-over:outline-2", "data-drop-over:outline-ed-accent", "data-drop-over:bg-ed-accent-weak"]),
    );
    // Moving onto the link's own count keeps the look.
    await drag(sponsors, "dragleave", { ...projectDrag, relatedTarget: sponsors.lastElementChild });
    expect(sponsors.hasAttribute("data-drop-over")).toBe(true);
    await drag(sponsors, "dragleave", projectDrag);
    expect(sponsors.hasAttribute("data-drop-over")).toBe(false);
    await drag(sponsors, "dragover", projectDrag);
    const dropped = await drag(sponsors, "drop", dropOf("a"));
    expect(dropped.taken).toBe(true);
    expect(actions.move).toHaveBeenCalledTimes(1);
    expect(sent(actions.move)).toEqual({ id: "a", folderId: "f2" });
    expect(sponsors.hasAttribute("data-drop-over")).toBe(false);

    const projects = navLink("Projects");
    expect((await drag(projects, "dragover", projectDrag)).taken).toBe(true);
    expect(projects.hasAttribute("data-drop-over")).toBe(true);
    await drag(projects, "drop", dropOf("b"));
    expect(actions.move).toHaveBeenCalledTimes(2);
    expect(sent(actions.move, 1)).toEqual({ id: "b", folderId: "" });
    expect(projects.hasAttribute("data-drop-over")).toBe(false);

    await drag(navLink(/^Season 2026/), "drop", dropOf("b"));
    await drag(projects, "drop", dropOf("a"));
    expect(actions.move).toHaveBeenCalledTimes(2);
  });

  it("a drop of an unknown project is ignored", async () => {
    const { actions } = renderDashboard();
    await drag(navLink(/^Sponsors/), "drop", dropOf("zzz"));
    expect(actions.move).not.toHaveBeenCalled();
  });

  it("a drop onto a folder deleted elsewhere says so", async () => {
    const { actions } = renderDashboard();
    actions.move.mockResolvedValue({ error: "That folder no longer exists." });
    await drag(navLink(/^Sponsors/), "drop", dropOf("a"));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("That folder no longer exists.");
    expect(alert.closest("[class*=sticky]")).not.toBeNull();
    expect(alert.className).toContain("text-ed-danger");
    // A drop that goes through clears it.
    actions.move.mockResolvedValue({});
    await drag(navLink(/^Season 2026/), "drop", dropOf("a"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a refused drop's message goes when the view changes", async () => {
    const { actions, rerender } = renderDashboard();
    actions.move.mockResolvedValue({ error: "That folder no longer exists." });
    await drag(navLink(/^Sponsors/), "drop", dropOf("a"));
    expect(screen.getByRole("alert").textContent).toBe("That folder no longer exists.");
    rerender(<Dashboard projects={PROJECTS} folders={FOLDERS} recentIds={RECENT_IDS} view="f1" canEdit now={NOW} actions={actions} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("files and viewers are not taken", async () => {
    const { unmount } = renderDashboard();
    const files = await drag(navLink(/^Sponsors/), "dragover", { types: ["Files"] });
    expect(files.taken).toBe(false);
    expect(navLink(/^Sponsors/).hasAttribute("data-drop-over")).toBe(false);
    expect((await drag(navLink(/^Sponsors/), "drop", { types: ["Files"] })).taken).toBe(false);
    unmount();

    const { actions } = renderDashboard({ canEdit: false });
    const li = card("Qual recap");
    expect(li.getAttribute("draggable")).not.toBe("true");
    expect((await drag(navLink(/^Sponsors/), "dragover", projectDrag)).taken).toBe(false);
    expect((await drag(navLink("Projects"), "dragover", projectDrag)).taken).toBe(false);
    expect((await drag(navLink(/^Sponsors/), "drop", dropOf("a"))).taken).toBe(false);
    const { transfer } = await drag(li, "dragstart");
    expect(transfer.getData(PROJECT_DRAG_TYPE)).toBe("");
    expect(actions.move).not.toHaveBeenCalled();
  });
});

describe("folders on the home page", () => {
  const main = () => screen.getByRole("main");
  const tiles = () => screen.getByRole("region", { name: "Folders" });
  const tile = (name: RegExp) => within(tiles()).getByRole("link", { name });
  const sectionHeadings = () => within(main()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

  it("the main view shows Folders between Recent and All projects", () => {
    renderDashboard();
    expect(sectionHeadings()).toEqual(["Recent", "Folders", "All projects"]);
  });

  it("with nothing recent, Folders comes first", () => {
    renderDashboard({ recentIds: [] });
    expect(sectionHeadings()).toEqual(["Folders", "All projects"]);
  });

  it("each folder is a tile with its name and count that opens the folder", () => {
    renderDashboard();
    const links = within(tiles()).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(["Season 2026, 1 project", "Sponsors, 0 projects"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/dashboard?folder=f1", "/dashboard?folder=f2"]);
    expect(links[0].querySelector("svg")).not.toBeNull(); // the folder icon
    expect(links[0].textContent).toBe("Season 20261");
    expect(classes(within(tiles()).getByRole("list"))).toContain("grid-cols-[repeat(auto-fill,minmax(200px,1fr))]");
  });

  it("a long name truncates and keeps its count", () => {
    renderDashboard({ folders: [{ id: "f9", name: "A".repeat(80), projectCount: 12 }] });
    const link = tile(/^A+, 12 projects$/);
    const [name, count] = [link.querySelector("span:first-of-type")!, link.querySelector("span:last-of-type")!];
    expect(classes(name)).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
    expect(classes(count)).toContain("shrink-0");
    expect(count.textContent).toBe("12");
  });

  it("there is no Folders section while searching, in a folder, or with no folders", () => {
    const { unmount } = renderDashboard();
    const search = screen.getByRole("searchbox", { name: "Search projects" });
    fireEvent.change(search, { target: { value: "Qual" } });
    expect(screen.queryByRole("region", { name: "Folders" })).toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    expect(tiles()).toBeTruthy();
    unmount();
    const folderView = renderDashboard({ view: "f1" });
    expect(screen.queryByRole("region", { name: "Folders" })).toBeNull();
    folderView.unmount();
    renderDashboard({ folders: [] });
    expect(screen.queryByRole("region", { name: "Folders" })).toBeNull();
  });

  it("drag a card from All projects onto a tile to move it there", async () => {
    const { actions } = renderDashboard();
    const sponsors = tile(/^Sponsors/);
    const over = await drag(sponsors, "dragover", projectDrag);
    expect(over.taken).toBe(true);
    expect(over.transfer.dropEffect).toBe("move");
    expect(sponsors.hasAttribute("data-drop-over")).toBe(true);
    expect(classes(sponsors)).toEqual(
      expect.arrayContaining(["data-drop-over:outline-2", "data-drop-over:outline-ed-accent", "data-drop-over:bg-ed-accent-weak"]),
    );
    // Moving onto the tile's own count keeps the look.
    await drag(sponsors, "dragleave", { ...projectDrag, relatedTarget: sponsors.lastElementChild });
    expect(sponsors.hasAttribute("data-drop-over")).toBe(true);
    const dropped = await drag(sponsors, "drop", dropOf("a"));
    expect(dropped.taken).toBe(true);
    expect(actions.move).toHaveBeenCalledTimes(1);
    expect(sent(actions.move)).toEqual({ id: "a", folderId: "f2" });
    expect(sponsors.hasAttribute("data-drop-over")).toBe(false);
    // Poster is already in Season 2026.
    await drag(tile(/^Season 2026/), "drop", dropOf("b"));
    expect(actions.move).toHaveBeenCalledTimes(1);
  });

  it("a refused drop on a tile says so in the bar", async () => {
    const { actions } = renderDashboard();
    actions.move.mockResolvedValue({ error: "That folder no longer exists." });
    await drag(tile(/^Sponsors/), "drop", dropOf("a"));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("That folder no longer exists.");
    expect(alert.closest("[class*=sticky]")).not.toBeNull();
  });

  it("files and viewers are not taken by a tile, but a viewer still sees the tiles", async () => {
    const { unmount } = renderDashboard();
    expect((await drag(tile(/^Sponsors/), "dragover", { types: ["Files"] })).taken).toBe(false);
    expect(tile(/^Sponsors/).hasAttribute("data-drop-over")).toBe(false);
    unmount();
    const { actions } = renderDashboard({ canEdit: false });
    expect(tile(/^Sponsors/).getAttribute("href")).toBe("/dashboard?folder=f2");
    expect((await drag(tile(/^Sponsors/), "dragover", projectDrag)).taken).toBe(false);
    expect((await drag(tile(/^Sponsors/), "drop", dropOf("a"))).taken).toBe(false);
    expect(actions.move).not.toHaveBeenCalled();
  });
});
