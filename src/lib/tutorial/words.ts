// The words of the Learn page, its menu and the welcome dialog.
export const TUTORIAL_WORDS = {
  learn: "Learn",
  learnIntro: "Short lessons on video. Start with the basics, or go straight to what you need.",
  lessons: "Lessons",
  search: "Search the guide",
  searchResults: "Search results",
  noResults: (query: string) => `No lesson mentions “${query}”. Try another word, such as captions or export.`,
  watched: "Watched",
  lessonOf: (number: number, of: number) => `Lesson ${number} of ${of}`,
  voiceBy: "Voice by", // followed by the credit the recording names, such as elevenlabs.io
  chapters: "Chapters",
  transcript: "Transcript",
  transcriptHint: "Click a line to play from there.",
  previous: "Previous",
  next: "Next",
  nextLesson: (title: string) => `Next: ${title}`,
  lastLesson: "That's the last lesson.",
  backToProjects: "Projects",
  // Not "Welcome to EasyEdit": a new account has just been welcomed by that page.
  title: "Take the short tour",
  intro: "The short tour: a new project, adding and cutting clips, a title, finding any tool, and export. About two minutes.",
  video: (title: string) => `${title}: lesson video`,
  watch: "Watch",
  skip: "Skip for now",
  done: "Done",
  allLessons: "All lessons",
  failed: "The video couldn't load. Check your connection and try again from Learn, at the top of the page.",
} as const;
