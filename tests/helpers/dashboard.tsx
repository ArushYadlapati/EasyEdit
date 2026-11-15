import { vi, type Mock } from "vitest";
import { Dashboard, type DashboardProps } from "@/components/dashboard/dashboard";
import type { DashboardFolder, DashboardProject } from "@/lib/dashboard/view";
import type { DashboardActions } from "@/lib/projects/dashboard-actions";
import { render, type RenderResult } from "./dom";

// The dashboard's sample team: three projects, two folders, and one project you opened.

export const NOW = new Date("2026-11-13T12:00:00Z");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

export function dashProject(over: Partial<DashboardProject> & { id: string; name: string }): DashboardProject {
  return {
    format: "short_9x16",
    width: 1080,
    height: 1920,
    folderId: null,
    version: 0,
    createdAt: NOW,
    updatedBy: "u-sam",
    updatedAt: NOW,
    changedBy: "Sam",
    thumbnailVersion: null,
    ...over,
  };
}

export const PROJECTS: DashboardProject[] = [
  dashProject({ id: "a", name: "Qual recap", updatedAt: ago(5 * MINUTE), createdAt: ago(2 * DAY) }),
  dashProject({
    id: "b",
    name: "Poster",
    format: "custom",
    width: 816,
    height: 1056,
    folderId: "f1",
    updatedAt: ago(HOUR),
    createdAt: ago(DAY),
  }),
  dashProject({
    id: "c",
    name: "Finals",
    format: "long_16x9",
    width: 1920,
    height: 1080,
    updatedBy: "u-ada",
    changedBy: "Ada",
    updatedAt: ago(2 * DAY),
    createdAt: ago(3 * DAY),
  }),
];

export const FOLDERS: DashboardFolder[] = [
  { id: "f1", name: "Season 2026", projectCount: 1 },
  { id: "f2", name: "Sponsors", projectCount: 0 },
];

export const RECENT_IDS = ["c"];

export function fakeActions(): { [K in keyof DashboardActions]: Mock<DashboardActions[K]> } {
  return {
    create: vi.fn<DashboardActions["create"]>(async () => ({})),
    rename: vi.fn<DashboardActions["rename"]>(async () => ({})),
    remove: vi.fn<DashboardActions["remove"]>(async () => ({})),
    duplicate: vi.fn<DashboardActions["duplicate"]>(async () => ({})),
    move: vi.fn<DashboardActions["move"]>(async () => ({})),
    createFolder: vi.fn<DashboardActions["createFolder"]>(async () => ({})),
    renameFolder: vi.fn<DashboardActions["renameFolder"]>(async () => ({})),
    deleteFolder: vi.fn<DashboardActions["deleteFolder"]>(async () => ({})),
  };
}

// The dashboard as an editor sees All projects, with fake actions, unless over says otherwise.
export function renderDashboard(
  over: Partial<DashboardProps> = {},
): RenderResult & { actions: ReturnType<typeof fakeActions> } {
  const actions = fakeActions();
  const result = render(
    <Dashboard
      projects={PROJECTS}
      folders={FOLDERS}
      recentIds={RECENT_IDS}
      view={{ kind: "all" }}
      canEdit
      now={NOW}
      actions={actions}
      spaceSlug="seattle-solvers"
      {...over}
    />,
  );
  return { ...result, actions };
}
