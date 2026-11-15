"use client";

import { Folder } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DROP_OVER, useProjectDrop } from "@/components/dashboard/use-project-drop";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import type { DashboardFolder } from "@/lib/dashboard/view";
import { spacePath } from "@/lib/spaces/paths";

// A folder in the main view's Folders section: its icon, name and project count, opening the folder's view. For
// editors it also takes a dragged project card, as the folder's sidebar link does.
export function FolderTile({ folder, spaceSlug, canEdit, onDropProject }: {
  folder: DashboardFolder;
  spaceSlug: string;
  canEdit: boolean;
  onDropProject(projectId: string, folderId: string): void;
}): ReactNode {
  const drop = useProjectDrop(canEdit, (projectId) => onDropProject(projectId, folder.id));
  const count = `${folder.projectCount} ${folder.projectCount === 1 ? "project" : "projects"}`;

  return (
    <li className="min-w-0">
      <Link
        href={spacePath(spaceSlug, { folder: folder.id })}
        aria-label={`${folder.name}, ${count}`}
        className={cx(
          "flex h-12 min-w-0 items-center gap-3 rounded-md border border-ed-line bg-ed-panel px-3 text-sm font-medium text-ed-text hover:bg-ed-hover",
          DROP_OVER,
          FOCUS_RING,
          FADE,
        )}
        {...drop}
      >
        <Folder aria-hidden className="size-4 shrink-0 text-ed-muted" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="shrink-0 text-xs text-ed-muted tabular-nums">{folder.projectCount}</span>
      </Link>
    </li>
  );
}
