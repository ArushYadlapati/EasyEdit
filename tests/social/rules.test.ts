import { describe, expect, it } from "vitest";
import { dashboardChannelNote, refusalMessage, SOCIAL_MESSAGES } from "@/lib/social/messages";
import { defaultTitle, isVideoId, postFormProblem, showsAsShort, videoUrl, type PostForm } from "@/lib/social/rules";

const form = (over: Partial<PostForm> = {}): PostForm => ({ title: "Match recap", description: "", visibility: "private", madeForKids: false, ...over });

describe("postFormProblem", () => {
  it("passes a plain form", () => {
    expect(postFormProblem(form())).toBeNull();
    expect(postFormProblem(form({ title: "é".repeat(100), description: "a".repeat(5000), visibility: "public" }))).toBeNull();
  });

  it("wants a title of up to 100 characters, counted as people see them", () => {
    expect(postFormProblem(form({ title: "   " }))).toBe("Give the video a title.");
    expect(postFormProblem(form({ title: "a".repeat(101) }))).toBe("A title can be up to 100 characters.");
    expect(postFormProblem(form({ title: "🤖".repeat(100) }))).toBeNull(); // 100 characters, 200 UTF-16 units
  });

  it("refuses < and > in the title and the description, as YouTube does", () => {
    expect(postFormProblem(form({ title: "a <b>" }))).toBe("A title can't contain < or >.");
    expect(postFormProblem(form({ description: "see > here" }))).toBe("A description can't contain < or >.");
  });

  it("measures the description in bytes", () => {
    expect(postFormProblem(form({ description: "é".repeat(2501) }))).toBe("The description is too long for YouTube (5,000 characters at most).");
  });

  it("refuses a visibility it does not know", () => {
    expect(postFormProblem(form({ visibility: "everyone" as PostForm["visibility"] }))).toBe("Choose who can see the video.");
  });
});

describe("defaultTitle", () => {
  it("is the project's name without what YouTube refuses, cut to 100 characters", () => {
    expect(defaultTitle("  Robot <reveal>  ")).toBe("Robot reveal");
    expect([...defaultTitle("🤖".repeat(150))]).toHaveLength(100);
  });
});

describe("showsAsShort", () => {
  it("is a square or taller video of three minutes or less", () => {
    expect(showsAsShort({ width: 1080, height: 1920, seconds: 45 })).toBe(true);
    expect(showsAsShort({ width: 1080, height: 1080, seconds: 180 })).toBe(true);
    expect(showsAsShort({ width: 1080, height: 1920, seconds: 181 })).toBe(false);
    expect(showsAsShort({ width: 1920, height: 1080, seconds: 30 })).toBe(false);
    expect(showsAsShort({ width: 1080, height: 1920, seconds: 0 })).toBe(false);
  });
});

describe("video ids", () => {
  it("are eleven characters of YouTube's alphabet", () => {
    expect(isVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isVideoId("dQw4w9WgXc")).toBe(false);
    expect(isVideoId("dQw4w9WgXcQ/")).toBe(false);
    expect(isVideoId("../../../etc")).toBe(false);
    expect(isVideoId(12345678901)).toBe(false);
    expect(videoUrl("dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
  });
});

describe("messages", () => {
  it("a connect that could not name its space is told on the space's dashboard", () => {
    expect(dashboardChannelNote("refused")).toEqual({ text: "That link to connect a YouTube channel didn't work. Start again from the space's settings, under Socials.", problem: true });
    expect(dashboardChannelNote(["failed", "x"])?.problem).toBe(true);
    expect(dashboardChannelNote("connected")).toBeNull();
    expect(dashboardChannelNote(undefined)).toBeNull();
  });

  it("a refused call to Google is told by its code, then by the call and its status", () => {
    expect(refusalMessage({ call: "youtube_session", reason: "quotaExceeded", status: 403 })).toBe(SOCIAL_MESSAGES.quota);
    expect(refusalMessage({ call: "youtube_session", reason: "forbidden", status: 403 })).toBe(SOCIAL_MESSAGES.notAllowed);
    expect(refusalMessage({ call: "oauth", reason: "invalid_client", status: 400 })).toBe(SOCIAL_MESSAGES.notAllowed);
    expect(refusalMessage({ call: "oauth", reason: "unreachable", status: 0 })).toBe(SOCIAL_MESSAGES.unreachable);
    expect(refusalMessage({ call: "youtube_session", reason: "invalidDescription", status: 400 })).toBe(SOCIAL_MESSAGES.refused);
  });
});
