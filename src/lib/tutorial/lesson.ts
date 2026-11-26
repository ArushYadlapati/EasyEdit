// One lesson of the guide: a short video with named chapters and its narration as captions. The lessons themselves
// are in script.ts, which the recording script writes together with the video files.
export type LessonChapter = { title: string; start: number }; // seconds into the lesson's video
export type LessonCaption = { start: number; end: number; text: string };

export type Lesson = {
  slug: string; // its address on the Learn page (/learn/<slug>) and its video's file name
  section: string; // the group it is listed under: "Start here", "Editing", …
  title: string;
  summary: string; // one line saying what is in it
  seconds: number;
  chapters: readonly LessonChapter[];
  captions: readonly LessonCaption[];
};
