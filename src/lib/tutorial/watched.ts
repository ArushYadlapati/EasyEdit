// Which lessons this browser has watched to the end, for the tick beside them in the Learn page's menu. Kept in the
// browser only: it is a convenience, and a new browser simply starts with none ticked.
const KEY = "easyedit.learn.watched";
const CHANGED = "easyedit:learn-watched";
const NONE: readonly string[] = [];
const SLUG = /^[a-z0-9-]{1,40}$/;

// The list as stored, read again only when the stored text changes, so a reader is handed the same list twice.
let cache: { raw: string | null; list: readonly string[] } = { raw: null, list: NONE };
// Marks this page made that the browser would not store (storage blocked): they show until the page goes.
let unsaved: readonly string[] = NONE;

export function parseWatched(raw: string | null): readonly string[] {
  if (!raw) return NONE;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return NONE;
    const slugs = value.filter((entry): entry is string => typeof entry === "string" && SLUG.test(entry)).slice(0, 100);
    return slugs.length ? [...new Set(slugs)] : NONE;
  } catch {
    return NONE;
  }
}

export function watchedLessons(): readonly string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Storage is blocked here.
  }
  if (raw !== cache.raw) cache = { raw, list: parseWatched(raw) };
  return unsaved.length ? unsaved : cache.list;
}

// What the server draws: nothing ticked.
export const noLessonsWatched = (): readonly string[] => NONE;

export function markLessonWatched(slug: string): void {
  const now = watchedLessons();
  if (!SLUG.test(slug) || now.includes(slug)) return;
  const next = [...now, slug];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    unsaved = NONE;
  } catch {
    unsaved = next;
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function subscribeWatched(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange); // another tab watched one
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}
