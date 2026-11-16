import { describe, expect, it } from "vitest";
import { TUTORIAL_CAPTIONS, TUTORIAL_CHAPTERS, TUTORIAL_SECONDS } from "@/lib/tutorial/script";
import { captionAt, chapterAt, clock } from "@/lib/tutorial/timing";

describe("the tutorial's timings", () => {
  const chapters = [
    { title: "A", start: 0 },
    { title: "B", start: 10 },
    { title: "C", start: 25.5 },
  ];

  it("chapterAt gives the chapter playing at a time, the first one before anything starts", () => {
    expect([-1, 0, 9.99, 10, 25.49, 25.5, 999].map((t) => chapterAt(t, chapters))).toEqual([0, 0, 0, 1, 1, 2, 2]);
    expect(chapterAt(5, [])).toBe(0);
  });

  it("captionAt gives the words on screen at a time, or nothing between lines", () => {
    const captions = [
      { start: 1, end: 3, text: "one" },
      { start: 3.5, end: 5, text: "two" },
    ];
    expect([0, 1, 2.99, 3, 3.5, 4.9, 5, 60].map((t) => captionAt(t, captions))).toEqual([null, "one", "one", null, "two", "two", null, null]);
  });

  it("clock writes seconds as minutes and seconds", () => {
    expect([0, 7.4, 59.6, 60, 161, -3].map(clock)).toEqual(["0:00", "0:07", "0:59", "1:00", "2:41", "0:00"]);
  });

  it("the script that ships is well formed", () => {
    expect(TUTORIAL_CHAPTERS).toHaveLength(10);
    expect(TUTORIAL_CHAPTERS[0].start).toBe(0);
    expect(TUTORIAL_CHAPTERS.every((c, i, all) => c.title.trim() !== "" && (i === 0 || c.start > all[i - 1].start))).toBe(true);
    expect(TUTORIAL_CAPTIONS.length).toBeGreaterThan(10);
    expect(TUTORIAL_CAPTIONS.every((c, i, all) => c.text.trim() !== "" && c.end > c.start && (i === 0 || c.start >= all[i - 1].end))).toBe(true);
    expect(TUTORIAL_CAPTIONS.at(-1)!.end).toBeLessThanOrEqual(TUTORIAL_SECONDS);
    expect(TUTORIAL_CHAPTERS.at(-1)!.start).toBeLessThan(TUTORIAL_SECONDS);
  });
});
