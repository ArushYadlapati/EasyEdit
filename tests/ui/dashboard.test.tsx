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
const nav = () => screen.getByRole("navigation", { name: "Folders" });
const mainHeadings = () => within(main()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const region = (name: string) => screen.getByRole("region", { name });
const linkNames = (el: HTMLElement) => within(el).queryAllByRole("link").map((a) => a.textContent);
const card = (name: string) => within(region("All projects")).getByRole("link", { name }).closest("li")!;
const search = () => screen.getByRole("searchbox", { name: "Search projects" });
const sortBy = () => screen.getByRole("combobox", { name: "Sort by" }) as HTMLSelectElement;

describe("the dashboard", () => {
  it("an editor sees Recent, then All projects, under a sticky bar with New project", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Projects");
    expect(mainHeadings()).toEqual(["Recent", "All projects"]);
    expect(linkNames(region("Recent"))).toEqual(["Finals"]);
    expect(linkNames(region("All projects"))).toEqual(["Qual recap", "Poster", "Finals"]);
    const button = screen.getByRole("button", { name: "New project" });
    expect(button.closest("[class*=sticky]")).not.toBeNull();
  });

  it("Recent is hidden when you have opened nothing", () => {
    const { unmount } = renderDashboard({ recentIds: [] });
    expect(mainHeadings()).toEqual(["All projects"]);
    expect(linkNames(region("All projects"))).toEqual(["Qual recap", "Poster", "Finals"]);
    unmount();
    renderDashboard({ recentIds: ["gone"] });
    expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
  });

  it("a card shows its frame, format, who changed it and its folder", () => {
    renderDashboard();
    const poster = card("Poster");
    expect(within(poster).getByText("Custom 816 × 1056")).toBeTruthy();
    expect(within(poster).getByText("Changed 1 hr ago by Sam")).toBeTruthy();
    expect(within(poster).getByText("Season 2026")).toBeTruthy();
    expect(within(poster).getByRole("link", { name: "Poster" }).getAttribute("href")).toBe("/editor/b");
    expect(poster.querySelector("[data-blank-frame]")?.getAttribute("style")).toContain("aspect-ratio: 816 / 1056");
    const qual = card("Qual recap");
    expect(within(qual).getByText("Short 9:16")).toBeTruthy();
    expect(within(qual).getByText("Changed 5 min ago by Sam")).toBeTruthy();
    expect(qual.textContent).not.toContain("Season 2026");
    // Recent and folder views leave the folder's name off.
    const recent = within(region("Recent")).getByRole("link", { name: "Finals" }).closest("li")!;
    expect(within(recent).getByText("Long 16:9")).toBeTruthy();
  });

  it("a card in Recent or a folder view shows no folder name", () => {
    renderDashboard({ recentIds: ["b"] });
    const recent = within(region("Recent")).getByRole("link", { name: "Poster" }).closest("li")!;
    expect(recent.textContent).not.toContain("Season 2026");
    expect(card("Poster").textContent).toContain("Season 2026");
  });

  it("a viewer sees no New project", () => {
    renderDashboard({ canEdit: false });
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
  });

  it("search filters by name and hides Recent", () => {
    renderDashboard();
    expect(search().getAttribute("placeholder")).toBe("Search projects");
    fireEvent.change(search(), { target: { value: "qual" } });
    expect(linkNames(region("All projects"))).toEqual(["Qual recap"]);
    expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.getByText('No projects match "zzz".')).toBeTruthy();
  });

  it("sort by name and by date created", () => {
    renderDashboard();
    expect([...sortBy().options].map((o) => o.textContent)).toEqual(["Last changed", "Name", "Date created"]);
    expect(sortBy().selectedOptions[0].textContent).toBe("Last changed");
    fireEvent.change(sortBy(), { target: { value: "name" } });
    expect(linkNames(region("All projects"))).toEqual(["Finals", "Poster", "Qual recap"]);
    fireEvent.change(sortBy(), { target: { value: "created" } });
    expect(linkNames(region("All projects"))).toEqual(["Poster", "Qual recap", "Finals"]);
    fireEvent.change(sortBy(), { target: { value: "changed" } });
    expect(linkNames(region("All projects"))).toEqual(["Qual recap", "Poster", "Finals"]);
  });

  it("a folder view lists that folder's projects under its name, without Recent", () => {
    renderDashboard({ view: "f1" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Season 2026");
    expect(linkNames(main())).toEqual(["Poster"]);
    expect(region("Season 2026")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "All projects" })).toBeNull();
    expect(within(main()).getByRole("link", { name: "Poster" }).closest("li")!.textContent).not.toContain("Season 2026");
    expect(within(nav()).getByRole("link", { name: /^Season 2026/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav()).getByRole("link", { name: "Projects" }).hasAttribute("aria-current")).toBe(false);
    // The view in sight has the accent look; the others do not.
    expect(within(nav()).getByRole("link", { name: /^Season 2026/ }).className).toContain("text-ed-accent");
    expect(within(nav()).getByRole("link", { name: "Projects" }).className).not.toContain("text-ed-accent");
  });

  it("the sidebar lists Projects and each folder with its count", () => {
    renderDashboard();
    expect(within(nav()).getByRole("heading", { level: 2 }).textContent).toBe("Folders");
    const projects = within(nav()).getByRole("link", { name: "Projects" });
    expect(projects.getAttribute("href")).toBe("/dashboard");
    expect(projects.getAttribute("aria-current")).toBe("page");
    const season = within(nav()).getByRole("link", { name: /^Season 2026/ });
    expect(season.getAttribute("href")).toBe("/dashboard?folder=f1");
    expect(season.textContent).toContain("1");
    expect(season.hasAttribute("aria-current")).toBe(false);
    expect(within(nav()).getByRole("link", { name: /^Sponsors/ }).textContent).toContain("0");
  });

  it("empty states say what to do", () => {
    const editor = renderDashboard({ projects: [] });
    expect(screen.getByText("No projects yet.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New project" })).toHaveLength(2);
    editor.unmount();
    const viewer = renderDashboard({ projects: [], canEdit: false });
    expect(screen.getByText("No projects yet.")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "New project" })).toHaveLength(0);
    viewer.unmount();
    const folderEditor = renderDashboard({ view: "f2" });
    expect(
      screen.getByText("No projects in this folder yet. Drag a project here, or use Move to folder in its menu."),
    ).toBeTruthy();
    folderEditor.unmount();
    renderDashboard({ view: "f2", canEdit: false });
    expect(screen.getByText("No projects in this folder yet.")).toBeTruthy();
  });

  it("a search with no match in a folder says so, and the second New project opens the dialog", () => {
    const first = renderDashboard({ view: "f1" });
    fireEvent.change(search(), { target: { value: "  nope " } });
    expect(screen.getByText('No projects match "nope".')).toBeTruthy();
    first.unmount();
    renderDashboard({ projects: [] });
    fireEvent.click(screen.getAllByRole("button", { name: "New project" })[1]);
    expect(screen.getByRole("dialog", { name: "New project" })).toBeTruthy();
  });

  it("New project opens the large dialog in the folder in view", () => {
    renderDashboard({ view: "f1" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    expect((within(dialog).getByRole("combobox", { name: "Folder" }) as HTMLSelectElement).value).toBe("f1");
  });

  it("the layout keeps to a phone's width and becomes columns on a wide window", () => {
    renderDashboard();
    const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(" ");
    expect(classes(nav())).toEqual(
      expect.arrayContaining(["flex-row", "overflow-x-auto", "md:w-56", "md:flex-col", "md:border-r"]),
    );
    expect(classes(within(nav()).getByRole("heading", { name: "Folders" }))).toEqual(
      expect.arrayContaining(["sr-only", "md:not-sr-only"]),
    );
    expect(classes(nav().parentElement)).toEqual(expect.arrayContaining(["flex-col", "md:flex-row", "min-h-0", "flex-1"]));
    expect(classes(main())).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "overflow-y-auto"]));
    const bar = main().firstElementChild!;
    expect(classes(bar)).toEqual(expect.arrayContaining(["sticky", "top-0", "z-10", "bg-ed-bg", "flex-wrap", "px-4"]));
    expect(classes(search().parentElement)).toEqual(expect.arrayContaining(["order-last", "w-full", "sm:order-none"]));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(classes(heading)).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
    expect(classes(heading.parentElement)).toEqual(expect.arrayContaining(["min-w-0", "flex-1"]));
    expect(classes(within(region("All projects")).getByRole("list"))).toContain("grid-cols-[repeat(auto-fill,minmax(200px,1fr))]");
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
