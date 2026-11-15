"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DROP_OVER, useProjectDrop } from "@/components/dashboard/use-project-drop";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { ALL_VIEW, RECENT_VIEW, folderOf, viewQuery, type DashboardFolder, type DashboardView } from "@/lib/dashboard/view";
import { SIDEBAR_HEADING, SpaceSwitcher, useCreateTeam, useMySpaces, usePersonalSoon } from "@/components/dashboard/space-switcher";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { settingsTabPath } from "@/lib/spaces/settings-tabs";
import { storageSettingsPath } from "@/lib/storage/messages";

export type SidebarProps = {
  folders: readonly DashboardFolder[];
  view: DashboardView;
  canEdit: boolean;
  spaceSlug: string;
  onNewFolder(): void;
  onDropProject(projectId: string, folderId: string | null): void; // null: out of its folder, onto All projects
};

// A view's link. When it takes drops (an editor's All projects and folders) a dragged project goes there
// (useProjectDrop), showing the accent outline while one is over it.
function SidebarLink({ href, current, folderId, takesDrops, onDropProject, children }: {
  href: string;
  current: boolean;
  folderId: string | null;
  takesDrops: boolean;
  onDropProject: SidebarProps["onDropProject"];
  children: ReactNode;
}) {
  const drop = useProjectDrop(takesDrops, (projectId) => onDropProject(projectId, folderId));

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "flex h-7 shrink-0 items-center justify-between gap-3 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        current ? "bg-ed-accent-weak text-ed-accent" : "text-ed-text hover:bg-ed-hover",
        DROP_OVER,
        FOCUS_RING_INSET,
        FADE,
      )}
      {...drop}
    >
      {children}
    </Link>
  );
}

// The dashboard's side: My Spaces (which space you are in), then Projects (Recent and All projects) and Folders (each
// with its project count) inside it; the view shown is marked. A column at the left on a wide window, and one row above
// the grid that scrolls sideways on its own on a narrow one, where the headings are kept for screen readers only. For
// editors, New folder sits beside the Folders heading, or at the end of the row on a narrow window; and a project
// dragged onto a folder goes into it, or onto All projects out of its folder. This space sits at the foot of the column:
// a team's Members for everyone in it, and the space's Storage settings for its admins.
// The sidebar's box: a column at the left on a wide window, one row that scrolls sideways on a narrow one.
// relative: the headings are sr-only on a narrow window (absolutely placed), and without a positioned row they sit past
// its right edge and make the whole page scroll sideways.
export const SIDEBAR_BOX = cx(
  "relative flex shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-ed-line bg-ed-panel px-4 py-2",
  "md:w-56 md:flex-col md:items-stretch md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:px-2 md:py-3",
);

export function Sidebar({ folders, view, canEdit, spaceSlug, onNewFolder, onDropProject }: SidebarProps): ReactNode {
  const spaces = useMySpaces();
  const createTeam = useCreateTeam();
  const personalSoon = usePersonalSoon();
  const current = spaces.find((space) => slugFor(space) === spaceSlug);
  const shownFolder = folderOf(view);
  const showMembers = current?.kind === "team";
  const showStorage = current?.role === "admin";
  return (
    <div className={SIDEBAR_BOX}>
      {/* The person's spaces (from the dashboard layout), above what is in this one. Not drawn without any, as in tests. */}
      {spaces.length > 0 && <SpaceSwitcher spaces={spaces} current={current?.id ?? null} createTeam={createTeam} personalSoon={personalSoon} />}
      <nav aria-label="Projects" className="flex shrink-0 flex-row items-center gap-1 md:flex-col md:items-stretch">
        <h2 className={SIDEBAR_HEADING}>Projects</h2>
        <SidebarLink href={spacePath(spaceSlug, viewQuery(RECENT_VIEW))} current={view.kind === "recent"} folderId={null} takesDrops={false} onDropProject={onDropProject}>
          Recent
        </SidebarLink>
        <SidebarLink
          href={spacePath(spaceSlug, viewQuery(ALL_VIEW))}
          current={view.kind === "all"}
          folderId={null}
          takesDrops={canEdit}
          onDropProject={onDropProject}
        >
          All projects
        </SidebarLink>
        {/* On a narrow window this box is not drawn, so the heading and New folder are items of the row. */}
        <div className="contents md:mt-4 md:flex md:items-center md:justify-between md:gap-2 md:pb-1 md:pl-2">
          <h2 className="sr-only text-[11px] font-semibold tracking-wide text-ed-muted uppercase md:not-sr-only">Folders</h2>
          {canEdit && (
            <IconButton label="New folder" className="order-last md:order-none" onClick={onNewFolder}>
              <Plus />
            </IconButton>
          )}
        </div>
        {folders.map((folder) => (
          <SidebarLink
            key={folder.id}
            href={spacePath(spaceSlug, viewQuery({ kind: "folder", folderId: folder.id }))}
            current={shownFolder === folder.id}
            folderId={folder.id}
            takesDrops={canEdit}
            onDropProject={onDropProject}
          >
            <span className="min-w-0 truncate">{folder.name}</span>{" "}
            <span className="text-ed-muted tabular-nums">{folder.projectCount}</span>
          </SidebarLink>
        ))}
      </nav>
      {/* The space's own settings, at the foot of the column: a team's Members for everyone in it, Storage for admins. */}
      {(showMembers || showStorage) && (
        <nav aria-label="This space" className="flex shrink-0 flex-row items-center gap-1 md:mt-auto md:flex-col md:items-stretch md:pt-4">
          <h2 className={SIDEBAR_HEADING}>This space</h2>
          {showMembers && (
            <SidebarLink href={settingsTabPath(spaceSlug, "members")} current={false} folderId={null} takesDrops={false} onDropProject={onDropProject}>
              Members
            </SidebarLink>
          )}
          {showStorage && (
            <SidebarLink href={storageSettingsPath(spaceSlug)} current={false} folderId={null} takesDrops={false} onDropProject={onDropProject}>
              Storage
            </SidebarLink>
          )}
        </nav>
      )}
    </div>
  );
}
