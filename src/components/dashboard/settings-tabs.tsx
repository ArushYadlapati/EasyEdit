"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { settingsTabPath, type SettingsTab } from "@/lib/spaces/settings-tabs";

// The row of settings tabs the viewer may open (settingsTabsFor), links that mark the page shown. It scrolls sideways
// on its own on a narrow window.
export function SettingsTabs({ slug, tabs }: { slug: string; tabs: readonly SettingsTab[] }): ReactNode {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto border-b border-ed-line">
      {tabs.map((tab) => {
        const href = settingsTabPath(slug, tab.id);
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.id}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cx(
              "-mb-px shrink-0 border-b-2 px-2 py-1.5 text-xs font-medium whitespace-nowrap",
              current ? "border-ed-accent text-ed-text" : "border-transparent text-ed-muted hover:text-ed-text",
              FOCUS_RING_INSET,
              FADE,
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
