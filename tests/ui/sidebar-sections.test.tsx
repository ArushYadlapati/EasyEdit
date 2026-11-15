// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SpacesProvider } from "@/components/dashboard/space-switcher";
import { SECTIONS_KEY } from "@/lib/dashboard/sidebar-sections";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import type { MySpace } from "@/lib/spaces/types";
import { FOLDERS } from "../helpers/dashboard";
import { fireEvent, render, screen, within } from "../helpers/dom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/s/seattle-solvers" }));

const TEAM: MySpace = { id: SEED_TEAM_ID, slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role: "admin" };

const sidebar = () =>
  render(
    <SpacesProvider spaces={[TEAM]}>
      <Sidebar folders={FOLDERS} view={{ kind: "all" }} canEdit spaceSlug="seattle-solvers" onNewFolder={() => {}} onDropProject={() => {}} />
    </SpacesProvider>,
  );

const toggle = (name: string) => screen.getByRole("button", { name, expanded: undefined }) as HTMLButtonElement;
const itemsOf = (name: string) => document.getElementById(toggle(name).getAttribute("aria-controls")!)!;
const classes = (el: Element) => (el.getAttribute("class") ?? "").split(" ");

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

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

  it("the chevron hides a section's items and is remembered in this browser", () => {
    const first = sidebar();
    fireEvent.click(toggle("Folders"));
    expect(toggle("Folders").getAttribute("aria-expanded")).toBe("false");
    expect(classes(itemsOf("Folders"))).toEqual(expect.arrayContaining(["contents", "md:hidden"]));
    expect(itemsOf("Folders").contains(screen.getByRole("link", { name: /^Season 2026/ }))).toBe(true);
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(SECTIONS_KEY)!)).toEqual(["folders"]);
    // New folder stays beside the heading.
    expect(itemsOf("Folders").contains(screen.getByRole("button", { name: "New folder" }))).toBe(false);
    first.unmount();

    sidebar();
    expect(toggle("Folders").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle("Folders"));
    expect(toggle("Folders").getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(SECTIONS_KEY)!)).toEqual([]);
  });

  it("clicking the heading's text toggles it too", () => {
    sidebar();
    fireEvent.click(within(screen.getByRole("navigation", { name: "My Spaces" })).getByRole("heading", { name: "My Spaces" }));
    expect(toggle("My Spaces").getAttribute("aria-expanded")).toBe("false");
  });

  it("still hides and shows when the browser's storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    sidebar();
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle("Projects"));
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle("Projects"));
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("true");
  });
});
