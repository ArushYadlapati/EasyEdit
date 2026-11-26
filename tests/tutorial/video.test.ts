import { describe, expect, it } from "vitest";
import { lessonVideo, tutorialVideo } from "@/lib/tutorial/video";

const env = (value: string | undefined) => ({ TUTORIAL_VIDEO_URL: value }) as unknown as NodeJS.ProcessEnv;

describe("tutorialVideo", () => {
  it("is off unless the address is a secure link to an mp4", () => {
    for (const value of [undefined, "", " ", "not a url", "http://x.test/a.mp4", "https://x.test/a.mov", "https://x.test/", "ftp://x.test/a.mp4", "/tutorial.mp4"]) {
      expect(tutorialVideo(env(value))).toBeNull();
    }
  });

  it("gives the video and the poster beside it", () => {
    expect(tutorialVideo(env(" https://cdn.test/v/easyedit-intro.mp4 "))).toEqual({
      url: "https://cdn.test/v/easyedit-intro.mp4",
      poster: "https://cdn.test/v/easyedit-intro.jpg",
    });
  });

  it("keeps a query string on both, and reads the ending whatever its case", () => {
    expect(tutorialVideo(env("https://cdn.test/Intro.MP4?v=3"))).toEqual({ url: "https://cdn.test/Intro.MP4?v=3", poster: "https://cdn.test/Intro.jpg?v=3" });
  });

  it("takes plain http only from this computer, for trying it out", () => {
    expect(tutorialVideo(env("http://localhost:3999/easyedit-intro.mp4"))).toEqual({
      url: "http://localhost:3999/easyedit-intro.mp4",
      poster: "http://localhost:3999/easyedit-intro.jpg",
    });
    expect(tutorialVideo(env("http://127.0.0.1:3999/a.mp4"))?.url).toBe("http://127.0.0.1:3999/a.mp4");
    expect(tutorialVideo(env("http://localhost.evil.test/a.mp4"))).toBeNull();
  });
});

describe("lessonVideo", () => {
  const first = { url: "https://cdn.test/guide/2026-11-26/basics.mp4?v=3", poster: "https://cdn.test/guide/2026-11-26/basics.jpg?v=3" };

  it("gives the first lesson the video the setting names", () => {
    expect(lessonVideo(first, "basics", true)).toBe(first);
  });

  it("finds any other lesson's video and poster beside it, named by the lesson, keeping the query string", () => {
    expect(lessonVideo(first, "sound", false)).toEqual({
      url: "https://cdn.test/guide/2026-11-26/sound.mp4?v=3",
      poster: "https://cdn.test/guide/2026-11-26/sound.jpg?v=3",
    });
  });

  it("does not care what the first lesson's file is called", () => {
    const intro = tutorialVideo({ TUTORIAL_VIDEO_URL: "http://localhost:3341/easyedit-intro.mp4" } as unknown as NodeJS.ProcessEnv)!;
    expect(lessonVideo(intro, "text", false)).toEqual({ url: "http://localhost:3341/text.mp4", poster: "http://localhost:3341/text.jpg" });
  });
});

