import { LIMITS } from "@/lib/limits";
import type { FolderSummary } from "@/lib/projects/folders";
import type { ProjectSummary } from "@/lib/projects/service";

// Which projects the dashboard shows, and in what order. Sorting and search run in the browser.

export type DashboardProject = ProjectSummary & { changedBy: string }; // displayActor(updatedBy), worked out on the server
export type DashboardFolder = FolderSummary;
export type SortKey = "changed" | "name" | "created";

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: "changed", label: "Last changed" },
  { value: "name", label: "Name" },
  { value: "created", label: "Date created" },
];

type Sortable = Pick<DashboardProject, "id" | "name" | "createdAt" | "updatedAt">;

// The folder named in the address, or null (the main view) when it is missing, repeated or unknown.
export function resolveView(folder: string | string[] | undefined, folders: readonly { id: string }[]): string | null {
  if (typeof folder !== "string") return null;
  return folders.some((f) => f.id === folder) ? folder : null;
}

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

// Your most recently opened projects, in the order you opened them; none while a search is typed.
export function recentProjects<T extends { id: string }>(projects: readonly T[], recentIds: readonly string[], search: string): T[] {
  if (searchText(search) !== "") return [];
  const byProjectId = new Map(projects.map((p) => [p.id, p]));
  return recentIds
    .flatMap((id) => {
      const project = byProjectId.get(id);
      return project ? [project] : [];
    })
    .slice(0, LIMITS.dashboardRecent);
}
