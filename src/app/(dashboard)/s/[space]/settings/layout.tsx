import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/dashboard/settings-tabs";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { findMySpace } from "@/lib/spaces/service";

// A space's settings, for its admins: the space's name, the way back to its projects, and a row of tabs (Storage;
// more come later). Anyone else, a member who isn't an admin or someone not in the space, gets a plain 404, as each
// page checks again for itself.
export default async function SpaceSettingsLayout({ params, children }: LayoutProps<"/s/[space]/settings">): Promise<ReactNode> {
  const user = await requireUser();
  const space = await findMySpace(getDb(), user.id, (await params).space);
  if (!space || space.role !== "admin") notFound();
  const slug = slugFor(space);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        <Link
          href={spacePath(slug)}
          className={cx("self-start rounded-sm text-[13px] text-ed-muted hover:text-ed-text hover:underline", FOCUS_RING, FADE)}
        >
          Back to projects
        </Link>
        <h1 className="min-w-0 truncate text-base font-semibold">{space.kind === "personal" ? "Personal" : space.name}</h1>
        <SettingsTabs slug={slug} />
        {children}
      </div>
    </main>
  );
}
