import type { LessonCaption, LessonChapter } from "./lesson";

// Which chapter is playing at a time in a lesson's video: the last one that has started, the first before any has.
export function chapterAt(seconds: number, chapters: readonly LessonChapter[]): number {
  let at = 0;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= seconds) at = i;
  return at;
}

// The line being said at a time, as its place in the lesson's captions, or -1 between lines.
export function captionIndexAt(seconds: number, captions: readonly LessonCaption[]): number {
  return captions.findIndex((c) => c.start <= seconds && seconds < c.end);
}

// The line being said at a time, or null between lines.
export function captionAt(seconds: number, captions: readonly LessonCaption[]): string | null {
  return captions[captionIndexAt(seconds, captions)]?.text ?? null;
}

// Where a chapter ends: where the next one starts, or the end of the video.
export function chapterEnd(index: number, chapters: readonly LessonChapter[], seconds: number): number {
  return chapters[index + 1]?.start ?? seconds;
}

// Seconds as "2:41", for chapter lists and lesson lengths.
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
