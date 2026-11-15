import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { slugFor } from "@/lib/spaces/paths";
import { findMySpace } from "@/lib/spaces/service";
import { settingsTabPath, settingsTabsFor } from "@/lib/spaces/settings-tabs";

// /s/<space>/settings opens the first tab the viewer may open: Members in a team, Storage in a personal space. Someone
// not in the space gets a plain 404. The tab's page checks again for itself.
export default async function SpaceSettingsIndex({ params }: PageProps<"/s/[space]/settings">): Promise<never> {
  const user = await requireUser();
  const space = await findMySpace(getDb(), user.id, (await params).space);
  const first = space ? settingsTabsFor(space)[0] : undefined;
  if (!space || !first) notFound();
  redirect(settingsTabPath(slugFor(space), first.id));
}
