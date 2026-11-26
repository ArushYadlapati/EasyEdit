import type { Lesson } from "@/lib/tutorial/lesson";

// A small guide for tests: three lessons in two sections. The guide that ships is rewritten with every recording,
// so tests that are not about its own shape read this one.
export const GUIDE: readonly Lesson[] = [
  {
    slug: "basics",
    section: "Start here",
    title: "The basics",
    summary: "From a new project to a finished video.",
    seconds: 60,
    chapters: [
      { title: "Welcome", start: 0 },
      { title: "A new project", start: 10 },
      { title: "Export", start: 40 },
    ],
    captions: [
      { start: 1, end: 4, text: "Welcome to EasyEdit." },
      { start: 11, end: 15, text: "To start a video, click New project." },
      { start: 41, end: 45, text: "When you're done, click Export." },
      { start: 46, end: 50, text: "Nothing is uploaded." },
    ],
  },
  {
    slug: "text",
    section: "Editing",
    title: "Text and captions",
    summary: "Titles, and captions written for you.",
    seconds: 40,
    chapters: [
      { title: "Text", start: 0 },
      { title: "Captions", start: 20 },
    ],
    captions: [
      { start: 2, end: 6, text: "Add a title from the Text tab." },
      { start: 21, end: 26, text: "Click Auto captions." },
    ],
  },
  {
    slug: "sound",
    section: "Editing",
    title: "Sound",
    summary: "Levels and fades.",
    seconds: 30,
    chapters: [{ title: "Levels", start: 0 }],
    captions: [{ start: 2, end: 7, text: "Fade a clip in and out." }],
  },
];
