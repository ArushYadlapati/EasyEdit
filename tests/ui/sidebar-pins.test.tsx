// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDashboard } from "../helpers/dashboard";
import { fireEvent, screen, within } from "../helpers/dom";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), bfcacheId: "b0" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, unstable_rethrow: () => {} }));

beforeEach(() => window.localStorage.clear());

const nav = () => screen.getByRole("navigation", { name: "Projects" });
const headings = () => within(nav()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const pinnedLinks = () => {
  const items = document.getElementById(screen.getByRole("button", { name: "Pinned" }).getAttribute("aria-controls")!)!;
  return within(items).getAllByRole("link");
};

describe("the sidebar's Pinned section", () => {
  it("sits between Projects and Folders, listing the space's pins in order, each opening its project", () => {
    renderDashboard({ pinnedIds: ["c", "a"] });
    expect(headings()).toEqual(["Projects", "Pinned", "Folders"]);
    expect(pinnedLinks().map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Finals", "/s/seattle-solvers/editor/c"],
      ["Qual recap", "/s/seattle-solvers/editor/a"],
    ]);
  });

  it("isn't drawn with nothing pinned", () => {
    renderDashboard({ pinnedIds: [] });
    expect(headings()).toEqual(["Projects", "Folders"]);
    expect(screen.queryByRole("button", { name: "Pinned" })).toBeNull();
  });

  it("a viewer sees the space's pins too", () => {
    renderDashboard({ canEdit: false, pinnedIds: ["b"] });
    expect(pinnedLinks().map((link) => link.textContent)).toEqual(["Poster"]);
  });

  it("keeps a pinned project that the search or the folder in view hides", () => {
    renderDashboard({ pinnedIds: ["b"], view: { kind: "folder", folderId: "f2" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing like it" } });
    expect(pinnedLinks().map((link) => link.textContent)).toEqual(["Poster"]);
  });

  it("folds away like the others", () => {
    renderDashboard({ pinnedIds: ["a"] });
    fireEvent.click(screen.getByRole("button", { name: "Pinned" }));
    expect(screen.getByRole("button", { name: "Pinned" }).getAttribute("aria-expanded")).toBe("false");
  });
});
