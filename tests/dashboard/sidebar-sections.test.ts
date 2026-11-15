import { describe, expect, it } from "vitest";
import { SECTIONS_KEY, readCollapsed, withToggled, writeCollapsed } from "@/lib/dashboard/sidebar-sections";

const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === SECTIONS_KEY ? value : null) });
const blocked = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("the sidebar's collapsed sections", () => {
  it("reads the saved sections", () => {
    expect([...readCollapsed(storageWith('["folders","pinned"]'))].sort()).toEqual(["folders", "pinned"]);
  });

  it("nothing saved, junk, unknown names or blocked storage: every section open", () => {
    expect(readCollapsed(storageWith(null)).size).toBe(0);
    expect(readCollapsed(storageWith("not json")).size).toBe(0);
    expect(readCollapsed(storageWith('{"folders":true}')).size).toBe(0);
    expect([...readCollapsed(storageWith('["folders","nope",3]'))]).toEqual(["folders"]);
    expect(readCollapsed(blocked).size).toBe(0);
  });

  it("toggling adds a section or takes it out", () => {
    expect(withToggled(new Set(), "folders")).toEqual(["folders"]);
    expect(withToggled(new Set(["folders", "spaces"]), "folders")).toEqual(["spaces"]);
  });

  it("writes the list; a refused write is ignored", () => {
    const saved: Record<string, string> = {};
    writeCollapsed({ setItem: (key, value) => (saved[key] = value) }, ["projects"]);
    expect(saved).toEqual({ [SECTIONS_KEY]: '["projects"]' });
    expect(() => writeCollapsed(blocked, ["projects"])).not.toThrow();
  });
});
