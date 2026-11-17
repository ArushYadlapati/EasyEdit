import { LIMITS } from "@/lib/limits";
import type { FolderSummary } from "@/lib/projects/folders";
import type { ProjectSummary } from "@/lib/projects/service";

// Which projects the dashboard shows, and in what order. Sorting and search run in the browser.

export type DashboardProject = ProjectSummary & { changedBy: string }; // displayActor(updatedBy), worked out on the server
export type DashboardFolder = FolderSummary;
export type SortKey = "changed" | "name" | "created";

export const PROJECT_GONE = "That project no longer exists.";

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: "changed", label: "Last changed" },
  { value: "name", label: "Name" },
  { value: "created", label: "Date created" },
];

type Sortable = Pick<DashboardProject, "id" | "name" | "createdAt" | "updatedAt">;

// What the dashboard shows: the projects you opened last (its landing view), all of the space's projects with its
// folders, or one folder.
export type DashboardView = { kind: "recent" } | { kind: "all" } | { kind: "folder"; folderId: string };

export const RECENT_VIEW: DashboardView = { kind: "recent" };
export const ALL_VIEW: DashboardView = { kind: "all" };

type Query = string | string[] | undefined;

// The view named in the address: ?folder=<id> for a folder this space has, else ?view=all for All projects or
// ?view=recent for Recent, else the landing view: Recent, or All projects for someone who has opened nothing in the
// space yet (the page decides). A repeated or unknown value counts as missing.
export function resolveView(query: { folder?: Query; view?: Query }, folders: readonly { id: string }[], landing: DashboardView = RECENT_VIEW): DashboardView {
  const { folder, view } = query;
  if (typeof folder === "string" && folders.some((f) => f.id === folder)) return { kind: "folder", folderId: folder };
  if (view === "all") return ALL_VIEW;
  if (view === "recent") return RECENT_VIEW;
  return landing;
}

// The address query of a view, for spacePath. Recent is named too: the bare address can land on All projects.
export function viewQuery(view: DashboardView): Record<string, string> {
  if (view.kind === "folder") return { folder: view.folderId };
  return { view: view.kind };
}

// The folder a view is of, or null for Recent and All projects.
export const folderOf = (view: DashboardView): string | null => (view.kind === "folder" ? view.folderId : null);

export const sameView = (a: DashboardView, b: DashboardView): boolean => folderOf(a) === folderOf(b) && a.kind === b.kind;

const searchText = (search: string) => search.trim().toLowerCase();

export function matchesSearch(name: string, search: string): boolean {
  return name.toLowerCase().includes(searchText(search));
}

const byId = (a: Sortable, b: Sortable) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const newestFirst = (a: Date, b: Date) => b.getTime() - a.getTime();

const COMPARE: Record<SortKey, (a: Sortable, b: Sortable) => number> = {
  changed: (a, b) => newestFirst(a.updatedAt, b.updatedAt),
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  created: (a, b) => newestFirst(a.createdAt, b.createdAt),
};

export function sortProjects<T extends Sortable>(projects: readonly T[], sort: SortKey): T[] {
  const compare = COMPARE[sort];
  return [...projects].sort((a, b) => compare(a, b) || byId(a, b));
}

export function projectsInView<T extends Sortable & Pick<DashboardProject, "folderId">>(
  projects: readonly T[],
  view: { folderId: string | null; search: string; sort: SortKey },
): T[] {
  const shown = projects.filter(
    (p) => (view.folderId === null || p.folderId === view.folderId) && matchesSearch(p.name, view.search),
  );
  return sortProjects(shown, view.sort);
}

// The address of a project's saved picture, with its version in it so a newer picture is a new address; null when it
// has none.
export function thumbnailUrl(project: Pick<DashboardProject, "id" | "thumbnailVersion">): string | null {
  if (project.thumbnailVersion === null) return null;
  return `/api/projects/${encodeURIComponent(project.id)}/thumbnail?v=${project.thumbnailVersion}`;
}

// A project's picture is drawn in the project's shape at that time, so a picture of another shape is out of date. It
// fits when it is within a pixel of the project's shape at the picture's size (its short side is rounded to whole
// pixels), or when the two shapes are within 5 % of each other.
export function pictureFits(picture: { width: number; height: number }, project: { width: number; height: number }): boolean {
  if (picture.width <= 0 || picture.height <= 0) return false;
  const off = Math.abs(picture.width * project.height - picture.height * project.width);
  return off <= Math.max(project.width, project.height) || off <= 0.05 * picture.height * project.width;
}

// The space's pinned projects in the pins' order (oldest first), whatever the view or the search; an id with no project
// here (deleted meanwhile) is left out.
export function pinnedProjects<T extends { id: string }>(projects: readonly T[], pinnedIds: readonly string[]): T[] {
  const byProjectId = new Map(projects.map((p) => [p.id, p]));
  return pinnedIds.flatMap((id) => byProjectId.get(id) ?? []);
}

// Your most recently opened projects, in the order you opened them, that match the search.
export function recentProjects<T extends { id: string; name: string }>(projects: readonly T[], recentIds: readonly string[], search: string): T[] {
  const byProjectId = new Map(projects.map((p) => [p.id, p]));
  return recentIds
    .flatMap((id) => {
      const project = byProjectId.get(id);
      return project ? [project] : [];
    })
    .slice(0, LIMITS.dashboardRecent)
    .filter((project) => matchesSearch(project.name, search));
}
