"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import type { MySpace } from "@/lib/spaces/types";

// The person's spaces, loaded once by the dashboard layout so that the sidebar of any dashboard page can show them.
const SpacesContext = createContext<MySpace[]>([]);

export function SpacesProvider({ spaces, children }: { spaces: MySpace[]; children: ReactNode }): ReactNode {
  return <SpacesContext value={spaces}>{children}</SpacesContext>;
}

export function useMySpaces(): MySpace[] {
  return useContext(SpacesContext);
}

// A space's name in the switcher: a personal space reads "Personal", a team its own name.
const labelOf = (space: MySpace) => (space.kind === "personal" ? "Personal" : space.name);

// Links between the person's spaces, in the order given (personal first, then teams). current is the id of the space in
// view; null marks none, for a page that belongs to no space.
export function SpaceSwitcher({ spaces, current }: { spaces: MySpace[]; current: string | null }): ReactNode {
  return (
    <nav aria-label="Spaces" className="flex shrink-0 flex-row items-center gap-1 md:mb-3 md:flex-col md:items-stretch md:border-b md:border-ed-line md:pb-3">
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
    </nav>
  );
}
