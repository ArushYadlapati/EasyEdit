"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BlankFrame } from "@/components/dashboard/blank-frame";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import type { DashboardProject } from "@/lib/dashboard/view";
import { formatLabel } from "@/lib/timeline";
import { timeAgo } from "@/lib/time-ago";

export type ProjectCardProps = {
  project: DashboardProject;
  folderName: string | null; // shown under the card, in All projects only
  now: Date;
  canEdit: boolean;
};

// A project on the dashboard: a blank frame in its shape and its name, which open it in the editor, then its format,
// who changed it last and when, and its folder.
export function ProjectCard({ project, folderName, now }: ProjectCardProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Link href={`/editor/${project.id}`} className={cx("group flex min-w-0 flex-col gap-2 rounded-md", FOCUS_RING)}>
        <div className="aspect-video rounded-md border border-ed-line bg-ed-panel p-3 transition-colors duration-120 group-hover:bg-ed-hover motion-reduce:transition-none">
          <BlankFrame width={project.width} height={project.height} />
        </div>
        <div className="truncate text-sm font-medium text-ed-text">{project.name}</div>
      </Link>
      <div className="flex min-w-0 flex-col gap-0.5 text-xs text-ed-muted">
        <span className="truncate">{formatLabel(project)}</span>
        <span className="truncate">{`Changed ${timeAgo(project.updatedAt, now, "short")} by ${project.changedBy}`}</span>
        {folderName !== null && <span className="truncate">{folderName}</span>}
      </div>
    </div>
  );
}
