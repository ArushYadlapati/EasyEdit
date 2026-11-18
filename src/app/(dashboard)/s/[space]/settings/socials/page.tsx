import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SocialsSettings } from "@/components/socials/socials-settings";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { socialConfig } from "@/lib/social/config";
import { socialsSettings } from "@/lib/social/view";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { findMySpace } from "@/lib/spaces/service";
import { disconnectYoutubeAction } from "./actions";

// The YouTube channel a space posts to, for its admins (a personal space's owner is one). Anyone else gets a plain
// 404, and so does everyone on a server where posting is not set up. ?youtube=<note> is what connecting a channel
// came back with. The page checks for itself: a layout is not run again on a client navigation.
export default async function SocialsSettingsPage({ params, searchParams }: PageProps<"/s/[space]/settings/socials">): Promise<ReactNode> {
  const user = await requireUser();
  const db = getDb();
  const space = await findMySpace(db, user.id, (await params).space);
  const cfg = socialConfig();
  if (!space || space.role !== "admin" || !cfg) notFound();
  if (space.kind === "personal" && !personalSpacesOpen()) redirect(spacePath(slugFor(space)));
  const view = await socialsSettings(db, cfg, space);
  const { youtube } = await searchParams;
  const note = (Array.isArray(youtube) ? youtube[0] : youtube) ?? null;

  return <SocialsSettings view={view} note={note} disconnect={disconnectYoutubeAction.bind(null, space.id)} />;
}
