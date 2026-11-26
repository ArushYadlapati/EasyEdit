"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { LessonPlayer, type LessonPlayerHandle } from "@/components/dashboard/lesson-player";
import { linkButtonClass } from "@/components/ui/button-class";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import type { Lesson } from "@/lib/tutorial/lesson";
import { captionIndexAt, chapterEnd, clock } from "@/lib/tutorial/timing";
import type { TutorialVideo } from "@/lib/tutorial/video";
import { markLessonWatched } from "@/lib/tutorial/watched";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

// A lesson counts as watched once it has played into its last few seconds: the closing card teaches nothing.
const WATCHED_BEFORE_END = 5;

export type LearnLessonProps = {
  lesson: Lesson;
  video: TutorialVideo;
  startAt?: number; // seconds, from a link to a moment of the lesson
  next?: { title: string; path: string } | null; // the lesson after this one; null for the last
  markSeen?: () => Promise<unknown>; // for someone the welcome has not been shown to yet
};

// A lesson on the Learn page: its player, then everything said in it as a transcript, a line at a time under its
// chapter, where a click plays from that line and the line being said is marked; then the way to the next lesson.
// Someone who has not yet been welcomed with the first lesson and plays one here has found the guide: markSeen is
// handed over for them only, and writes the mark at the first play. A mark that cannot be written is let go; the
// welcome simply comes as it would have.
export function LearnLesson({ lesson, video, startAt = 0, next, markSeen }: LearnLessonProps): ReactNode {
  const player = useRef<LessonPlayerHandle>(null);
  const headingId = useId();
  const [line, setLine] = useState(() => captionIndexAt(startAt, lesson.captions));

  // The lines under the chapter they are said in.
  const groups = useMemo(
    () =>
      lesson.chapters
        .map((chapter, index) => {
          const end = chapterEnd(index, lesson.chapters, Infinity);
          return { title: chapter.title, lines: lesson.captions.map((caption, at) => ({ ...caption, at })).filter((c) => c.start >= chapter.start && c.start < end) };
        })
        .filter((group) => group.lines.length > 0),
    [lesson],
  );

  function onTime(seconds: number) {
    setLine(captionIndexAt(seconds, lesson.captions));
    if (seconds >= lesson.seconds - WATCHED_BEFORE_END) markLessonWatched(lesson.slug);
  }

  return (
    <div className="flex flex-col gap-6">
      <LessonPlayer ref={player} lesson={lesson} video={video} startAt={startAt} onTime={onTime} onStarted={markSeen ? () => void markSeen().catch(() => {}) : undefined} />

      <section aria-labelledby={headingId} className="flex max-w-2xl flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id={headingId} className="text-sm font-semibold">
            {TUTORIAL_WORDS.transcript}
          </h2>
          <p className="text-xs leading-5 text-ed-muted">{TUTORIAL_WORDS.transcriptHint}</p>
        </div>
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <h3 className="px-2 pt-1 text-xs font-semibold text-ed-muted">{group.title}</h3>
            <ol className="flex flex-col">
              {group.lines.map((entry) => (
                <li key={entry.at}>
                  <button
                    type="button"
                    aria-current={entry.at === line ? "true" : undefined}
                    className={cx(
                      "flex w-full items-baseline gap-3 rounded-md px-2 py-1 text-left text-[13px] leading-5 text-ed-text",
                      entry.at === line ? "bg-ed-accent-weak" : "hover:bg-ed-hover",
                      FOCUS_RING_INSET,
                      FADE,
                    )}
                    onClick={() => player.current?.play(entry.start)}
                  >
                    <span className={cx("w-8 shrink-0 font-mono text-xs tabular-nums", entry.at === line ? "text-ed-accent" : "text-ed-muted")}>{clock(entry.start)}</span>
                    <span className="min-w-0">{entry.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      <div className="flex items-center border-t border-ed-line pt-4">
        {next ? (
          <Link href={next.path} className={linkButtonClass("default")}>
            {TUTORIAL_WORDS.nextLesson(next.title)}
            <ChevronRight aria-hidden />
          </Link>
        ) : (
          <p className="text-xs leading-5 text-ed-muted">{TUTORIAL_WORDS.lastLesson}</p>
        )}
      </div>
    </div>
  );
}
