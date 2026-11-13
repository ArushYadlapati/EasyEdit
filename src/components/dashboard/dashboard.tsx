"use client";

import { Ellipsis, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FolderNameDialog } from "@/components/dashboard/folder-name-dialog";
import { NewProjectDialog } from "@/components/dashboard/new-project-dialog";
import { ProjectCard } from "@/components/dashboard/project-card";
import { Sidebar } from "@/components/dashboard/sidebar";
import { useRefreshOnReturn } from "@/components/dashboard/use-refresh-on-return";
import { Button } from "@/components/ui/button";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { Menu, type MenuItem } from "@/components/ui/menu";
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

const FOLDER_ITEMS: MenuItem[] = [
  { id: "rename", label: "Rename folder" },
  { id: "delete", label: "Delete folder", danger: true },
];

const HEADING = "mb-3 text-sm font-semibold text-ed-text";
const EMPTY = "text-[13px] text-ed-muted";

function CardGrid({ projects, folderName, now, canEdit, folders, actions, onGone }: {
  projects: readonly DashboardProject[];
  folderName(project: DashboardProject): string | null;
  now: Date;
  canEdit: boolean;
  folders: readonly DashboardFolder[];
  actions: DashboardActions;
  onGone(message: string): void;
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
          onGone={onGone}
        />
      ))}
    </ul>
  );
}

// The dashboard: the folders at the side, and a bar that stays at the top with the view's title (and, in a folder,
// its menu), the search, the sort and New project. The main view lists Recent, then All projects; a folder view lists
// that folder's projects. A card dropped on a folder in the sidebar moves there, and a refused move says why in the bar.
export function Dashboard({ projects, folders, recentIds, view, canEdit, now, actions }: DashboardProps): ReactNode {
  useRefreshOnReturn();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("changed");
  const [newOpen, setNewOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState<"new" | "rename" | "delete" | null>(null);
  // The folder that Rename folder or Delete folder was opened on, kept while its dialog is open even if the folder
  // leaves the page: a refusal because it was deleted elsewhere refreshes the page out of the folder's view, and the
  // dialog must stay to say so.
  const [chosenFolder, setChosenFolder] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteFolder = useAction(actions.deleteFolder);
  const dropMove = useAction(actions.move);
  const [notice, setNotice] = useState<string | null>(null); // the bar's message: a refused drop, or a project gone
  // The message belongs to the view it was given in.
  const [noticeView, setNoticeView] = useState(view);
  if (view !== noticeView) {
    setNoticeView(view);
    setNotice(null);
  }
  const titleId = useId();
  const recentId = useId();
  const allId = useId();

  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const title = (view !== null && folderNames.get(view)) || "Projects";
  const shown = projectsInView(projects, { folderId: view, search, sort });
  const recent = recentProjects(projects, recentIds, search); // shown in the main view only
  const searching = search.trim() !== "";
  const folderName = view === null ? null : (folderNames.get(view) ?? null);

  // A drag can come from another window or site with any id, so only this page's projects move, and a drop onto the
  // folder a project is already in does nothing.
  function dropProject(projectId: string, folderId: string | null) {
    const project = projects.find((p) => p.id === projectId);
    if (!project || project.folderId === folderId) return;
    const formData = new FormData();
    formData.set("id", project.id);
    formData.set("folderId", folderId ?? "");
    dropMove.submit(formData, { onStart: () => setNotice(null), onFailure: setNotice });
  }

  function chooseFolderOption(id: string) {
    if (view === null || folderName === null) return;
    setChosenFolder({ id: view, name: folderName });
    if (id === "delete") setDeleteError(null);
    setFolderDialog(id === "rename" ? "rename" : "delete");
  }

  function confirmDeleteFolder() {
    if (chosenFolder === null) return;
    const formData = new FormData();
    formData.set("id", chosenFolder.id);
    deleteFolder.submit(formData, {
      onStart: () => setDeleteError(null),
      onSuccess: () => {
        setFolderDialog(null);
        router.replace("/dashboard");
      },
      onFailure: setDeleteError,
    });
  }
  const closeFolderDialog = () => setFolderDialog(null);

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
      <CardGrid
        projects={shown}
        folderName={folderName}
        now={now}
        canEdit={canEdit}
        folders={folders}
        actions={actions}
        onGone={setNotice}
      />
    ) : (
      empty()
    );

  return (
    <ContextMenuProvider>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <Sidebar
          folders={folders}
          view={view}
          canEdit={canEdit}
          onNewFolder={() => setFolderDialog("new")}
          onDropProject={dropProject}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-ed-line bg-ed-bg px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <h1 id={titleId} className="min-w-0 truncate text-base font-semibold">
                {title}
              </h1>
              {canEdit && folderName !== null && (
                <Menu label="Folder options" icon={<Ellipsis />} items={FOLDER_ITEMS} onSelect={chooseFolderOption} />
              )}
            </div>
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
            {notice && (
              <p role="alert" className="order-last basis-full text-xs text-ed-danger">
                {notice}
              </p>
            )}
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
                      onGone={setNotice}
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
        <>
          <NewProjectDialog
            open={newOpen}
            onClose={() => setNewOpen(false)}
            folders={folders}
            folderId={view}
            action={actions.create}
          />
          <FolderNameDialog
            open={folderDialog === "new"}
            title="New folder"
            submitLabel="Create folder"
            initial=""
            action={actions.createFolder}
            onClose={closeFolderDialog}
          />
          {chosenFolder !== null && (
            <>
              <FolderNameDialog
                open={folderDialog === "rename"}
                title="Rename folder"
                submitLabel="Save"
                initial={chosenFolder.name}
                folderId={chosenFolder.id}
                action={actions.renameFolder}
                onClose={closeFolderDialog}
              />
              <ConfirmDialog
                title="Delete folder"
                question={`Delete the folder "${chosenFolder.name}"? Its projects stay in All projects.`}
                confirmLabel="Delete folder"
                open={folderDialog === "delete"}
                pending={deleteFolder.pending}
                error={deleteError}
                onConfirm={confirmDeleteFolder}
                onClose={closeFolderDialog}
              />
            </>
          )}
        </>
      )}
    </ContextMenuProvider>
  );
}
