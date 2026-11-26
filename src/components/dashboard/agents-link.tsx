"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";

// The header's link to the AI agents page, on every dashboard page beside Learn, so connecting an agent never depends
// on finding it in the account menu. connected false: nothing acts for the person yet, and a small Connect tag says
// what the page is for; null: not known (the check failed), so just the link.
export function AgentsLink({ connected }: { connected: boolean | null }): ReactNode {
  const pathname = usePathname() ?? "";
  const here = pathname === "/agents";
  return (
    <Link
      href="/agents"
      aria-current={here ? "page" : undefined}
      className={cx(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap hover:bg-ed-hover hover:text-ed-text",
        here ? "text-ed-text" : "text-ed-muted",
        FOCUS_RING,
        FADE,
      )}
    >
      AI agents
      {connected === false && (
        <>
          <span aria-hidden className="hidden rounded-[4px] border border-ed-line-strong px-1 text-[11px] leading-4 text-ed-text sm:inline">
            Connect
          </span>
          <span className="sr-only">(none connected yet)</span>
        </>
      )}
    </Link>
  );
}
