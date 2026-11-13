"use client";

import { Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { NewProjectDialog } from "@/components/dashboard/new-project-dialog";
import { ProjectCard } from "@/components/dashboard/project-card";
import { Sidebar } from "@/components/dashboard/sidebar";
import { useRefreshOnReturn } from "@/components/dashboard/use-refresh-on-return";
import { Button } from "@/components/ui/button";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import {
  SORT_OPTIONS,
  projectsInView,
  recentProjects,
  type DashboardFolder,
  type DashboardProject,
  type SortKey,
} from "@/lib/dashboard/view";
import type { DashboardActions } from "@/lib/projects/dashboard-actions";

export type DashboardProps = {
  projects: DashboardProject[];
  folders: DashboardFolder[];
  recentIds: string[];
  view: string | null; // the folder in view, or null for the main view
  canEdit: boolean;
  now: Date;
  actions: DashboardActions;
};

const HEADING = "mb-3 text-sm font-semibold text-ed-text";
const EMPTY = "text-[13px] text-ed-muted";

function CardGrid({ projects, folderName, now, canEdit, folders, actions }: {
  projects: readonly DashboardProject[];
  folderName(project: DashboardProject): string | null;
  now: Date;
  canEdit: boolean;
  folders: readonly DashboardFolder[];
  actions: DashboardActions;
}) {
  // Each card is its own <li>, which takes the card's right-click.
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          folderName={folderName(project)}
          now={now}
          canEdit={canEdit}
          folders={folders}
          actions={actions}
        />
      ))}
    </ul>
  );
}

// The dashboard: the folders at the side, and a bar that stays at the top with the view's title, the search, the
// sort and New project. The main view lists Recent, then All projects; a folder view lists that folder's projects.
export function Dashboard({ projects, folders, recentIds, view, canEdit, now, actions }: DashboardProps): ReactNode {
  useRefreshOnReturn();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("changed");
  const [newOpen, setNewOpen] = useState(false);
  const titleId = useId();
  const recentId = useId();
  const allId = useId();

  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const title = (view !== null && folderNames.get(view)) || "Projects";
  const shown = projectsInView(projects, { folderId: view, search, sort });
  const recent = recentProjects(projects, recentIds, search); // shown in the main view only
  const searching = search.trim() !== "";

  const newProjectButton = (className?: string) => (
    <Button variant="primary" className={className} onClick={() => setNewOpen(true)}>
      <Plus aria-hidden />
      New project
    </Button>
  );

  function empty(): ReactNode {
    if (searching) return <p className={EMPTY}>{`No projects match "${search.trim()}".`}</p>;
    if (view !== null) {
      return (
        <p className={EMPTY}>
          {canEdit
            ? "No projects in this folder yet. Drag a project here, or use Move to folder in its menu."
            : "No projects in this folder yet."}
        </p>
      );
    }
    return (
      <div className="flex flex-col items-start gap-3">
        <p className={EMPTY}>No projects yet.</p>
        {canEdit && newProjectButton()}
      </div>
    );
  }

  const noFolder = () => null;
  const list = (folderName: (project: DashboardProject) => string | null) =>
    shown.length > 0 ? (
      <CardGrid projects={shown} folderName={folderName} now={now} canEdit={canEdit} folders={folders} actions={actions} />
    ) : (
      empty()
    );

  return (
    <ContextMenuProvider>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <Sidebar folders={folders} view={view} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-ed-line bg-ed-bg px-4 py-3">
            <h1 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold">
              {title}
            </h1>
            {/* Below sm the search and the sort share a second row, under the title and New project. */}
            <div className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto">
              <TextInput
                type="search"
                aria-label="Search projects"
                placeholder="Search projects"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="min-w-0 flex-1 sm:w-56 sm:flex-none"
              />
              <Select
                aria-label="Sort by"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                className="shrink-0"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            {canEdit && newProjectButton("shrink-0")}
          </div>
          <div className="flex flex-col gap-8 px-4 py-6">
            {view === null ? (
              <>
                {recent.length > 0 && (
                  <section aria-labelledby={recentId}>
                    <h2 id={recentId} className={HEADING}>
                      Recent
                    </h2>
                    <CardGrid
                      projects={recent}
                      folderName={noFolder}
                      now={now}
                      canEdit={canEdit}
                      folders={folders}
                      actions={actions}
                    />
                  </section>
                )}
                <section aria-labelledby={allId}>
                  <h2 id={allId} className={HEADING}>
                    All projects
                  </h2>
                  {list((project) => (project.folderId === null ? null : (folderNames.get(project.folderId) ?? null)))}
                </section>
              </>
            ) : (
              <section aria-labelledby={titleId}>{list(noFolder)}</section>
            )}
          </div>
        </main>
      </div>
      {canEdit && (
        <NewProjectDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          folders={folders}
          folderId={view}
          action={actions.create}
        />
      )}
    </ContextMenuProvider>
  );
}
