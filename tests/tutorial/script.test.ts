import { describe, expect, it } from "vitest";
import { GUIDE_LESSONS, GUIDE_VOICE_CREDIT } from "@/lib/tutorial/script";

// The guide that ships is written by the recording script. Whatever recording it came from, it has to hold together.
describe("the guide that ships", () => {
  it("has lessons, each with an address of its own", () => {
    expect(GUIDE_LESSONS.length).toBeGreaterThan(0);
    const slugs = GUIDE_LESSONS.map((lesson) => lesson.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.every((slug) => /^[a-z0-9-]{1,40}$/.test(slug))).toBe(true);
  });

  it("keeps a section's lessons together, so the menu lists each section once", () => {
    const order = GUIDE_LESSONS.map((lesson) => lesson.section).filter((section, i, all) => i === 0 || section !== all[i - 1]);
    expect(new Set(order).size).toBe(order.length);
  });

  it.each(GUIDE_LESSONS.map((lesson) => [lesson.slug, lesson] as const))("%s: its words, chapters and captions are in order and inside the video", (_slug, lesson) => {
    expect(lesson.title.trim()).not.toBe("");
    expect(lesson.summary.trim()).not.toBe("");
    expect(lesson.section.trim()).not.toBe("");
    expect(lesson.seconds).toBeGreaterThan(0);
    expect(lesson.chapters.length).toBeGreaterThan(0);
    expect(lesson.chapters[0].start).toBe(0);
    expect(lesson.chapters.every((c, i, all) => c.title.trim() !== "" && (i === 0 || c.start > all[i - 1].start))).toBe(true);
    expect(lesson.chapters.at(-1)!.start).toBeLessThan(lesson.seconds);
    expect(lesson.captions.length).toBeGreaterThan(0);
    expect(lesson.captions.every((c, i, all) => c.text.trim() !== "" && c.end > c.start && (i === 0 || c.start >= all[i - 1].end))).toBe(true);
    expect(lesson.captions.at(-1)!.end).toBeLessThanOrEqual(lesson.seconds);
  });

  it("names its voice's credit, or none", () => {
    expect(GUIDE_VOICE_CREDIT === null || GUIDE_VOICE_CREDIT.trim() !== "").toBe(true);
  });
});
