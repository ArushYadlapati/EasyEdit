import { describe, expect, it } from "vitest";
import { editorGuide, findLesson, firstLesson, guideLines, guideVideo, lessonPath, menuSections, momentPath, placeOf, searchGuide, startFrom } from "@/lib/tutorial/guide";
import { GUIDE } from "../helpers/guide";

const env = (value: string | undefined) => ({ TUTORIAL_VIDEO_URL: value }) as unknown as NodeJS.ProcessEnv;

describe("the guide", () => {
  it("is offered when the server has the videos' address and there is a lesson to show", () => {
    expect(guideVideo(env("https://cdn.test/g/basics.mp4"), GUIDE)).toEqual({ url: "https://cdn.test/g/basics.mp4", poster: "https://cdn.test/g/basics.jpg" });
    expect(guideVideo(env(undefined), GUIDE)).toBeNull();
    expect(guideVideo(env("https://cdn.test/g/basics.mp4"), [])).toBeNull();
  });

  it("finds a lesson by its address, and the first one", () => {
    expect(firstLesson(GUIDE)?.slug).toBe("basics");
    expect(firstLesson([])).toBeUndefined();
    expect(findLesson("sound", GUIDE)?.title).toBe("Sound");
    expect(findLesson("nope", GUIDE)).toBeUndefined();
  });

  it("knows where a lesson sits and what is either side of it", () => {
    expect(placeOf("basics", GUIDE)).toMatchObject({ number: 1, of: 3, previous: null, next: { slug: "text" } });
    expect(placeOf("text", GUIDE)).toMatchObject({ number: 2, of: 3, previous: { slug: "basics" }, next: { slug: "sound" } });
    expect(placeOf("sound", GUIDE)).toMatchObject({ number: 3, of: 3, next: null });
    expect(placeOf("nope", GUIDE)).toBeNull();
  });

  it("gives the first lesson the Learn page's own address, and the others one under it", () => {
    expect(lessonPath("basics", GUIDE)).toBe("/learn");
    expect(lessonPath("text", GUIDE)).toBe("/learn/text");
  });

  it("links to a moment in whole seconds, and to the lesson itself at its start", () => {
    expect(momentPath("text", 21.6, GUIDE)).toBe("/learn/text?t=21");
    expect(momentPath("basics", 41, GUIDE)).toBe("/learn?t=41");
    expect(momentPath("text", 0.4, GUIDE)).toBe("/learn/text");
  });

  it("reads a moment from a link only when it is a whole number of seconds inside the lesson", () => {
    const text = GUIDE[1];
    expect(startFrom("21", text)).toBe(21);
    expect(startFrom(["21", "30"], text)).toBe(21);
    for (const value of [undefined, "", "abc", "-4", "2.5", "40", "999", "1e3"]) expect(startFrom(value, text)).toBe(0);
  });

  it("lists the lessons under their sections, in the guide's order", () => {
    expect(menuSections(GUIDE)).toEqual([
      { section: "Start here", lessons: [{ slug: "basics", title: "The basics", seconds: 60, path: "/learn" }] },
      {
        section: "Editing",
        lessons: [
          { slug: "text", title: "Text and captions", seconds: 40, path: "/learn/text" },
          { slug: "sound", title: "Sound", seconds: 30, path: "/learn/sound" },
        ],
      },
    ]);
    expect(menuSections([])).toEqual([]);
  });

  it("knows every line said, with its lesson, its chapter and a link to its moment", () => {
    const lines = guideLines(GUIDE);
    expect(lines).toHaveLength(7);
    expect(lines[2]).toEqual({ slug: "basics", lesson: "The basics", chapter: "Export", start: 41, text: "When you're done, click Export.", path: "/learn?t=41" });
    expect(lines[5]).toMatchObject({ slug: "text", chapter: "Captions", path: "/learn/text?t=21" });
  });
});

describe("the guide as the editor is handed it", () => {
  it("names each lesson, its page and its chapters, for the Help menu and the search", () => {
    expect(editorGuide(env("https://cdn.test/g/basics.mp4"), GUIDE)).toEqual([
      { title: "The basics", path: "/learn", chapters: ["Welcome", "A new project", "Export"] },
      { title: "Text and captions", path: "/learn/text", chapters: ["Text", "Captions"] },
      { title: "Sound", path: "/learn/sound", chapters: ["Levels"] },
    ]);
  });

  it("is empty on a server without the guide, so the editor shows no Help", () => {
    expect(editorGuide(env(undefined), GUIDE)).toEqual([]);
    expect(editorGuide(env("https://cdn.test/g/basics.mp4"), [])).toEqual([]);
  });
});

describe("searching the guide", () => {
  const lines = guideLines(GUIDE);
  const found = (query: string) => searchGuide(lines, query).map((line) => line.text);

  it("finds the lines that say a word, by how the word begins", () => {
    expect(found("upload")).toEqual(["Nothing is uploaded."]);
    expect(found("EXPORT")).toEqual(["When you're done, click Export.", "Nothing is uploaded."]);
  });

  it("wants every word asked for, in the line or in the names of its chapter and lesson", () => {
    expect(found("fade sound")).toEqual(["Fade a clip in and out."]);
    expect(found("title captions")).toEqual(["Add a title from the Text tab."]);
    expect(found("fade export")).toEqual([]);
  });

  it("puts lines that say the words themselves before lines that are only in a chapter or lesson named so", () => {
    // "Click Auto captions." says it; "Add a title…" is only in the lesson "Text and captions".
    expect(found("captions")).toEqual(["Click Auto captions.", "Add a title from the Text tab."]);
  });

  it("gives nothing for a search with no letters or digits, and no more than the limit", () => {
    expect(found("")).toEqual([]);
    expect(found(" ?! ")).toEqual([]);
    expect(searchGuide(lines, "a", 2)).toHaveLength(2);
  });
});
