import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";
import { PersonalSoon } from "@/components/dashboard/personal-soon";
import { getDb } from "@/db";
import { meetsRole, requireUser } from "@/lib/access";
import { SECTIONS_COOKIE } from "@/lib/dashboard/sidebar-sections";
import { STORAGE_LATER_COOKIE } from "@/lib/onboarding/storage-later";
import { ALL_VIEW, RECENT_VIEW, recentProjects, resolveView } from "@/lib/dashboard/view";
import { LIMITS } from "@/lib/limits";
import type { DashboardActions } from "@/lib/projects/dashboard-actions";
import { actorUserId, displayActor } from "@/lib/projects/display-actor";
import { listFolders } from "@/lib/projects/folders";
import { listRecentProjectIds } from "@/lib/projects/opens";
import { listPinnedIds } from "@/lib/projects/pins";
import { listProjects } from "@/lib/projects/service";
import { getUserNames } from "@/lib/projects/user-names";
import { actorIn } from "@/lib/spaces/access";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { findMySpace, listMySpaces, rememberSpace } from "@/lib/spaces/service";
import { slugFor } from "@/lib/spaces/paths";
import { storageState } from "@/lib/spaces/storage";
import { listTemplates } from "@/lib/templates/service";
import { storageBlock } from "@/lib/storage/availability";
import { connectionOwner } from "@/lib/storage/settings-view";
import { dashboardChannelNote } from "@/lib/social/messages";
import { dashboardNote, storageCard, storageSettingsPath } from "@/lib/storage/messages";
import { StorageBanner, StorageNote, StorageSetupCard } from "@/components/storage/storage-banner";
import {
  createFolderAction,
  createProjectAction,
  deleteFolderAction,
  deleteProjectAction,
  duplicateProjectAction,
  moveProjectAction,
  pinProjectAction,
  renameFolderAction,
  renameProjectAction,
  unpinProjectAction,
} from "@/app/(dashboard)/dashboard/actions";

// The server actions with this space already bound as their first argument.
const actionsFor = (spaceId: string): DashboardActions => ({
  create: createProjectAction.bind(null, spaceId),
  rename: renameProjectAction.bind(null, spaceId),
  remove: deleteProjectAction.bind(null, spaceId),
  duplicate: duplicateProjectAction.bind(null, spaceId),
  move: moveProjectAction.bind(null, spaceId),
  pin: pinProjectAction.bind(null, spaceId),
  unpin: unpinProjectAction.bind(null, spaceId),
  createFolder: createFolderAction.bind(null, spaceId),
  renameFolder: renameFolderAction.bind(null, spaceId),
  deleteFolder: deleteFolderAction.bind(null, spaceId),
});

// A space's dashboard, read on the server: its projects and folders, and the projects this person opened last.
// Searching and sorting happen in the browser. The address picks the view (resolveView): Recent by default (All projects
// when nothing here has been opened yet), ?view=recent or ?view=all
// for All projects, ?folder=<id> for a folder; ?new=project opens New project (the welcome's last step ends here). A space the person is not in is a plain 404. A personal space, while
// personal spaces are not offered (personalSpacesOpen), is the coming-soon page instead.
export default async function SpacePage({ params, searchParams }: PageProps<"/s/[space]">): Promise<ReactNode> {
  // The page checks for itself: a layout renders alongside its page and is not run again on a client navigation.
  const user = await requireUser();
  const db = getDb();
  const space = await findMySpace(db, user.id, (await params).space);
  if (!space) notFound();
  const actor = await actorIn(db, user, space.id);
  if (!actor) notFound();
  // Personal spaces are not offered yet: the page says so and lists what the person already made here. The space is not
  // remembered, so the dashboard's old address keeps leading to a team.
  if (space.kind === "personal" && !personalSpacesOpen()) {
    const made = await listProjects(db, actor);
    return <PersonalSoon projects={made.map(({ id, name }) => ({ id, name }))} />;
  }
  await rememberSpace(db, user.id, space.id);
  const canEdit = meetsRole(actor.role, "editor");
  const [projects, folders, recentIds, pinnedIds, templates] = await Promise.all([
    listProjects(db, actor),
    listFolders(db, actor),
    listRecentProjectIds(db, actor, LIMITS.dashboardRecent),
    listPinnedIds(db, actor),
    listTemplates(db, actor),
  ]);
  const names = await getUserNames(db, projects.map((project) => actorUserId(project.updatedBy)));
  const { folder, view: named, storage: storageNote, youtube: channelNote, new: opening } = await searchParams;
  const jar = await cookies();
  // The sidebar sections this browser folded, so the first paint already has them folded.
  const sidebarCollapsed = jar.get(SECTIONS_COOKIE)?.value;
  // Skipped in the welcome a moment ago: the Personal space's dashboard doesn't ask for storage again straight away.
  const storageLater = space.kind === "personal" && jar.get(STORAGE_LATER_COOKIE)?.value === "1";
  // Someone who has opened nothing here yet (a teammate's first visit) lands on All projects, not an empty Recent.
  const landing = recentProjects(projects, recentIds, "").length > 0 ? RECENT_VIEW : ALL_VIEW;
  const view = resolveView({ folder, view: named }, folders, landing);
  const slug = slugFor(space);
  // Where a project here can be moved to: the person's other spaces where they edit, personal ones only once offered.
  const moveTargets = canEdit
    ? (await listMySpaces(db, user.id)).filter((other) => other.id !== space.id && other.role !== "viewer" && (other.kind === "team" || personalSpacesOpen()))
    : [];
  const isAdmin = actor.role === "admin";
  // The space's storage, from its rows (no call to Google). A connection that broke: a banner for the people who
  // upload. No storage at all: the setup card for its admins, where this server can set storage up.
  const storage = await storageState(db, space.id);
  const settingsHref = storageSettingsPath(slug);
  const note = dashboardNote(storageNote) ?? dashboardChannelNote(channelNote);
  const broken = !storage.ready && storage.reason === "broken" && canEdit;
  // Only the person who connected the account can reconnect it; another admin is told who.
  const owner = broken && isAdmin ? await connectionOwner(db, space.id) : null;
  const block = !storage.ready && storage.reason === "none" && isAdmin && !storageLater ? storageBlock(space.kind) : undefined;
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
      templates={templates}
      recentIds={recentIds}
      pinnedIds={pinnedIds}
      sidebarCollapsed={sidebarCollapsed}
      view={view}
      canEdit={canEdit}
      now={new Date()}
      actions={actionsFor(space.id)}
      spaceSlug={slug}
      fromSpace={space}
      moveTargets={moveTargets}
      notices={notices}
      openNewProject={canEdit && opening === "project"}
    />
  );
}
