"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { SIDEBAR_BOX } from "@/components/dashboard/sidebar";
import { SpaceSwitcher, useCreateTeam, useMySpaces } from "@/components/dashboard/space-switcher";
import { linkButtonClass } from "@/components/ui/button-class";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { editorPath, slugFor, spacePath } from "@/lib/spaces/paths";
import { PERSONAL_SOON } from "@/lib/spaces/personal";
import { PERSONAL_ALIAS } from "@/lib/spaces/types";

export type PersonalSoonProps = {
  projects: readonly { id: string; name: string }[]; // what the person already made in their personal space
};

// A personal space while personal spaces are not offered yet: My Spaces as on any dashboard, and in place of the
// projects, that it is coming soon, with the way to the person's first team. Anything they already made here is
// listed, so no project is out of reach; nothing new starts here.
export function PersonalSoon({ projects }: PersonalSoonProps): ReactNode {
  const spaces = useMySpaces();
  const createTeam = useCreateTeam();
  const madeId = useId();
  const personal = spaces.find((space) => space.kind === "personal");
  const team = spaces.find((space) => space.kind === "team");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <div className={SIDEBAR_BOX}>
        {spaces.length > 0 && <SpaceSwitcher spaces={spaces} current={personal?.id ?? null} createTeam={createTeam} personalSoon />}
      </div>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-md flex-col items-start gap-3 px-4 py-10">
          <h1 className="text-base font-semibold">{PERSONAL_SOON.title}</h1>
          <p className="text-[13px] leading-5 text-ed-muted">{PERSONAL_SOON.text}</p>
          {team ? (
            <Link href={spacePath(slugFor(team))} className={linkButtonClass("primary", "mt-1 max-w-full")}>
              <span className="min-w-0 truncate">{PERSONAL_SOON.toTeam(team.name)}</span>
            </Link>
          ) : (
            <p className="text-[13px] leading-5 text-ed-text">{createTeam ? PERSONAL_SOON.noTeamCanCreate : PERSONAL_SOON.noTeam}</p>
          )}
          {projects.length > 0 && (
            <section aria-labelledby={madeId} className="mt-6 flex w-full flex-col gap-2 border-t border-ed-line pt-4">
              <h2 id={madeId} className="text-sm font-semibold">
                {PERSONAL_SOON.already}
              </h2>
              <ul className="flex flex-col gap-1">
                {projects.map((project) => (
                  <li key={project.id} className="min-w-0">
                    <Link
                      href={editorPath(PERSONAL_ALIAS, project.id)}
                      className={cx("block truncate rounded-sm text-[13px] leading-5 text-ed-text hover:underline", FOCUS_RING, FADE)}
                    >
                      {project.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
