import { TUTORIAL_CAPTIONS, TUTORIAL_CHAPTERS } from "./script";

export type TutorialChapter = { title: string; start: number };
export type TutorialCaption = { start: number; end: number; text: string };

// Which chapter is playing at a time in the video: the last one that has started, the first before any has.
export function chapterAt(seconds: number, chapters: readonly TutorialChapter[] = TUTORIAL_CHAPTERS): number {
  let at = 0;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= seconds) at = i;
  return at;
}

// The line being said at a time, or null between lines.
export function captionAt(seconds: number, captions: readonly TutorialCaption[] = TUTORIAL_CAPTIONS): string | null {
  return captions.find((c) => c.start <= seconds && seconds < c.end)?.text ?? null;
}

// Seconds as "2:41", for the chapter list.
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
