"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMySpaces } from "@/components/dashboard/space-switcher";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { slugFor } from "@/lib/spaces/paths";
import { SEED_TEAM_ID, type MySpace } from "@/lib/spaces/types";

// The space a dashboard address is in (/s/<slug>, and anything under it), or null for one that is in none.
export function spaceAt(pathname: string, spaces: readonly MySpace[]): MySpace | null {
  const match = /^\/s\/([^/?#]+)/.exec(pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  return spaces.find((space) => slugFor(space) === slug) ?? null;
}

// The header's link to the Admin page, for an admin (the caller checks). That page runs the Seattle Solvers member
// list, so the link shows only while Seattle Solvers is the space in view, and on the Admin page itself; never in
// Personal. The page checks the person's role for itself, so a typed /admin works as before.
export function AdminLink(): ReactNode {
  const pathname = usePathname() ?? "";
  const spaces = useMySpaces();
  const onAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!onAdmin && spaceAt(pathname, spaces)?.id !== SEED_TEAM_ID) return null;
  return (
    <Link
      href="/admin"
      aria-current={onAdmin ? "page" : undefined}
      className={cx(
        "rounded-md px-2 py-1 text-xs font-medium hover:bg-ed-hover hover:text-ed-text",
        onAdmin ? "text-ed-text" : "text-ed-muted",
        FOCUS_RING,
        FADE,
      )}
    >
      Admin
    </Link>
  );
}
