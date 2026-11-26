import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/dashboard/settings-tabs";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { mySpace, spaceLabel } from "../page-data";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { personalSpacesOpen } from "@/lib/spaces/personal";
import { settingsTabsFor } from "@/lib/spaces/settings-tabs";
import { socialConfig } from "@/lib/social/config";

// Each tab's page names only itself ("Members"); the browser tab adds the space and the product, "Members · Robots ·
// EasyEdit". This template stands in for the dashboard's, as the nearest one wins.
export async function generateMetadata({ params }: LayoutProps<"/s/[space]/settings">): Promise<Metadata> {
  const space = await mySpace((await params).space);
  if (!space) return {};
  const label = spaceLabel(space);
  return { title: { template: `%s · ${label} · EasyEdit`, default: `Settings · ${label} · EasyEdit` } };
}

// A space's settings, for its members: the space's name, the way back to its projects, and a row of the tabs they may
// open (settingsTabsFor: Members in a team, for everyone; Storage, for its admins; Brand kit, Style and Templates, for
// everyone; Socials, for its admins where posting is set up). Someone not in the space gets a plain 404. Each page
// checks again for itself, as a layout is not run again on a client navigation.
export default async function SpaceSettingsLayout({ params, children }: LayoutProps<"/s/[space]/settings">): Promise<ReactNode> {
  const space = await mySpace((await params).space);
  if (!space) notFound();
  const slug = slugFor(space);
  // A personal space has no settings while personal spaces are not offered: back to its coming-soon page.
  if (space.kind === "personal" && !personalSpacesOpen()) redirect(spacePath(slug));

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        <Link
          href={spacePath(slug)}
          className={cx("self-start rounded-sm text-[13px] text-ed-muted hover:text-ed-text hover:underline", FOCUS_RING, FADE)}
        >
          Back to projects
        </Link>
        <h1 className="min-w-0 truncate text-base font-semibold">{spaceLabel(space)}</h1>
        <SettingsTabs slug={slug} tabs={settingsTabsFor(space, { socials: socialConfig() !== null })} />
        {children}
      </div>
    </main>
  );
}
