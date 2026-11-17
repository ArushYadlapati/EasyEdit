"use client";

import { Ellipsis, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FolderNameDialog } from "@/components/dashboard/folder-name-dialog";
import { FolderTile } from "@/components/dashboard/folder-tile";
import type { TemplateSummary } from "@/lib/templates/types";
import { NewProjectDialog } from "@/components/dashboard/new-project-dialog";
import { ProjectCard } from "@/components/dashboard/project-card";
import { Sidebar } from "@/components/dashboard/sidebar";
import { useRefreshOnReturn } from "@/components/dashboard/use-refresh-on-return";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import {
  ALL_VIEW,
  SORT_OPTIONS,
  folderOf,
  pinnedProjects,
  projectsInView,
  recentProjects,
  sameView,
  viewQuery,
  type DashboardFolder,
  type DashboardProject,
  type DashboardView,
  type SortKey,
} from "@/lib/dashboard/view";
import type { DashboardActions } from "@/lib/projects/dashboard-actions";
import { spacePath } from "@/lib/spaces/paths";

export type DashboardProps = {
  projects: DashboardProject[];
  folders: DashboardFolder[];
  templates?: TemplateSummary[]; // what a new project can start from, besides blank
  recentIds: string[];
  pinnedIds?: string[]; // the space's Pinned list, oldest pin first; none when left out
  sidebarCollapsed?: string; // the sidebar sections this browser folded, as the server read their cookie
  view: DashboardView;
  canEdit: boolean;
  now: Date;
  actions: DashboardActions;
  spaceSlug: string; // the space shown, for the links inside it
  notices?: ReactNode; // what the page puts at the top of the main area: storage to set up or reconnect, a connect's outcome
};

const FOLDER_ITEMS: MenuItem[] = [
  { id: "rename", label: "Rename folder" },
  { id: "delete", label: "Delete folder", danger: true },
];

const NO_PINS: string[] = [];

const HEADING = "mb-3 text-sm font-semibold text-ed-text";
const EMPTY = "text-[13px] text-ed-muted";

function CardGrid({ projects, folderName, now, canEdit, pinned, folders, actions, spaceSlug, onGone }: {
  projects: readonly DashboardProject[];
  folderName(project: DashboardProject): string | null;
  now: Date;
  canEdit: boolean;
  pinned: ReadonlySet<string>;
  folders: readonly DashboardFolder[];
  actions: DashboardActions;
  spaceSlug: string;
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
          pinned={pinned.has(project.id)}
          folders={folders}
          actions={actions}
          spaceSlug={spaceSlug}
          onGone={onGone}
        />
      ))}
    </ul>
  );
}

// The dashboard: the sidebar at the side, and a bar that stays at the top with the view's title (and, in a folder,
// its menu), the search, the sort and New project. Recent lists the projects you opened last, in that order (so it has
// no sort); All projects lists a tile for each folder, then every project; a folder view lists that folder's projects.
// A card dropped on a folder, in the sidebar or on its tile, moves there, and a refused move says why in the bar.
export function Dashboard({ projects, folders, templates, recentIds, pinnedIds = NO_PINS, sidebarCollapsed, view, canEdit, now, actions, spaceSlug, notices }: DashboardProps): ReactNode {
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
  if (!sameView(view, noticeView)) {
    setNoticeView(view);
    setNotice(null);
  }
  const titleId = useId();
  const foldersId = useId();
  const projectsId = useId();

  const pinnedSet = new Set(pinnedIds);
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const viewFolder = folderOf(view);
  const folderName = viewFolder === null ? null : (folderNames.get(viewFolder) ?? null);
  const title = view.kind === "recent" ? "Recent" : view.kind === "all" ? "All projects" : (folderName ?? "All projects");
  const shown =
    view.kind === "recent" ? recentProjects(projects, recentIds, search) : projectsInView(projects, { folderId: viewFolder, search, sort });
  const searching = search.trim() !== "";
  const showFolderTiles = view.kind === "all" && folders.length > 0 && !searching;

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
    if (viewFolder === null || folderName === null) return;
    setChosenFolder({ id: viewFolder, name: folderName });
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
        router.replace(spacePath(spaceSlug, viewQuery(ALL_VIEW)));
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
    if (searching) {
      const what = view.kind === "recent" ? "recent projects" : "projects";
      return <p className={EMPTY}>{`No ${what} match "${search.trim()}".`}</p>;
    }
    if (view.kind === "recent" && projects.length > 0) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className={EMPTY}>Projects you open show up here.</p>
          <Link
            href={spacePath(spaceSlug, viewQuery(ALL_VIEW))}
            className={cx("rounded-sm text-[13px] font-medium text-ed-accent hover:underline", FOCUS_RING, FADE)}
          >
            See all projects
          </Link>
        </div>
      );
    }
    if (view.kind === "folder") {
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

  // A card names its project's folder only in All projects.
  const noFolder = () => null;
  const ownFolder = (project: DashboardProject) => (project.folderId === null ? null : (folderNames.get(project.folderId) ?? null));
  const list = (folderName: (project: DashboardProject) => string | null) =>
    shown.length > 0 ? (
      <CardGrid
        projects={shown}
        folderName={folderName}
        now={now}
        canEdit={canEdit}
        pinned={pinnedSet}
        folders={folders}
        actions={actions}
        onGone={setNotice}
        spaceSlug={spaceSlug}
      />
    ) : (
      empty()
    );

  return (
    <ContextMenuProvider>
      {/* min-w-0: as wide as the window, never as wide as the sidebar's row, which scrolls sideways on its own. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <Sidebar
          folders={folders}
          pinned={pinnedProjects(projects, pinnedIds)}
          collapsed={sidebarCollapsed}
          view={view}
          canEdit={canEdit}
          spaceSlug={spaceSlug}
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
              {view.kind !== "recent" && (
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
              )}
            </div>
            {canEdit && newProjectButton("shrink-0")}
            {notice && (
              <p role="alert" className="order-last basis-full text-xs text-ed-danger">
                {notice}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-8 px-4 py-6">
            {notices && <div className="flex flex-col gap-3">{notices}</div>}
            {showFolderTiles && (
              <section aria-labelledby={foldersId}>
                <h2 id={foldersId} className={HEADING}>
                  Folders
                </h2>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                  {folders.map((folder) => (
                    <FolderTile key={folder.id} folder={folder} spaceSlug={spaceSlug} canEdit={canEdit} onDropProject={dropProject} />
                  ))}
                </ul>
              </section>
            )}
            {/* Under the folder tiles the projects get a heading of their own; otherwise the title names them. */}
            <section aria-labelledby={showFolderTiles ? projectsId : titleId}>
              {showFolderTiles && (
                <h2 id={projectsId} className={HEADING}>
                  Projects
                </h2>
              )}
              {list(view.kind === "all" ? ownFolder : noFolder)}
            </section>
          </div>
        </main>
      </div>
      {canEdit && (
        <>
          <NewProjectDialog
            open={newOpen}
            onClose={() => setNewOpen(false)}
            folders={folders}
            templates={templates}
            folderId={viewFolder}
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
