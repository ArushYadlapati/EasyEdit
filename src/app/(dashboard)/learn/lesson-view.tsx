import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { markTutorialSeenAction } from "@/app/(dashboard)/tutorial/actions";
import { LearnLesson } from "@/components/dashboard/learn-lesson";
import { LearnMenu } from "@/components/dashboard/learn-menu";
import { LessonMeta } from "@/components/dashboard/lesson-meta";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { findLesson, guideLines, guideVideo, lessonPath, menuSections, placeOf, startFrom } from "@/lib/tutorial/guide";
import { GUIDE_VOICE_CREDIT } from "@/lib/tutorial/script";
import { hasSeenTutorial } from "@/lib/tutorial/seen";
import { lessonVideo } from "@/lib/tutorial/video";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

// The Learn page with one lesson showing: the guide's menu beside it (after it on a narrow window), the lesson's
// name and what is in it, then its player and transcript. /learn shows the first lesson and /learn/<slug> any
// other; `t` is the moment a link asked for. There is no such page on a server without the videos, and none for a
// lesson the guide does not have. Someone who plays a lesson here before they were welcomed has found the guide,
// so the mark is written for them (LearnLesson).
export async function LessonView({ slug, t }: { slug: string; t?: string | string[] }): Promise<ReactNode> {
  // The page checks for itself: a layout is not run again on a client navigation.
  const me = await requireUser();
  const video = guideVideo();
  const lesson = findLesson(slug);
  const place = placeOf(slug);
  if (!video || !lesson || !place) notFound();
  // If the marks cannot be read, nothing is written from here; the welcome comes as it would have.
  const seen = await hasSeenTutorial(getDb(), me.id).catch(() => true);
  const startAt = startFrom(t, lesson);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <main className="min-w-0 flex-1 md:order-2 md:overflow-y-auto">
        {/* One column, in the middle of the room beside the menu. On a short window it is narrower, so that the
            picture (which is as wide as the column) leaves its chapters in view under it. */}
        <div className="mx-auto flex w-full flex-col gap-5 px-4 py-6 md:px-8" style={{ maxWidth: "min(64rem, max(32rem, calc((100dvh - 16rem) * 16 / 9 + 4rem)))" }}>
          <header className="flex flex-col items-start">
            <Link
              href="/dashboard"
              className={cx("-ml-2 mb-2 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ed-muted hover:bg-ed-hover hover:text-ed-text", FOCUS_RING, FADE)}
            >
              <ChevronLeft aria-hidden size={14} />
              {TUTORIAL_WORDS.backToProjects}
            </Link>
            {/* The lesson's name with its length and place beside it, under the name where there is no room. */}
            <div className="flex w-full flex-wrap items-baseline justify-between gap-x-4">
              <h1 className="text-base font-semibold">{lesson.title}</h1>
              <LessonMeta seconds={lesson.seconds} place={place} credit={GUIDE_VOICE_CREDIT} />
            </div>
            <p className="max-w-2xl text-[13px] leading-5 text-ed-muted">{lesson.summary}</p>
          </header>
          {/* A new lesson gets a new player: its video, captions and place all start afresh. So does a link to
              another moment of the lesson showing (a line found by the search), which stands the player there. */}
          <LearnLesson
            key={`${lesson.slug}@${startAt}`}
            lesson={lesson}
            video={lessonVideo(video, lesson.slug, place.number === 1)}
            startAt={startAt}
            next={place.next ? { title: place.next.title, path: lessonPath(place.next.slug) } : null}
            markSeen={seen ? undefined : markTutorialSeenAction}
          />
        </div>
      </main>
      <LearnMenu sections={menuSections()} lines={guideLines()} current={lesson.slug} />
    </div>
  );
}
