// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLink, spaceAt } from "@/components/dashboard/admin-link";
import { SpacesProvider } from "@/components/dashboard/space-switcher";
import type { MySpace } from "@/lib/spaces/types";
import { render, screen } from "../helpers/dom";

const at = vi.hoisted(() => ({ path: "/s/seattle-solvers" }));
vi.mock("next/navigation", () => ({ usePathname: () => at.path }));

const PERSONAL: MySpace = { id: "personal_u1", slug: "personal_u1", name: "Ada's space", kind: "personal", role: "admin" };
const SOLVERS: MySpace = { id: "team_seattle_solvers", slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role: "admin" };
const OTHER: MySpace = { id: "team_other", slug: "robotics", name: "Robotics", kind: "team", role: "admin" };
const SPACES = [PERSONAL, SOLVERS, OTHER];

beforeEach(() => {
  at.path = "/s/seattle-solvers";
});

function shownAt(path: string): HTMLElement | null {
  at.path = path;
  const { unmount } = render(
    <SpacesProvider spaces={SPACES}>
      <AdminLink />
    </SpacesProvider>,
  );
  const link = screen.queryByRole("link", { name: "Admin" });
  const found = link ? (link.cloneNode(true) as HTMLElement) : null;
  unmount();
  return found;
}

describe("the header's Admin link", () => {
  it("shows in Seattle Solvers, its folders and on the Admin page", () => {
    expect(shownAt("/s/seattle-solvers")?.getAttribute("href")).toBe("/admin");
    expect(shownAt("/s/seattle-solvers")?.hasAttribute("aria-current")).toBe(false);
    expect(shownAt("/s/seattle-solvers/anything")).not.toBeNull();
    expect(shownAt("/admin")?.getAttribute("aria-current")).toBe("page");
  });

  it("is hidden in Personal, in other teams, and on pages of no space", () => {
    expect(shownAt("/s/personal")).toBeNull();
    expect(shownAt("/s/robotics")).toBeNull();
    expect(shownAt("/s/not-mine")).toBeNull();
    expect(shownAt("/agents")).toBeNull();
    expect(shownAt("/dashboard")).toBeNull();
    expect(shownAt("/administrator")).toBeNull();
  });
});

describe("spaceAt", () => {
  it("finds the space of a space page, by the slug addresses use", () => {
    expect(spaceAt("/s/personal", SPACES)).toBe(PERSONAL);
    expect(spaceAt("/s/seattle-solvers/editor/p1", SPACES)).toBe(SOLVERS);
    expect(spaceAt("/s/personal_u1", SPACES)).toBeNull(); // a personal space is never addressed by its id
    expect(spaceAt("/s/%E0%A4%A", SPACES)).toBeNull(); // bad escapes are no space
    expect(spaceAt("/admin", SPACES)).toBeNull();
  });
});
