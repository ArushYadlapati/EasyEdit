import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { markTutorialSeenAction } from "@/app/(dashboard)/tutorial/actions";
import { LearnTutorial } from "@/components/dashboard/learn-tutorial";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { TUTORIAL_SECONDS } from "@/lib/tutorial/script";
import { hasSeenTutorial } from "@/lib/tutorial/seen";
import { clock } from "@/lib/tutorial/timing";
import { tutorialVideo } from "@/lib/tutorial/video";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

export const metadata: Metadata = { title: TUTORIAL_WORDS.learn };

// The tutorial on a page of its own, for watching it again at full size: the header's Learn link and the account
// menu's Tutorial lead here. There is no such page on a server without the video. Someone who plays it here before
// they were welcomed with it has seen it, so the mark is written for them (LearnTutorial).
export default async function LearnPage(): Promise<ReactNode> {
  // The page checks for itself: a layout is not run again on a client navigation.
  const me = await requireUser();
  const video = tutorialVideo();
  if (!video) notFound();
  // If the marks cannot be read, nothing is written from here; the welcome comes as it would have.
  const seen = await hasSeenTutorial(getDb(), me.id).catch(() => true);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col items-start gap-2">
          <Link
            href="/dashboard"
            className={cx(
              "-ml-2 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ed-muted hover:bg-ed-hover hover:text-ed-text",
              FOCUS_RING,
              FADE,
            )}
          >
            <ChevronLeft aria-hidden size={14} />
            Projects
          </Link>
          <h1 className="text-base font-semibold">{TUTORIAL_WORDS.learn}</h1>
          <p className="text-[13px] leading-5 text-ed-muted">{TUTORIAL_WORDS.learnIntro}</p>
        </header>
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">{TUTORIAL_WORDS.basics}</h2>
            <span className="text-xs text-ed-muted tabular-nums">{clock(TUTORIAL_SECONDS)}</span>
          </div>
          <LearnTutorial video={video} markSeen={seen ? undefined : markTutorialSeenAction} />
        </section>
      </div>
    </main>
  );
}
