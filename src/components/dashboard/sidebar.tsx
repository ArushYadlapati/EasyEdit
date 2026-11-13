"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState, type DragEvent, type ReactNode } from "react";
import { PROJECT_DRAG_TYPE } from "@/components/dashboard/drag";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import type { DashboardFolder } from "@/lib/dashboard/view";

export type SidebarProps = {
  folders: readonly DashboardFolder[];
  view: string | null;
  canEdit: boolean;
  onNewFolder(): void;
  onDropProject(projectId: string, folderId: string | null): void; // null: out of its folder, onto Projects
};

const carriesProject = (event: DragEvent) => [...event.dataTransfer.types].includes(PROJECT_DRAG_TYPE);

// A view's link. For editors it also takes a dragged project, showing the accent outline while one is over it; every
// other drag (files, text, links) is left to the browser.
function SidebarLink({ href, current, folderId, canEdit, onDropProject, children }: {
  href: string;
  current: boolean;
  folderId: string | null;
  canEdit: boolean;
  onDropProject: SidebarProps["onDropProject"];
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const takes = (event: DragEvent) => canEdit && carriesProject(event);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      data-drop-over={over || undefined}
      className={cx(
        "flex h-7 shrink-0 items-center justify-between gap-3 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        current ? "bg-ed-accent-weak text-ed-accent" : "text-ed-text hover:bg-ed-hover",
        "data-drop-over:bg-ed-accent-weak data-drop-over:outline-2 data-drop-over:-outline-offset-2 data-drop-over:outline-ed-accent",
        FOCUS_RING_INSET,
        FADE,
      )}
      onDragOver={(event) => {
        if (!takes(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(event) => {
        // Moving onto the link's own text is not leaving it.
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        if (!takes(event)) return;
        event.preventDefault();
        setOver(false);
        onDropProject(event.dataTransfer.getData(PROJECT_DRAG_TYPE), folderId);
      }}
    >
      {children}
    </Link>
  );
}

// The dashboard's views: Projects, then each folder with its project count; the one in view is marked. A column at
// the left on a wide window, and one row above the grid that scrolls sideways on its own on a narrow one. For
// editors, New folder sits beside the Folders heading, or at the end of the row on a narrow window, where only the
// heading's text is hidden; and a project dragged onto a folder goes into it, or onto Projects out of its folder.
export function Sidebar({ folders, view, canEdit, onNewFolder, onDropProject }: SidebarProps): ReactNode {
  const drop = { canEdit, onDropProject };
  return (
    <nav
      aria-label="Folders"
      className={cx(
        "flex shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-ed-line bg-ed-panel px-4 py-2",
        "md:w-56 md:flex-col md:items-stretch md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:px-2 md:py-3",
      )}
    >
      <SidebarLink href="/dashboard" current={view === null} folderId={null} {...drop}>
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
          href={`/dashboard?folder=${encodeURIComponent(folder.id)}`}
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
