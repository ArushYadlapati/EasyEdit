import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getDb } from "@/db";
import { meetsRole, requireUser } from "@/lib/access";
import { resolveView } from "@/lib/dashboard/view";
import { LIMITS } from "@/lib/limits";
import type { DashboardActions } from "@/lib/projects/dashboard-actions";
import { actorUserId, displayActor } from "@/lib/projects/display-actor";
import { listFolders } from "@/lib/projects/folders";
import { listRecentProjectIds } from "@/lib/projects/opens";
import { listProjects } from "@/lib/projects/service";
import { getUserNames } from "@/lib/projects/user-names";
import { actorIn } from "@/lib/spaces/access";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import {
  createFolderAction,
  createProjectAction,
  deleteFolderAction,
  deleteProjectAction,
  duplicateProjectAction,
  moveProjectAction,
  renameFolderAction,
  renameProjectAction,
} from "./actions";

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

// The dashboard's data, read on the server: the team's projects and folders, and the projects this person opened
// last. Searching and sorting happen in the browser. ?folder=<id> shows that folder; an unknown id is the main view.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">): Promise<ReactNode> {
  // The page checks for itself: a layout renders alongside its page and is not run again on a client navigation.
  const user = await requireUser();
  const db = getDb();
  // stage-1: space comes from Task 8
  const actor = await actorIn(db, user, SEED_TEAM_ID);
  if (!actor) notFound();
  const canEdit = meetsRole(actor.role, "editor");
  const [projects, folders, recentIds] = await Promise.all([
    listProjects(db, actor),
    listFolders(db, actor),
    listRecentProjectIds(db, actor, LIMITS.dashboardRecent),
  ]);
  const names = await getUserNames(db, projects.map((project) => actorUserId(project.updatedBy)));
  const view = resolveView((await searchParams).folder, folders);

  return (
    <Dashboard
      projects={projects.map((project) => ({ ...project, changedBy: displayActor(project.updatedBy, names) }))}
      folders={folders}
      recentIds={recentIds}
      view={view}
      canEdit={canEdit}
      now={new Date()}
      actions={actionsFor(actor.spaceId)}
    />
  );
}
