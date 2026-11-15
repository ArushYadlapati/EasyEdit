import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getDb } from "@/db";
import { meetsRole, requireUser } from "@/lib/access";
import { ALL_VIEW, RECENT_VIEW, recentProjects, resolveView } from "@/lib/dashboard/view";
import { LIMITS } from "@/lib/limits";
import type { DashboardActions } from "@/lib/projects/dashboard-actions";
import { actorUserId, displayActor } from "@/lib/projects/display-actor";
import { listFolders } from "@/lib/projects/folders";
import { listRecentProjectIds } from "@/lib/projects/opens";
import { listProjects } from "@/lib/projects/service";
import { getUserNames } from "@/lib/projects/user-names";
import { actorIn } from "@/lib/spaces/access";
import { findMySpace, rememberSpace } from "@/lib/spaces/service";
import { slugFor } from "@/lib/spaces/paths";
import { storageState } from "@/lib/spaces/storage";
import { storageBlock } from "@/lib/storage/availability";
import { connectionOwner } from "@/lib/storage/settings-view";
import { dashboardNote, storageCard, storageSettingsPath } from "@/lib/storage/messages";
import { StorageBanner, StorageNote, StorageSetupCard } from "@/components/storage/storage-banner";
import {
  createFolderAction,
  createProjectAction,
  deleteFolderAction,
  deleteProjectAction,
  duplicateProjectAction,
  moveProjectAction,
  renameFolderAction,
  renameProjectAction,
} from "@/app/(dashboard)/dashboard/actions";

// The server actions with this space already bound as their first argument.
const actionsFor = (spaceId: string): DashboardActions => ({
  create: createProjectAction.bind(null, spaceId),
  rename: renameProjectAction.bind(null, spaceId),
  remove: deleteProjectAction.bind(null, spaceId),
  duplicate: duplicateProjectAction.bind(null, spaceId),
  move: moveProjectAction.bind(null, spaceId),
  createFolder: createFolderAction.bind(null, spaceId),
  renameFolder: renameFolderAction.bind(null, spaceId),
  deleteFolder: deleteFolderAction.bind(null, spaceId),
});

// A space's dashboard, read on the server: its projects and folders, and the projects this person opened last.
// Searching and sorting happen in the browser. The address picks the view (resolveView): Recent by default (All projects
// when nothing here has been opened yet), ?view=recent or ?view=all
// for All projects, ?folder=<id> for a folder. A space the person is not in is a plain 404.
export default async function SpacePage({ params, searchParams }: PageProps<"/s/[space]">): Promise<ReactNode> {
  // The page checks for itself: a layout renders alongside its page and is not run again on a client navigation.
  const user = await requireUser();
  const db = getDb();
  const space = await findMySpace(db, user.id, (await params).space);
  if (!space) notFound();
  const actor = await actorIn(db, user, space.id);
  if (!actor) notFound();
  await rememberSpace(db, user.id, space.id);
  const canEdit = meetsRole(actor.role, "editor");
  const [projects, folders, recentIds] = await Promise.all([
    listProjects(db, actor),
    listFolders(db, actor),
    listRecentProjectIds(db, actor, LIMITS.dashboardRecent),
  ]);
  const names = await getUserNames(db, projects.map((project) => actorUserId(project.updatedBy)));
  const { folder, view: named, storage: storageNote } = await searchParams;
  // Someone who has opened nothing here yet (a teammate's first visit) lands on All projects, not an empty Recent.
  const landing = recentProjects(projects, recentIds, "").length > 0 ? RECENT_VIEW : ALL_VIEW;
  const view = resolveView({ folder, view: named }, folders, landing);
  const slug = slugFor(space);
  const isAdmin = actor.role === "admin";
  // The space's storage, from its rows (no call to Google). A connection that broke: a banner for the people who
  // upload. No storage at all: the setup card for its admins, where this server can set storage up.
  const storage = await storageState(db, space.id);
  const settingsHref = storageSettingsPath(slug);
  const note = dashboardNote(storageNote);
  const broken = !storage.ready && storage.reason === "broken" && canEdit;
  // Only the person who connected the account can reconnect it; another admin is told who.
  const owner = broken && isAdmin ? await connectionOwner(db, space.id) : null;
  const block = !storage.ready && storage.reason === "none" && isAdmin ? storageBlock(space.kind) : undefined;
  const notices =
    note || broken || block === null ? (
      <>
        {note && <StorageNote note={note} />}
        {broken && <StorageBanner settingsHref={settingsHref} isAdmin={isAdmin} isOwner={owner?.userId === user.id} ownerEmail={owner?.email ?? null} />}
        {block === null && <StorageSetupCard card={storageCard({ problem: "none", kind: space.kind, isAdmin, block })} settingsHref={settingsHref} />}
      </>
    ) : null;

  return (
    <Dashboard
      projects={projects.map((project) => ({ ...project, changedBy: displayActor(project.updatedBy, names) }))}
      folders={folders}
      recentIds={recentIds}
      view={view}
      canEdit={canEdit}
      now={new Date()}
      actions={actionsFor(space.id)}
      spaceSlug={slug}
      notices={notices}
    />
  );
}
