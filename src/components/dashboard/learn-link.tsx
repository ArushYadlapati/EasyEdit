"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

// The header's link to the Learn page, on every dashboard page, so the guide can be found without knowing it is in
// the account menu. The layout shows it only when the server has the videos.
export function LearnLink(): ReactNode {
  const pathname = usePathname() ?? "";
  const onLearn = pathname === "/learn" || pathname.startsWith("/learn/");
  return (
    <Link
      href="/learn"
      aria-current={onLearn ? "page" : undefined}
      className={cx("rounded-md px-2 py-1 text-xs font-medium hover:bg-ed-hover hover:text-ed-text", onLearn ? "text-ed-text" : "text-ed-muted", FOCUS_RING, FADE)}
    >
      {TUTORIAL_WORDS.learn}
    </Link>
  );
}
