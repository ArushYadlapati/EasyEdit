// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDashboard } from "../helpers/dashboard";
import { fireEvent, screen, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
  router.bfcacheId = "b0";
});

const main = () => screen.getByRole("main");
const nav = () => screen.getByRole("navigation", { name: "Projects" });
const mainHeadings = () => within(main()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const region = (name: string) => screen.getByRole("region", { name });
const linkNames = (el: HTMLElement) => within(el).queryAllByRole("link").map((a) => a.textContent);
// The section of project cards: headed Projects under the folder tiles, otherwise named by the title.
const grid = () => screen.getByRole("region", { name: /^(All projects|Projects|Recent)$/ });
const card = (name: string) => within(grid()).getByRole("link", { name }).closest("li")!;
const search = () => screen.getByRole("searchbox", { name: "Search projects" });
const sortBy = () => screen.getByRole("combobox", { name: "Sort by" }) as HTMLSelectElement;

describe("the dashboard", () => {
  it("All projects shows the folder tiles, then every project, under a sticky bar with New project", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("All projects");
    expect(mainHeadings()).toEqual(["Folders", "Projects"]);
    expect(linkNames(region("Projects"))).toEqual(["Qual recap", "Poster", "Finals"]);
    const button = screen.getByRole("button", { name: "New project" });
    expect(button.closest("[class*=sticky]")).not.toBeNull();
  });

  it("without folders, All projects is one list named by the title", () => {
    renderDashboard({ folders: [] });
    expect(within(main()).queryAllByRole("heading", { level: 2 })).toEqual([]);
    expect(linkNames(region("All projects"))).toEqual(["Qual recap", "Poster", "Finals"]);
  });

  it("Recent lists only the projects you opened last, in that order, with no sort", () => {
    renderDashboard({ view: { kind: "recent" }, recentIds: ["c", "gone", "a"] });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Recent");
    expect(linkNames(region("Recent"))).toEqual(["Finals", "Qual recap"]);
    expect(within(main()).queryAllByRole("heading", { level: 2 })).toEqual([]);
    expect(screen.queryByRole("combobox", { name: "Sort by" })).toBeNull();
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();
  });

  it("Recent with nothing opened points to All projects; search narrows it", () => {
    const { unmount } = renderDashboard({ view: { kind: "recent" }, recentIds: ["gone"] });
    expect(screen.getByText("Projects you open show up here.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See all projects" }).getAttribute("href")).toBe("/s/seattle-solvers?view=all");
    unmount();
    renderDashboard({ view: { kind: "recent" }, recentIds: ["c", "a"] });
    fireEvent.change(search(), { target: { value: "qual" } });
    expect(linkNames(region("Recent"))).toEqual(["Qual recap"]);
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.getByText('No recent projects match "zzz".')).toBeTruthy();
  });

  it("a card shows its frame, format, who changed it and its folder", () => {
    renderDashboard();
    const poster = card("Poster");
    expect(within(poster).getByText("Custom 816 × 1056")).toBeTruthy();
    expect(within(poster).getByText("Changed 1 hr ago by Sam")).toBeTruthy();
    expect(within(poster).getByText("Season 2026")).toBeTruthy();
    expect(within(poster).getByRole("link", { name: "Poster" }).getAttribute("href")).toBe("/s/seattle-solvers/editor/b");
    expect(poster.querySelector("[data-blank-frame]")?.getAttribute("style")).toContain("aspect-ratio: 816 / 1056");
    const qual = card("Qual recap");
    expect(within(qual).getByText("Vertical 9:16")).toBeTruthy();
    expect(within(qual).getByText("Changed 5 min ago by Sam")).toBeTruthy();
    expect(qual.textContent).not.toContain("Season 2026");
    expect(within(card("Finals")).getByText("Landscape 16:9")).toBeTruthy();
  });

  it("a card in Recent or a folder view shows no folder name", () => {
    renderDashboard({ view: { kind: "recent" }, recentIds: ["b"] });
    const recent = within(region("Recent")).getByRole("link", { name: "Poster" }).closest("li")!;
    expect(recent.textContent).not.toContain("Season 2026");
  });

  it("a viewer sees no New project", () => {
    renderDashboard({ canEdit: false });
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
  });

  it("search filters by name and hides the folder tiles", () => {
    renderDashboard();
    expect(search().getAttribute("placeholder")).toBe("Search projects");
    fireEvent.change(search(), { target: { value: "qual" } });
    expect(linkNames(grid())).toEqual(["Qual recap"]);
    expect(screen.queryByRole("region", { name: "Folders" })).toBeNull();
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.getByText('No projects match "zzz".')).toBeTruthy();
  });

  it("sort by name and by date created", () => {
    renderDashboard();
    expect([...sortBy().options].map((o) => o.textContent)).toEqual(["Last changed", "Name", "Date created"]);
    expect(sortBy().selectedOptions[0].textContent).toBe("Last changed");
    fireEvent.change(sortBy(), { target: { value: "name" } });
    expect(linkNames(grid())).toEqual(["Finals", "Poster", "Qual recap"]);
    fireEvent.change(sortBy(), { target: { value: "created" } });
    expect(linkNames(grid())).toEqual(["Poster", "Qual recap", "Finals"]);
    fireEvent.change(sortBy(), { target: { value: "changed" } });
    expect(linkNames(grid())).toEqual(["Qual recap", "Poster", "Finals"]);
  });

  it("a folder view lists that folder's projects under its name, without the tiles", () => {
    renderDashboard({ view: { kind: "folder", folderId: "f1" } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Season 2026");
    expect(linkNames(main())).toEqual(["Poster"]);
    expect(region("Season 2026")).toBeTruthy();
    expect(within(main()).queryAllByRole("heading", { level: 2 })).toEqual([]);
    expect(within(main()).getByRole("link", { name: "Poster" }).closest("li")!.textContent).not.toContain("Season 2026");
    expect(within(nav()).getByRole("link", { name: /^Season 2026/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav()).getByRole("link", { name: "All projects" }).hasAttribute("aria-current")).toBe(false);
    // The view in sight has the accent look; the others do not.
    expect(within(nav()).getByRole("link", { name: /^Season 2026/ }).className).toContain("text-ed-accent");
    expect(within(nav()).getByRole("link", { name: "All projects" }).className).not.toContain("text-ed-accent");
  });

  it("the sidebar lists Recent and All projects under Projects, then each folder with its count", () => {
    const { unmount } = renderDashboard();
    expect(within(nav()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Projects", "Folders"]);
    expect(linkNames(nav()).slice(0, 2)).toEqual(["Recent", "All projects"]);
    const recent = within(nav()).getByRole("link", { name: "Recent" });
    expect(recent.getAttribute("href")).toBe("/s/seattle-solvers");
    expect(recent.hasAttribute("aria-current")).toBe(false);
    const all = within(nav()).getByRole("link", { name: "All projects" });
    expect(all.getAttribute("href")).toBe("/s/seattle-solvers?view=all");
    expect(all.getAttribute("aria-current")).toBe("page");
    unmount();
    renderDashboard({ view: { kind: "recent" } });
    expect(within(nav()).getByRole("link", { name: "Recent" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav()).getByRole("link", { name: "All projects" }).hasAttribute("aria-current")).toBe(false);
  });

  it("the sidebar's folders link to their views with their counts", () => {
    renderDashboard();
    const season = within(nav()).getByRole("link", { name: /^Season 2026/ });
    expect(season.getAttribute("href")).toBe("/s/seattle-solvers?folder=f1");
    expect(season.textContent).toContain("1");
    expect(season.hasAttribute("aria-current")).toBe(false);
    expect(within(nav()).getByRole("link", { name: /^Sponsors/ }).textContent).toContain("0");
  });

  it("empty states say what to do", () => {
    const editor = renderDashboard({ projects: [] });
    expect(screen.getByText("No projects yet.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New project" })).toHaveLength(2);
    editor.unmount();
    // In a space with no projects, Recent says the same, not "projects you open".
    const recentEditor = renderDashboard({ projects: [], view: { kind: "recent" } });
    expect(screen.getByText("No projects yet.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New project" })).toHaveLength(2);
    recentEditor.unmount();
    const viewer = renderDashboard({ projects: [], canEdit: false });
    expect(screen.getByText("No projects yet.")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "New project" })).toHaveLength(0);
    viewer.unmount();
    const folderEditor = renderDashboard({ view: { kind: "folder", folderId: "f2" } });
    expect(
      screen.getByText("No projects in this folder yet. Drag a project here, or use Move to folder in its menu."),
    ).toBeTruthy();
    folderEditor.unmount();
    renderDashboard({ view: { kind: "folder", folderId: "f2" }, canEdit: false });
    expect(screen.getByText("No projects in this folder yet.")).toBeTruthy();
  });

  it("a search with no match in a folder says so, and the second New project opens the dialog", () => {
    const first = renderDashboard({ view: { kind: "folder", folderId: "f1" } });
    fireEvent.change(search(), { target: { value: "  nope " } });
    expect(screen.getByText('No projects match "nope".')).toBeTruthy();
    first.unmount();
    renderDashboard({ projects: [] });
    fireEvent.click(screen.getAllByRole("button", { name: "New project" })[1]);
    expect(screen.getByRole("dialog", { name: "New project" })).toBeTruthy();
  });

  it("New project opens the large dialog in the folder in view", () => {
    renderDashboard({ view: { kind: "folder", folderId: "f1" } });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    expect((within(dialog).getByRole("combobox", { name: "Folder" }) as HTMLSelectElement).value).toBe("f1");
  });

  it("the layout keeps to a phone's width and becomes columns on a wide window", () => {
    renderDashboard();
    const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(" ");
    const side = nav().parentElement!;
    expect(classes(side)).toEqual(
      expect.arrayContaining(["flex-row", "overflow-x-auto", "md:w-56", "md:flex-col", "md:border-r"]),
    );
    expect(classes(nav())).toEqual(expect.arrayContaining(["flex-row", "md:flex-col"]));
    for (const name of ["Projects", "Folders"]) {
      expect(classes(within(nav()).getByRole("heading", { name }))).toEqual(expect.arrayContaining(["sr-only", "md:not-sr-only"]));
    }
    expect(classes(side.parentElement)).toEqual(expect.arrayContaining(["flex-col", "md:flex-row", "min-h-0", "flex-1"]));
    expect(classes(main())).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "overflow-y-auto"]));
    const bar = main().firstElementChild!;
    expect(classes(bar)).toEqual(expect.arrayContaining(["sticky", "top-0", "z-10", "bg-ed-bg", "flex-wrap", "px-4"]));
    expect(classes(search().parentElement)).toEqual(expect.arrayContaining(["order-last", "w-full", "sm:order-none"]));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(classes(heading)).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
    expect(classes(heading.parentElement)).toEqual(expect.arrayContaining(["min-w-0", "flex-1"]));
    expect(classes(within(grid()).getByRole("list"))).toContain("grid-cols-[repeat(auto-fill,minmax(200px,1fr))]");
  });

  it("the dashboard refreshes when it comes back", () => {
    router.bfcacheId = "b-dash";
    const first = renderDashboard();
    first.unmount();
    expect(router.refresh).not.toHaveBeenCalled();
    renderDashboard();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("the dashboard shares the editor's colors but not its swipe rule", () => {
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
    expect(css).toContain(".editor, .ed-theme {");
    expect(css).toContain("html:has(.editor) { overscroll-behavior-x: none; }");
    expect(css).not.toContain("html:has(.ed-theme)");
  });
});
