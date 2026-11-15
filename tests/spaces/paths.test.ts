import { describe, expect, it } from "vitest";
import { editorPath, slugFor, spacePath } from "@/lib/spaces/paths";

describe("space paths", () => {
  it("builds the editor path", () => {
    expect(editorPath("seattle-solvers", "p1")).toBe("/s/seattle-solvers/editor/p1");
  });
  it("builds a space path with a query", () => {
    expect(spacePath("personal")).toBe("/s/personal");
    expect(spacePath("personal", { folder: "f 1" })).toBe("/s/personal?folder=f+1");
  });
  it("uses the alias for a personal space", () => {
    expect(slugFor({ id: "personal_u1", slug: "personal_u1", name: "Personal", kind: "personal" })).toBe("personal");
    expect(slugFor({ id: "t", slug: "seattle-solvers", name: "S", kind: "team" })).toBe("seattle-solvers");
  });
});
