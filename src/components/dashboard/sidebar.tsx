"use client";

import { Pin, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DROP_OVER, useProjectDrop } from "@/components/dashboard/use-project-drop";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { ALL_VIEW, RECENT_VIEW, folderOf, viewQuery, type DashboardFolder, type DashboardView } from "@/lib/dashboard/view";
import { CollapsedSectionsProvider, SidebarSection } from "@/components/dashboard/sidebar-section";
import { SpaceSwitcher, useCreateTeam, useMyInvites, useMySpaces, usePersonalSoon } from "@/components/dashboard/space-switcher";
import { editorPath, slugFor, spacePath } from "@/lib/spaces/paths";
import { settingsTabPath } from "@/lib/spaces/settings-tabs";
import { storageSettingsPath } from "@/lib/storage/messages";

export type SidebarProps = {
  folders: readonly DashboardFolder[];
  pinned?: readonly { id: string; name: string }[]; // the space's Pinned list, oldest pin first
  collapsed?: string; // the folded sections' cookie as the server read it (SECTIONS_COOKIE)
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

// The dashboard's side: My Spaces (which space you are in), then Projects (Recent and All projects), Pinned (the
// space's pinned projects, each opening in the editor; not drawn with none) and Folders (each with its project count)
// inside it; the view shown is marked. Each section's heading hides and shows it (SidebarSection). A column at the
// left on a wide window, and one row above the grid that scrolls sideways on its own on a narrow one, where the
// headings are kept for screen readers only. For
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

// The person's pending invites, one link each to its page (the invite page lets them join or decline). Not drawn with
// none. Shared with the page that says personal spaces are coming soon, which has no Sidebar.
export function InvitationsNav(): ReactNode {
  const invites = useMyInvites();
  if (invites.length === 0) return null;
  return (
    <nav aria-label="Invitations" className="flex shrink-0 flex-row items-center gap-1 md:flex-col md:items-stretch md:pt-3">
      <SidebarSection id="invitations" label="Invitations">
        {invites.map((invite) => (
          <Link
            key={invite.id}
            href={`/invite/${invite.id}`}
            className={cx(
              "flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap text-ed-text hover:bg-ed-hover",
              FOCUS_RING_INSET,
              FADE,
            )}
          >
            <span className="min-w-0 truncate">{invite.teamName}</span>
          </Link>
        ))}
      </SidebarSection>
    </nav>
  );
}

export function Sidebar({ folders, pinned = [], collapsed, view, canEdit, spaceSlug, onNewFolder, onDropProject }: SidebarProps): ReactNode {
  const spaces = useMySpaces();
  const createTeam = useCreateTeam();
  const personalSoon = usePersonalSoon();
  const current = spaces.find((space) => slugFor(space) === spaceSlug);
  const shownFolder = folderOf(view);
  const showMembers = current?.kind === "team";
  const showStorage = current?.role === "admin";
  return (
    <CollapsedSectionsProvider value={collapsed}>
      <div className={SIDEBAR_BOX}>
        {/* The person's spaces (from the dashboard layout), above what is in this one. Not drawn without any, as in tests. */}
        {spaces.length > 0 && <SpaceSwitcher spaces={spaces} current={current?.id ?? null} createTeam={createTeam} personalSoon={personalSoon} />}
        <InvitationsNav />
        {/* The space's brand kit, right under the spaces: its fonts, colors and logos. Not for a personal space while those are closed. */}
        {current && !(personalSoon && current.kind === "personal") && (
          <SidebarLink href={settingsTabPath(spaceSlug, "brand")} current={false} folderId={null} takesDrops={false} onDropProject={onDropProject}>
            Brand kit
          </SidebarLink>
        )}
        <nav aria-label="Projects" className="flex shrink-0 flex-row items-center gap-1 md:flex-col md:items-stretch">
          <SidebarSection id="projects" label="Projects">
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
          </SidebarSection>
          {pinned.length > 0 && (
            <SidebarSection id="pinned" label="Pinned" className="md:mt-4">
              {pinned.map((project) => (
                <SidebarLink key={project.id} href={editorPath(spaceSlug, project.id)} current={false} folderId={null} takesDrops={false} onDropProject={onDropProject}>
                  {/* On a narrow window the Pinned heading is for screen readers only, so a pin icon marks these in the row. */}
                  <span className="flex min-w-0 items-center gap-1">
                    <Pin role="img" aria-label="Pinned" className="size-3 shrink-0 text-ed-muted md:hidden" />
                    <span className="min-w-0 truncate">{project.name}</span>
                  </span>
                </SidebarLink>
              ))}
            </SidebarSection>
          )}
          <SidebarSection
            id="folders"
            label="Folders"
            className="md:mt-4"
            action={
              canEdit && (
                <IconButton label="New folder" className="order-last md:order-none" onClick={onNewFolder}>
                  <Plus />
                </IconButton>
              )
            }
          >
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
          </SidebarSection>
        </nav>
        {/* The space's own settings, at the foot of the column: a team's Members for everyone in it, Storage for admins. */}
        {(showMembers || showStorage) && (
          <nav aria-label="This space" className="flex shrink-0 flex-row items-center gap-1 md:mt-auto md:flex-col md:items-stretch md:pt-4">
            <SidebarSection id="space" label="This space">
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
            </SidebarSection>
          </nav>
        )}
      </div>
    </CollapsedSectionsProvider>
  );
}
