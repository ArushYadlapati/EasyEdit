// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import DashboardNotFound from "@/app/(dashboard)/not-found";
import EditorNotFound from "@/app/(editor)/not-found";
import NotFound, { metadata, viewport } from "@/app/not-found";
import { render, screen } from "../helpers/dom";

describe("404 page", () => {
  it("says the page wasn't found in a real title, with no label above it", () => {
    const { container } = render(<NotFound />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Page not found");
    expect(heading.className).toBe("h-plainTitle");
    expect(heading.previousElementSibling).toBeNull();
    expect(container.textContent).not.toContain("404");
    expect(container.querySelector(".font-mono, code")).toBeNull();
    expect(screen.getByText("There's no page at this address. Check the link, or start from the home page.")).toBeTruthy();
  });

  it("offers the home page and sign-in", () => {
    render(<NotFound />);
    const main = screen.getByRole("main");
    const links = [...main.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Go to the home page", "/"],
      ["Sign in", "/login"],
    ]);
  });

  it("sits in the public site's frame, with the header and footer outside main", () => {
    const { container } = render(<NotFound />);
    expect(container.firstElementChild?.className).toBe("h-site");
    expect(screen.getByRole("banner").closest("main")).toBeNull();
    expect(screen.getByRole("contentinfo").closest("main")).toBeNull();
    expect(screen.getByRole("link", { name: "EasyEdit home" }).getAttribute("href")).toBe("/");
  });

  it("names the tab, and is always dark like the rest of the site", () => {
    expect(metadata.title).toBe("Page not found · EasyEdit");
    expect(metadata.other).toEqual({ "darkreader-lock": "true" });
    expect(viewport.colorScheme).toBe("dark");
  });
});

describe("the app's own 404, for a signed-in page that calls notFound()", () => {
  it.each([
    ["the dashboard's", DashboardNotFound],
    ["the editor's", EditorNotFound],
  ])("%s leads back to the person's projects, not to sign-in or the public site", (_, Page) => {
    const { container } = render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
    expect(screen.getByText("This page doesn't exist, or you don't have access to it.")).toBeTruthy();
    const links = [...screen.getByRole("main").querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["Go to your projects", "/dashboard"]]);
    expect(container.querySelector(".h-site, header, footer")).toBeNull();
    expect(container.querySelector('a[href="/login"]')).toBeNull();
  });

  it("the editor's draws the app's dark ground itself, as the group has no layout", () => {
    const { container } = render(<EditorNotFound />);
    expect(container.firstElementChild?.className.split(" ")).toEqual(expect.arrayContaining(["ed-theme", "bg-ed-bg", "text-ed-text"]));
  });
});
