"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import type { DashboardFolder } from "@/lib/dashboard/view";

function SidebarLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "flex h-7 shrink-0 items-center justify-between gap-3 rounded-md px-2 text-xs font-medium whitespace-nowrap",
        current ? "bg-ed-accent-weak text-ed-accent" : "text-ed-text hover:bg-ed-hover",
        FOCUS_RING_INSET,
        FADE,
      )}
    >
      {children}
    </Link>
  );
}

// The dashboard's views: Projects, then each folder with its project count; the one in view is marked. A column at
// the left on a wide window, and one row above the grid that scrolls sideways on its own on a narrow one.
export function Sidebar({ folders, view }: { folders: readonly DashboardFolder[]; view: string | null }): ReactNode {
  return (
    <nav
      aria-label="Folders"
      className={cx(
        "flex shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-ed-line bg-ed-panel px-4 py-2",
        "md:w-56 md:flex-col md:items-stretch md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:px-2 md:py-3",
      )}
    >
      <SidebarLink href="/dashboard" current={view === null}>
        Projects
      </SidebarLink>
      <h2 className="sr-only text-[11px] font-semibold tracking-wide text-ed-muted uppercase md:not-sr-only md:mt-4 md:px-2 md:pb-1">
        Folders
      </h2>
      {folders.map((folder) => (
        <SidebarLink key={folder.id} href={`/dashboard?folder=${encodeURIComponent(folder.id)}`} current={view === folder.id}>
          <span className="min-w-0 truncate">{folder.name}</span>{" "}
          <span className="text-ed-muted tabular-nums">{folder.projectCount}</span>
        </SidebarLink>
      ))}
    </nav>
  );
}
