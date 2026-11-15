// @vitest-environment happy-dom
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SpacesProvider } from "@/components/dashboard/space-switcher";
import { SECTIONS_COOKIE } from "@/lib/dashboard/sidebar-sections";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import type { MySpace } from "@/lib/spaces/types";
import { FOLDERS } from "../helpers/dashboard";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/s/seattle-solvers" }));

const TEAM: MySpace = { id: SEED_TEAM_ID, slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role: "admin" };

const element = (collapsed?: string) => (
  <SpacesProvider spaces={[TEAM]}>
    <Sidebar folders={FOLDERS} collapsed={collapsed} view={{ kind: "all" }} canEdit spaceSlug="seattle-solvers" onNewFolder={() => {}} onDropProject={() => {}} />
  </SpacesProvider>
);
const sidebar = (collapsed?: string) => render(element(collapsed));

// The cookie's value as this page sees it.
const cookie = () => document.cookie.split("; ").find((pair) => pair.startsWith(`${SECTIONS_COOKIE}=`))?.slice(SECTIONS_COOKIE.length + 1);
const clearCookie = () => (document.cookie = `${SECTIONS_COOKIE}=; path=/s; max-age=0`);

const toggle = (name: string) => screen.getByRole("button", { name, expanded: undefined }) as HTMLButtonElement;
const itemsOf = (name: string) => document.getElementById(toggle(name).getAttribute("aria-controls")!)!;
const classes = (el: Element) => (el.getAttribute("class") ?? "").split(" ");

beforeEach(() => {
  window.history.replaceState(null, "", "/s/seattle-solvers");
  clearCookie();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the sidebar's sections", () => {
  it("every section has a chevron that starts open", () => {
    sidebar();
    for (const name of ["My Spaces", "Projects", "Folders", "This space"]) {
      expect([name, toggle(name).getAttribute("aria-expanded")]).toEqual([name, "true"]);
      expect(classes(itemsOf(name))).not.toContain("md:hidden");
    }
    // Not drawn on a narrow window, where the headings are for screen readers only and the items always show.
    expect(classes(toggle("Folders"))).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
  });

  it("the server draws a section the cookie folded already folded, and hydrating keeps it so", () => {
    const html = renderToString(element("folders"));
    const box = document.createElement("div");
    box.innerHTML = html;
    document.body.appendChild(box);
    const folders = () => within(box).getByRole("button", { name: "Folders" });
    expect(folders().getAttribute("aria-expanded")).toBe("false");
    expect(classes(document.getElementById(folders().getAttribute("aria-controls")!)!)).toContain("md:hidden");
    document.cookie = `${SECTIONS_COOKIE}=folders; path=/s`;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      hydrateRoot(box, element("folders"));
    });
    expect(errors).not.toHaveBeenCalled();
    expect(folders().getAttribute("aria-expanded")).toBe("false");
    expect(within(box).getByRole("button", { name: "Projects" }).getAttribute("aria-expanded")).toBe("true");
    box.remove();
  });

  it("the chevron hides a section's items and is remembered in this browser", () => {
    const first = sidebar();
    fireEvent.click(toggle("Folders"));
    expect(toggle("Folders").getAttribute("aria-expanded")).toBe("false");
    expect(classes(itemsOf("Folders"))).toEqual(expect.arrayContaining(["contents", "md:hidden"]));
    expect(itemsOf("Folders").contains(screen.getByRole("link", { name: /^Season 2026/ }))).toBe(true);
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("true");
    expect(cookie()).toBe("folders");
    // New folder stays beside the heading.
    expect(itemsOf("Folders").contains(screen.getByRole("button", { name: "New folder" }))).toBe(false);
    first.unmount();

    sidebar();
    expect(toggle("Folders").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle("Folders"));
    expect(toggle("Folders").getAttribute("aria-expanded")).toBe("true");
    expect(cookie()).toBe("");
  });

  it("a cookie that won't take a new value doesn't stop the chevron", () => {
    document.cookie = `${SECTIONS_COOKIE}=folders; path=/s`;
    sidebar("folders");
    vi.spyOn(document, "cookie", "set").mockImplementation(() => {});
    fireEvent.click(toggle("Folders"));
    expect(toggle("Folders").getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking the heading's text toggles it too", () => {
    sidebar();
    fireEvent.click(within(screen.getByRole("navigation", { name: "My Spaces" })).getByRole("heading", { name: "My Spaces" }));
    expect(toggle("My Spaces").getAttribute("aria-expanded")).toBe("false");
  });

  it("still hides and shows when the browser refuses cookies", () => {
    vi.spyOn(document, "cookie", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(document, "cookie", "set").mockImplementation(() => {
      throw new Error("blocked");
    });
    sidebar();
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle("Projects"));
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle("Projects"));
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("true");
  });
});
