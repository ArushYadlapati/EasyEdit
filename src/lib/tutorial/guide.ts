import type { Lesson } from "./lesson";
import { GUIDE_LESSONS } from "./script";
import { tutorialVideo, type TutorialVideo } from "./video";

// The guide: the lessons in the order they are taught, and finding one's way round them. Server code reads the
// lessons from here; what a page's client parts need of them is handed over as props, so no browser downloads the
// whole guide to show one lesson.

// The guide is offered when the server has the videos' address and there is at least one lesson to show. Null,
// and there is no Learn page, no Learn link and no welcome.
export function guideVideo(env: NodeJS.ProcessEnv = process.env, lessons: readonly Lesson[] = GUIDE_LESSONS): TutorialVideo | null {
  return lessons.length > 0 ? tutorialVideo(env) : null;
}

// The lesson the welcome shows and the Learn page opens on.
export function firstLesson(lessons: readonly Lesson[] = GUIDE_LESSONS): Lesson | undefined {
  return lessons[0];
}

export function findLesson(slug: string, lessons: readonly Lesson[] = GUIDE_LESSONS): Lesson | undefined {
  return lessons.find((lesson) => lesson.slug === slug);
}

// Where a lesson sits: its number from 1, and the ones either side of it.
export function placeOf(slug: string, lessons: readonly Lesson[] = GUIDE_LESSONS): { number: number; of: number; previous: Lesson | null; next: Lesson | null } | null {
  const at = lessons.findIndex((lesson) => lesson.slug === slug);
  if (at < 0) return null;
  return { number: at + 1, of: lessons.length, previous: lessons[at - 1] ?? null, next: lessons[at + 1] ?? null };
}

// A lesson's page: the first lesson is the Learn page itself.
export function lessonPath(slug: string, lessons: readonly Lesson[] = GUIDE_LESSONS): string {
  return lessons[0]?.slug === slug ? "/learn" : `/learn/${slug}`;
}

// A moment of a lesson, as a link: whole seconds in ?t=, left out at the very start.
export function momentPath(slug: string, seconds: number, lessons: readonly Lesson[] = GUIDE_LESSONS): string {
  const whole = Math.max(0, Math.floor(seconds));
  return whole > 0 ? `${lessonPath(slug, lessons)}?t=${whole}` : lessonPath(slug, lessons);
}

// ?t= as the player takes it: a whole number of seconds inside the lesson, or the start.
export function startFrom(value: string | string[] | undefined, lesson: Lesson): number {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text || !/^\d{1,5}$/.test(text)) return 0;
  const seconds = Number(text);
  return seconds < lesson.seconds ? seconds : 0;
}

// What the Learn page's menu lists: the lessons under their sections, in the guide's order, with no more of each
// than a row shows.
export type MenuLesson = { slug: string; title: string; seconds: number; path: string };
export type MenuSection = { section: string; lessons: MenuLesson[] };

export function menuSections(lessons: readonly Lesson[] = GUIDE_LESSONS): MenuSection[] {
  const sections: MenuSection[] = [];
  for (const lesson of lessons) {
    const row = { slug: lesson.slug, title: lesson.title, seconds: lesson.seconds, path: lessonPath(lesson.slug, lessons) };
    const last = sections.at(-1);
    if (last && last.section === lesson.section) last.lessons.push(row);
    else sections.push({ section: lesson.section, lessons: [row] });
  }
  return sections;
}

// What the menu's search looks through: every line said in the guide, with where it is said.
export type GuideLine = { slug: string; lesson: string; chapter: string; start: number; text: string; path: string };

export function guideLines(lessons: readonly Lesson[] = GUIDE_LESSONS): GuideLine[] {
  return lessons.flatMap((lesson) =>
    lesson.captions.map((caption) => {
      const chapter = [...lesson.chapters].reverse().find((c) => c.start <= caption.start) ?? lesson.chapters[0];
      return { slug: lesson.slug, lesson: lesson.title, chapter: chapter?.title ?? "", start: caption.start, text: caption.text, path: momentPath(lesson.slug, caption.start, lessons) };
    }),
  );
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

// The lines that answer a search: every word asked for begins a word of the line, its chapter's name or its lesson's
// name ("cap" finds captions; "sound fade" finds the line about fading sound in the Sound lesson). Lines whose own
// words match come first, then the guide's order. Nothing for a search with no letters or digits in it.
export function searchGuide(lines: readonly GuideLine[], query: string, limit = 8): GuideLine[] {
  const asked = words(query);
  if (asked.length === 0) return [];
  const scored: { line: GuideLine; own: number; at: number }[] = [];
  lines.forEach((line, at) => {
    const own = words(line.text);
    const around = [...words(line.chapter), ...words(line.lesson)];
    let inLine = 0;
    for (const word of asked) {
      if (own.some((w) => w.startsWith(word))) inLine++;
      else if (!around.some((w) => w.startsWith(word))) return;
    }
    scored.push({ line, own: inLine, at });
  });
  return scored
    .sort((a, b) => b.own - a.own || a.at - b.at)
    .slice(0, limit)
    .map((entry) => entry.line);
}

// What the editor is handed of the guide, for its Help menu and its search: each lesson's name, page and chapter
// names. None on a server without the guide.
export function editorGuide(env: NodeJS.ProcessEnv = process.env, lessons: readonly Lesson[] = GUIDE_LESSONS): { title: string; path: string; chapters: string[] }[] {
  if (!guideVideo(env, lessons)) return [];
  return lessons.map((lesson) => ({ title: lesson.title, path: lessonPath(lesson.slug, lessons), chapters: lesson.chapters.map((chapter) => chapter.title) }));
}

