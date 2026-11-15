"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { CreateTeamDialog } from "@/components/dashboard/create-team-dialog";
import { SidebarSection } from "@/components/dashboard/sidebar-section";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { PERSONAL_SOON } from "@/lib/spaces/personal";
import type { TeamFormState } from "@/lib/spaces/team-actions";
import type { MySpace } from "@/lib/spaces/types";

// The person's spaces, loaded once by the dashboard layout so that the sidebar of any dashboard page can show them.
const SpacesContext = createContext<MySpace[]>([]);
// The action that makes a team, handed down only when the server decided the person may (sign-up open, or a Seattle
// Solvers admin); none means no Create a team item.
type CreateTeam = (formData: FormData) => Promise<TeamFormState>;
const CreateTeamContext = createContext<CreateTeam | undefined>(undefined);
// Whether personal spaces are not offered yet, as the server decided (personalSpacesOpen): the switcher then lists
// Personal last, marked Soon.
const PersonalSoonContext = createContext(false);

export function SpacesProvider({
  spaces,
  createTeam,
  personalSoon = false,
  children,
}: {
  spaces: MySpace[];
  createTeam?: CreateTeam;
  personalSoon?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <SpacesContext value={spaces}>
      <PersonalSoonContext value={personalSoon}>
        <CreateTeamContext value={createTeam}>{children}</CreateTeamContext>
      </PersonalSoonContext>
    </SpacesContext>
  );
}

export function usePersonalSoon(): boolean {
  return useContext(PersonalSoonContext);
}

export function useCreateTeam(): CreateTeam | undefined {
  return useContext(CreateTeamContext);
}

export function useMySpaces(): MySpace[] {
  return useContext(SpacesContext);
}

// A heading of the dashboard's sidebar: small capitals beside the list on a wide window, and kept for screen readers
// only on a narrow one, where the sidebar is a single row.
export const SIDEBAR_HEADING = "sr-only text-[11px] font-semibold tracking-wide text-ed-muted uppercase md:not-sr-only md:pb-1 md:pl-2";

// A space's name in the switcher: a personal space reads "Personal", a team its own name.
const labelOf = (space: MySpace) => (space.kind === "personal" ? "Personal" : space.name);

// Links between the person's spaces, in the order given (personal first, then teams), under My Spaces. current is the
// id of the space in view; null marks none, for a page that belongs to no space. With createTeam, a last item, Create a
// team, opens a dialog that makes one with it. With personalSoon (personal spaces are not offered yet), the teams come
// first and Personal last, quieter and tagged Soon; its link leads to the page that says so.
export function SpaceSwitcher({
  spaces: given,
  current,
  createTeam,
  personalSoon = false,
}: {
  spaces: MySpace[];
  current: string | null;
  createTeam?: (formData: FormData) => Promise<TeamFormState>;
  personalSoon?: boolean;
}): ReactNode {
  const [creating, setCreating] = useState(false);
  const spaces = personalSoon ? [...given.filter((s) => s.kind === "team"), ...given.filter((s) => s.kind === "personal")] : given;
  return (
    <nav aria-label="My Spaces" className="flex shrink-0 flex-row items-center gap-1 md:mb-3 md:flex-col md:items-stretch md:border-b md:border-ed-line md:pb-3">
      <SidebarSection id="spaces" label="My Spaces">
        {spaces.map((space) => {
          const isCurrent = space.id === current;
          const soon = personalSoon && space.kind === "personal";
          return (
            <Link
              key={space.id}
              href={spacePath(slugFor(space))}
              aria-current={isCurrent ? "page" : undefined}
              aria-label={soon ? `${labelOf(space)}, ${PERSONAL_SOON.label}` : undefined}
              className={cx(
                "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-xs font-semibold whitespace-nowrap",
                isCurrent ? "bg-ed-accent-weak text-ed-accent" : soon ? "text-ed-muted hover:bg-ed-hover" : "text-ed-text hover:bg-ed-hover",
                FOCUS_RING_INSET,
                FADE,
              )}
            >
              <span className="min-w-0 truncate">{labelOf(space)}</span>
              {soon && " "}
              {soon && (
                <span className="rounded-sm border border-ed-line px-1 text-[10px] leading-4 font-medium text-ed-muted">{PERSONAL_SOON.tag}</span>
              )}
            </Link>
          );
        })}
        {createTeam && (
          <>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className={cx(
                "flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-semibold whitespace-nowrap text-ed-text hover:bg-ed-hover",
                FOCUS_RING_INSET,
                FADE,
              )}
            >
              Create a team
            </button>
            <CreateTeamDialog open={creating} action={createTeam} onClose={() => setCreating(false)} />
          </>
        )}
      </SidebarSection>
    </nav>
  );
}
