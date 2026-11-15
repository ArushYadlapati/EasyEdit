"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { CreateTeamDialog } from "@/components/dashboard/create-team-dialog";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import type { TeamFormState } from "@/lib/spaces/team-actions";
import type { MySpace } from "@/lib/spaces/types";

// The person's spaces, loaded once by the dashboard layout so that the sidebar of any dashboard page can show them.
const SpacesContext = createContext<MySpace[]>([]);
// The action that makes a team, handed down only when the server decided the person may (sign-up open, or a Seattle
// Solvers admin); none means no Create a team item.
type CreateTeam = (formData: FormData) => Promise<TeamFormState>;
const CreateTeamContext = createContext<CreateTeam | undefined>(undefined);

export function SpacesProvider({
  spaces,
  createTeam,
  children,
}: {
  spaces: MySpace[];
  createTeam?: CreateTeam;
  children: ReactNode;
}): ReactNode {
  return (
    <SpacesContext value={spaces}>
      <CreateTeamContext value={createTeam}>{children}</CreateTeamContext>
    </SpacesContext>
  );
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
// team, opens a dialog that makes one with it.
export function SpaceSwitcher({
  spaces,
  current,
  createTeam,
}: {
  spaces: MySpace[];
  current: string | null;
  createTeam?: (formData: FormData) => Promise<TeamFormState>;
}): ReactNode {
  const [creating, setCreating] = useState(false);
  return (
    <nav aria-label="My Spaces" className="flex shrink-0 flex-row items-center gap-1 md:mb-3 md:flex-col md:items-stretch md:border-b md:border-ed-line md:pb-3">
      <h2 className={SIDEBAR_HEADING}>My Spaces</h2>
      {spaces.map((space) => {
        const isCurrent = space.id === current;
        return (
          <Link
            key={space.id}
            href={spacePath(slugFor(space))}
            aria-current={isCurrent ? "page" : undefined}
            className={cx(
              "flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-semibold whitespace-nowrap",
              isCurrent ? "bg-ed-accent-weak text-ed-accent" : "text-ed-text hover:bg-ed-hover",
              FOCUS_RING_INSET,
              FADE,
            )}
          >
            <span className="min-w-0 truncate">{labelOf(space)}</span>
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
    </nav>
  );
}
