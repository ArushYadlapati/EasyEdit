import { expect, it } from "vitest";
import {
  matchesSearch,
  pictureFits,
  projectsInView,
  recentProjects,
  resolveView,
  sortProjects,
  SORT_OPTIONS,
  thumbnailUrl,
} from "@/lib/dashboard/view";

type P = { id: string; name: string; createdAt: Date; updatedAt: Date; folderId: string | null };

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 13, 12, minutes));
const project = (id: string, name: string, created: number, updated: number, folderId: string | null = null): P => ({
  id,
  name,
  createdAt: at(created),
  updatedAt: at(updated),
  folderId,
});
const names = (list: readonly P[]) => list.map((p) => p.name);
const ids = (list: readonly { id: string }[]) => list.map((p) => p.id);

it("offers the three sorts, last change first", () => {
  expect(SORT_OPTIONS).toEqual([
    { value: "changed", label: "Last changed" },
    { value: "name", label: "Name" },
    { value: "created", label: "Date created" },
  ]);
});

it("sorts by last change, name or creation", () => {
  const list = [
    project("p1", "item 10", 4, 10),
    project("p2", "Beta", 1, 30),
    project("p3", "alpha", 3, 20),
    project("p4", "item 9", 2, 30),
  ];
  const before = [...list];
  expect(names(sortProjects(list, "name"))).toEqual(["alpha", "Beta", "item 9", "item 10"]);
  // p2 and p4 changed at the same moment: the id breaks the tie.
  expect(ids(sortProjects(list, "changed"))).toEqual(["p2", "p4", "p3", "p1"]);
  expect(ids(sortProjects(list, "created"))).toEqual(["p1", "p3", "p4", "p2"]);
  expect(sortProjects(list, "name")).not.toBe(list);
  expect(list).toEqual(before);
});

it("names that differ only by case tie, and every tie goes by id whatever the order given", () => {
  const list = [project("b", "same", 5, 7), project("a", "Same", 5, 7)];
  for (const given of [list, [...list].reverse()]) {
    expect(ids(sortProjects(given, "name"))).toEqual(["a", "b"]);
    expect(ids(sortProjects(given, "created"))).toEqual(["a", "b"]);
    expect(ids(sortProjects(given, "changed"))).toEqual(["a", "b"]);
  }
});

it("search is case-insensitive and ignores spaces around it", () => {
  expect(matchesSearch("Qual recap", "  QUAL ")).toBe(true);
  expect(matchesSearch("Qual recap", "")).toBe(true);
  expect(matchesSearch("Qual recap", "   ")).toBe(true);
  expect(matchesSearch("Qual recap", "finals")).toBe(false);
  expect(matchesSearch("Qual recap", "l re")).toBe(true);
});

it("a view is a folder, a search and a sort", () => {
  const list = [project("p1", "Zeta", 3, 3, "f1"), project("p2", "Qual recap", 2, 2), project("p3", "Alpha", 1, 1, "f1")];
  expect(names(projectsInView(list, { folderId: "f1", search: "", sort: "name" }))).toEqual(["Alpha", "Zeta"]);
  expect(names(projectsInView(list, { folderId: null, search: "", sort: "name" }))).toEqual(["Alpha", "Qual recap", "Zeta"]);
  expect(names(projectsInView(list, { folderId: null, search: "", sort: "changed" }))).toEqual(["Zeta", "Qual recap", "Alpha"]);
  expect(names(projectsInView(list, { folderId: null, search: " qual", sort: "name" }))).toEqual(["Qual recap"]);
  expect(names(projectsInView(list, { folderId: "f1", search: "qual", sort: "name" }))).toEqual([]);
});

it("Recent follows your opens, skips what is gone, stops at six and hides while searching", () => {
  const [a, b, c] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(recentProjects([a, b, c], ["c", "gone", "a"], "")).toEqual([c, a]);
  const eight = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}` }));
  expect(recentProjects(eight, ids(eight), "")).toEqual(eight.slice(0, 6));
  expect(recentProjects([a, b, c], ["c", "a"], "x")).toEqual([]);
  // Spaces alone are no search, as in matchesSearch: the list shows everything, so Recent stays.
  expect(recentProjects([a, b, c], ["c", "a"], "  ")).toEqual([c, a]);
});

it("an unknown folder in the address is the main view", () => {
  const folders = [{ id: "f1" }];
  expect(resolveView("f1", folders)).toBe("f1");
  expect(resolveView("nope", folders)).toBeNull();
  expect(resolveView(["f1"], folders)).toBeNull();
  expect(resolveView(undefined, folders)).toBeNull();
});

it("a thumbnail's address carries its version", () => {
  expect(thumbnailUrl({ id: "a", thumbnailVersion: 3 })).toBe("/api/projects/a/thumbnail?v=3");
  expect(thumbnailUrl({ id: "a b", thumbnailVersion: 0 })).toBe("/api/projects/a%20b/thumbnail?v=0");
  expect(thumbnailUrl({ id: "a", thumbnailVersion: null })).toBeNull();
});

it("a picture fits its project only in the project's shape", () => {
  expect(pictureFits({ width: 360, height: 640 }, { width: 1080, height: 1920 })).toBe(true); // Vertical 9:16
  expect(pictureFits({ width: 512, height: 640 }, { width: 1080, height: 1350 })).toBe(true); // Feed 4:5
  expect(pictureFits({ width: 640, height: 3 }, { width: 4096, height: 16 })).toBe(true); // the short side rounded from 2.5
  expect(pictureFits({ width: 360, height: 640 }, { width: 1080, height: 1900 })).toBe(true); // about 1 % off
  expect(pictureFits({ width: 640, height: 360 }, { width: 1080, height: 1920 })).toBe(false);
  expect(pictureFits({ width: 360, height: 640 }, { width: 1920, height: 1080 })).toBe(false);
  expect(pictureFits({ width: 512, height: 640 }, { width: 1080, height: 1080 })).toBe(false);
  expect(pictureFits({ width: 0, height: 0 }, { width: 1080, height: 1920 })).toBe(false);
});
