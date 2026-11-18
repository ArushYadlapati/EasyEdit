// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { SpaceSwitcher } from "@/components/dashboard/space-switcher";
import { TAG } from "@/components/ui/cx";
import type { MySpace } from "@/lib/spaces/types";
import { render, screen } from "../helpers/dom";

const PERSONAL: MySpace = { id: "personal_u1", slug: "personal_u1", name: "Ada's space", kind: "personal", role: "admin" };
const TEAM: MySpace = { id: "team_seattle_solvers", slug: "seattle-solvers", name: "Seattle Solvers", kind: "team", role: "editor" };

describe("SpaceSwitcher", () => {
  it("lists Personal first, then teams by name, linked to their addresses", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, TEAM]} current={TEAM.id} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Personal", "Seattle Solvers"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/s/personal", "/s/seattle-solvers"]);
  });

  it("marks only the current space", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, TEAM]} current={PERSONAL.id} />);
    expect(screen.getByRole("link", { name: "Personal" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Seattle Solvers" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks nothing when no space is current", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, TEAM]} current={null} />);
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("is headed My Spaces, like the sidebar's other headings", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, TEAM]} current={PERSONAL.id} />);
    const nav = screen.getByRole("navigation", { name: "My Spaces" });
    const heading = screen.getByRole("heading", { name: "My Spaces" });
    expect(heading.tagName).toBe("H2");
    // First in the switcher, in the row with its chevron.
    expect(nav.firstElementChild).toBe(heading.parentElement);
    expect(heading.parentElement!.firstElementChild).toBe(heading);
    // Beside the list on a wide window; for screen readers only on a narrow one, where the switcher is a row.
    expect(heading.className.split(" ")).toEqual(expect.arrayContaining(["sr-only", "md:not-sr-only", "uppercase"]));
  });

  it("sets the Soon tag at 11 px, no smaller than any other label, in the same look as the Starter tag", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, TEAM]} current={TEAM.id} personalSoon />);
    expect(screen.getByText("Soon").className.split(" ")).toEqual(expect.arrayContaining(["text-[11px]", "leading-4"]));
    expect(screen.getByText("Soon").className).toBe(TAG);
  });

  it("has no Create a team item", () => {
    render(<SpaceSwitcher spaces={[PERSONAL, TEAM]} current={PERSONAL.id} />);
    expect(screen.queryByText(/create a team/i)).toBeNull();
  });
});
