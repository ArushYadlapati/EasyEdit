// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markLessonWatched, noLessonsWatched, parseWatched, subscribeWatched, watchedLessons } from "@/lib/tutorial/watched";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the lessons this browser has watched", () => {
  it("starts with none, and the server draws none", () => {
    expect(watchedLessons()).toEqual([]);
    expect(noLessonsWatched()).toEqual([]);
  });

  it("remembers a lesson once, and tells whoever is listening", () => {
    const heard = vi.fn();
    const stop = subscribeWatched(heard);
    markLessonWatched("basics");
    markLessonWatched("basics");
    markLessonWatched("sound");
    expect(watchedLessons()).toEqual(["basics", "sound"]);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem("easyedit.learn.watched")!)).toEqual(["basics", "sound"]);
    stop();
    markLessonWatched("text");
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("hands back the same list until it changes, as a store read while rendering must", () => {
    markLessonWatched("basics");
    expect(watchedLessons()).toBe(watchedLessons());
  });

  it("reads only what it could have written", () => {
    expect(parseWatched(null)).toEqual([]);
    expect(parseWatched("not json")).toEqual([]);
    expect(parseWatched('{"basics":true}')).toEqual([]);
    expect(parseWatched('["basics", 4, "Bad Slug", "basics", "sound"]')).toEqual(["basics", "sound"]);
  });

  it("ignores a name that is no lesson's address", () => {
    markLessonWatched("../etc");
    expect(watchedLessons()).toEqual([]);
  });

  it("still ticks the lesson on this page when the browser will not store it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    markLessonWatched("text");
    expect(watchedLessons()).toEqual(["text"]);
  });
});
