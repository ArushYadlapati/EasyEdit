import { describe, expect, it } from "vitest";
import { formatCollapsed, parseCollapsed, withToggled } from "@/lib/dashboard/sidebar-sections";

describe("the sidebar's collapsed sections", () => {
  it("reads the cookie's list", () => {
    expect([...parseCollapsed("folders.pinned")].sort()).toEqual(["folders", "pinned"]);
  });

  it("nothing saved, junk or unknown names: every section open", () => {
    expect(parseCollapsed(null).size).toBe(0);
    expect(parseCollapsed(undefined).size).toBe(0);
    expect(parseCollapsed("").size).toBe(0);
    expect(parseCollapsed("%7B%22x%22").size).toBe(0);
    expect([...parseCollapsed("folders.nope..folders")]).toEqual(["folders"]);
  });

  it("toggling adds a section or takes it out", () => {
    expect(withToggled(new Set(), "folders")).toEqual(["folders"]);
    expect(withToggled(new Set(["folders", "spaces"]), "folders")).toEqual(["spaces"]);
  });

  it("writes a list a cookie can carry as it is, and reads it back", () => {
    expect(formatCollapsed(["projects", "space"])).toBe("projects.space");
    expect([...parseCollapsed(formatCollapsed(["projects", "space"]))]).toEqual(["projects", "space"]);
    expect(formatCollapsed([])).toBe("");
  });
});
