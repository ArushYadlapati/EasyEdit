"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { TextInput } from "@/components/ui/text-input";
import { searchGuide, type GuideLine, type MenuSection } from "@/lib/tutorial/guide";
import { clock } from "@/lib/tutorial/timing";
import { noLessonsWatched, subscribeWatched, watchedLessons } from "@/lib/tutorial/watched";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";

const HEADING = "px-2 pb-1 text-[11px] font-semibold tracking-wide text-ed-muted uppercase";
const ROW = "flex min-h-7 items-center gap-2 rounded-md px-2 py-1 text-xs font-medium";

// The Learn page's menu: a search of everything said in the guide, then the lessons under their sections, the one
// being shown marked and the ones this browser has watched ticked. While something is searched for, the lines that
// answer it take the list's place, each a link to its moment. A column at the left on a wide window, in the
// dashboard sidebar's look; on a narrow one it comes after the lesson, across the page.
export function LearnMenu({ sections, lines, current }: { sections: readonly MenuSection[]; lines: readonly GuideLine[]; current: string }): ReactNode {
  const [query, setQuery] = useState("");
  const watched = useSyncExternalStore(subscribeWatched, watchedLessons, noLessonsWatched);
  const found = useMemo(() => searchGuide(lines, query), [lines, query]);
  const searching = query.trim() !== "";
  const resultsId = useId();

  return (
    <nav
      aria-label={TUTORIAL_WORDS.lessons}
      className="flex shrink-0 flex-col gap-3 border-t border-ed-line px-4 py-4 md:w-60 md:overflow-y-auto md:border-t-0 md:border-r md:bg-ed-panel md:px-2 md:py-3"
    >
      <TextInput
        type="search"
        aria-label={TUTORIAL_WORDS.search}
        aria-controls={resultsId}
        placeholder={TUTORIAL_WORDS.search}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div id={resultsId} className="flex flex-col gap-4">
        {searching ? (
          <section aria-label={TUTORIAL_WORDS.searchResults} className="flex flex-col">
            <p role="status" className={found.length ? "sr-only" : "px-2 text-xs leading-5 text-ed-muted"}>
              {found.length ? `${found.length} ${found.length === 1 ? "line" : "lines"}` : TUTORIAL_WORDS.noResults(query.trim())}
            </p>
            {found.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {found.map((line) => (
                  <li key={`${line.slug}-${line.start}`}>
                    <Link href={line.path} className={cx("flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-ed-hover", FOCUS_RING_INSET, FADE)}>
                      <span className="text-xs leading-4 text-ed-text">{line.text}</span>
                      <span className="text-[11px] leading-4 text-ed-muted tabular-nums">
                        {line.lesson} · {clock(line.start)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          sections.map((group) => (
            <section key={group.section} className="flex flex-col">
              <h2 className={HEADING}>{group.section}</h2>
              <ul className="flex flex-col gap-0.5">
                {group.lessons.map((lesson) => {
                  const here = lesson.slug === current;
                  return (
                    <li key={lesson.slug}>
                      <Link
                        href={lesson.path}
                        aria-current={here ? "page" : undefined}
                        className={cx(ROW, here ? "bg-ed-accent-weak text-ed-accent" : "text-ed-text hover:bg-ed-hover", FOCUS_RING_INSET, FADE)}
                      >
                        <span className="min-w-0 flex-1">{lesson.title}</span>
                        {watched.includes(lesson.slug) && <Check role="img" aria-label={TUTORIAL_WORDS.watched} className={cx("size-3.5 shrink-0", here ? "text-ed-accent" : "text-ed-muted")} />}
                        <span className={cx("shrink-0 tabular-nums", here ? "text-ed-accent" : "text-ed-muted")}>{clock(lesson.seconds)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}
