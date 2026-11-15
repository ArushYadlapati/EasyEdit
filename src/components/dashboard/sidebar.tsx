"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DROP_OVER, useProjectDrop } from "@/components/dashboard/use-project-drop";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import type { DashboardFolder } from "@/lib/dashboard/view";
import { SpaceSwitcher, useMySpaces } from "@/components/dashboard/space-switcher";
import { slugFor, spacePath } from "@/lib/spaces/paths";

export type SidebarProps = {
  folders: readonly DashboardFolder[];
  view: string | null;
  canEdit: boolean;
  spaceSlug: string;
  onNewFolder(): void;
  onDropProject(projectId: string, folderId: string | null): void; // null: out of its folder, onto Projects
};

// A view's link. For editors it also takes a dragged project (useProjectDrop), showing the accent outline while one is
// over it.
function SidebarLink({ href, current, folderId, canEdit, onDropProject, children }: {
  href: string;
  current: boolean;
  folderId: string | null;
  canEdit: boolean;
  onDropProject: SidebarProps["onDropProject"];
  children: ReactNode;
}) {
  const drop = useProjectDrop(canEdit, (projectId) => onDropProject(projectId, folderId));

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

// The dashboard's views: Projects, then each folder with its project count; the one in view is marked. A column at
// the left on a wide window, and one row above the grid that scrolls sideways on its own on a narrow one. For
// editors, New folder sits beside the Folders heading, or at the end of the row on a narrow window, where only the
// heading's text is hidden; and a project dragged onto a folder goes into it, or onto Projects out of its folder.
export function Sidebar({ folders, view, canEdit, spaceSlug, onNewFolder, onDropProject }: SidebarProps): ReactNode {
  const drop = { canEdit, onDropProject };
  const spaces = useMySpaces();
  const current = spaces.find((space) => slugFor(space) === spaceSlug);
  return (
    <nav
      aria-label="Folders"
      className={cx(
        "flex shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-ed-line bg-ed-panel px-4 py-2",
        "md:w-56 md:flex-col md:items-stretch md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:px-2 md:py-3",
      )}
    >
      {/* The person's spaces (from the dashboard layout), above the views. Not drawn without any, as in tests. */}
      {spaces.length > 0 && <SpaceSwitcher spaces={spaces} current={current?.id ?? null} />}
      <SidebarLink href={spacePath(spaceSlug)} current={view === null} folderId={null} {...drop}>
        Projects
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
          href={spacePath(spaceSlug, { folder: folder.id })}
          current={view === folder.id}
          folderId={folder.id}
          {...drop}
        >
          <span className="min-w-0 truncate">{folder.name}</span>{" "}
          <span className="text-ed-muted tabular-nums">{folder.projectCount}</span>
        </SidebarLink>
      ))}
    </nav>
  );
}
