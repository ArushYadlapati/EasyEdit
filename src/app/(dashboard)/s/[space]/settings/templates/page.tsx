import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { TemplatesPage } from "@/components/dashboard/templates-page";
import { getDb } from "@/db";
import { meetsRole, requireUser } from "@/lib/access";
import { actorIn } from "@/lib/spaces/access";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { findMySpace } from "@/lib/spaces/service";
import { listTemplates } from "@/lib/templates/service";

export const metadata: Metadata = { title: "Templates" };

// A space's templates, for every member; editors and admins can edit and delete the saved ones. Anyone else gets a
// plain 404. The page checks for itself: a layout is not run again on a client navigation.
export default async function TemplatesSettingsPage({ params }: PageProps<"/s/[space]/settings/templates">): Promise<ReactNode> {
  const user = await requireUser();
  const db = getDb();
  const space = await findMySpace(db, user.id, (await params).space);
  if (!space) notFound();
  if (space.kind === "personal" && !personalSpacesOpen()) redirect(spacePath(slugFor(space)));
  const actor = await actorIn(db, user, space.id);
  if (!actor) notFound();
  const templates = await listTemplates(db, actor);
  return <TemplatesPage spaceId={space.id} canEdit={meetsRole(actor.role, "editor")} templates={templates} />;
}
