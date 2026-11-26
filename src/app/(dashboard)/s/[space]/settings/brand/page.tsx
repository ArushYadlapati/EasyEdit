import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BrandKitPage } from "@/components/dashboard/brand-kit-page";
import { getDb } from "@/db";
import { meetsRole, requireUser } from "@/lib/access";
import { getBrandKit } from "@/lib/brand/service";
import { actorIn } from "@/lib/spaces/access";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { findMySpace } from "@/lib/spaces/service";
import { storageState } from "@/lib/spaces/storage";

// A space's brand kit, for every member; editors and admins can change it. Anyone else gets a plain 404. The page
// checks for itself: a layout is not run again on a client navigation.
export default async function BrandKitSettingsPage({ params }: PageProps<"/s/[space]/settings/brand">): Promise<ReactNode> {
  const user = await requireUser();
  const db = getDb();
  const space = await findMySpace(db, user.id, (await params).space);
  if (!space) notFound();
  // Nothing to set up for a personal space while personal spaces are not offered: back to its coming-soon page.
  if (space.kind === "personal" && !personalSpacesOpen()) redirect(spacePath(slugFor(space)));
  const actor = await actorIn(db, user, space.id);
  if (!actor) notFound();
  const kit = await getBrandKit(db, actor);
  const storage = await storageState(db, space.id);
  return <BrandKitPage spaceId={space.id} spaceKind={space.kind} canEdit={meetsRole(actor.role, "editor")} initial={kit} storageReady={storage.ready} />;
}
