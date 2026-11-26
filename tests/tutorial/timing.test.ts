import { describe, expect, it } from "vitest";
import { captionAt, captionIndexAt, chapterAt, chapterEnd, clock } from "@/lib/tutorial/timing";

describe("a lesson's timings", () => {
  const chapters = [
    { title: "A", start: 0 },
    { title: "B", start: 10 },
    { title: "C", start: 25.5 },
  ];
  const captions = [
    { start: 1, end: 3, text: "one" },
    { start: 3.5, end: 5, text: "two" },
  ];

  it("chapterAt gives the chapter playing at a time, the first one before anything starts", () => {
    expect([-1, 0, 9.99, 10, 25.49, 25.5, 999].map((t) => chapterAt(t, chapters))).toEqual([0, 0, 0, 1, 1, 2, 2]);
    expect(chapterAt(5, [])).toBe(0);
  });

  it("chapterEnd is where the next chapter starts, and the end of the video for the last", () => {
    expect([0, 1, 2].map((i) => chapterEnd(i, chapters, 40))).toEqual([10, 25.5, 40]);
  });

  it("captionAt gives the words on screen at a time, or nothing between lines", () => {
    expect([0, 1, 2.99, 3, 3.5, 4.9, 5, 60].map((t) => captionAt(t, captions))).toEqual([null, "one", "one", null, "two", "two", null, null]);
  });

  it("captionIndexAt gives the line's place, or -1 between lines", () => {
    expect([0, 1, 3.2, 4, 9].map((t) => captionIndexAt(t, captions))).toEqual([-1, 0, -1, 1, -1]);
  });

  it("clock writes seconds as minutes and seconds", () => {
    expect([0, 7.4, 59.6, 60, 161, -3].map(clock)).toEqual(["0:00", "0:07", "0:59", "1:00", "2:41", "0:00"]);
  });
});
