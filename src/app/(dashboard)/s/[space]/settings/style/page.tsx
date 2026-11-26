import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { StylePage } from "@/components/style/style-page";
import { getDb } from "@/db";
import { meetsRole, requireUser } from "@/lib/access";
import { listProjects } from "@/lib/projects/service";
import { socialConfig } from "@/lib/social/config";
import { findConnection } from "@/lib/social/connections";
import { actorIn } from "@/lib/spaces/access";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { findMySpace } from "@/lib/spaces/service";
import { storageState } from "@/lib/spaces/storage";
import { getStyle, listReferences } from "@/lib/style/service";

// How many of the space's most recent projects the page offers to learn from.
const PROJECTS_OFFERED = 20;

// A space's style, which AI agents read before they edit, for every member; editors and admins can change it and what
// it learns from. Anyone else gets a plain 404. The page checks for itself: a layout is not run again on a client
// navigation. Only plain data goes to the browser: whether there is a YouTube channel to pick from is a yes or no, and
// it is yes only on a server with YouTube set up, for an editor, in a space whose channel is connected (not broken)
// with leave to read its videos. The time the page was drawn goes too, so "2 hours ago" reads the same in the
// server's drawing and the browser's.
export default async function StyleSettingsPage({ params }: PageProps<"/s/[space]/settings/style">): Promise<ReactNode> {
  const user = await requireUser();
  const db = getDb();
  const space = await findMySpace(db, user.id, (await params).space);
  if (!space) notFound();
  // Nothing to set up for a personal space while personal spaces are not offered: back to its coming-soon page.
  if (space.kind === "personal" && !personalSpacesOpen()) redirect(spacePath(slugFor(space)));
  const actor = await actorIn(db, user, space.id);
  if (!actor) notFound();
  const style = await getStyle(db, actor);
  const references = await listReferences(db, actor);
  const projects = (await listProjects(db, actor))
    .slice(0, PROJECTS_OFFERED)
    .map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt.toISOString() }));
  const storage = await storageState(db, space.id);
  const canEdit = meetsRole(actor.role, "editor");
  const social = socialConfig();
  const channel = social && canEdit ? await findConnection(db, social, space.id) : null;
  return (
    <StylePage
      spaceId={space.id}
      spaceSlug={slugFor(space)}
      spaceName={space.kind === "personal" ? null : space.name}
      canEdit={canEdit}
      isAdmin={actor.role === "admin"}
      initialStyle={style}
      initialReferences={references}
      projects={projects}
      storageReady={storage.ready}
      channelOn={channel !== null && !channel.broken && channel.channelId !== null}
      now={new Date()}
    />
  );
}
