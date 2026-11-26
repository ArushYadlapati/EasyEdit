// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import { render } from "../helpers/dom";

describe("privacy page", () => {
  it("states the Google API Services User Data Policy and Limited Use requirements", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toContain(
      "EasyEdit's use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy, including the Limited Use requirements.",
    );
  });

  it("links the policy name to Google's policy page", () => {
    const { container } = render(<PrivacyPage />);
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Google API Services User Data Policy");
    expect(link?.getAttribute("href")).toBe("https://developers.google.com/terms/api-services-user-data-policy");
    expect(link?.getAttribute("target")).toBeNull();
  });

  it("says how the Drive access EasyEdit keeps is stored and used", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toContain(
      "The access EasyEdit keeps for a connected Google Drive is stored encrypted, and is used only to store and play the videos you add to EasyEdit.",
    );
  });

  it("has a Your style section, after AI agents and before Deleting your data", () => {
    const { container } = render(<PrivacyPage />);
    const headings = Array.from(container.querySelectorAll("article h2")).map((h) => h.textContent);
    expect(headings.indexOf("Your style")).toBe(headings.indexOf("AI agents") + 1);
    expect(headings[headings.indexOf("Your style") + 1]).toBe("Deleting your data");
  });

  it("says a style's videos are looked at in the browser, what is saved, and that the video stays in your storage", () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent;
    expect(text).toContain("When you add one of the space's videos to it, EasyEdit looks at the video in your browser.");
    expect(text).toContain(
      "It saves what it found in EasyEdit's database: the video's length and shape, where its shots change, how fast people talk and the first words they say, how loud it is, its overall colors, and a small strip of frames from it. The video itself stays in your storage.",
    );
    expect(text).toContain("Everyone in the space, and the AI agents they connect, can see the style and what it learned.");
    expect(text).toContain("Removing a video, link or project from the style deletes what the style saved about it. The words kept for Auto captions stay with the video.");
  });

  it("says a link gives only a video's public details, never the video", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toContain(
      "For a link, EasyEdit asks YouTube, Vimeo or TikTok for the video's public title, author and picture (and from Vimeo, its length and description). It never gets the video itself.",
    );
  });

  it("says how long a YouTube channel's video details are used, and that disconnecting or ending access deletes them", () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent;
    expect(text).toContain("For each one you pick, EasyEdit keeps its title, channel name, description, tags, length and picture from YouTube.");
    expect(text).toContain("After 30 days EasyEdit stops using them, and within a day it deletes all but the video's address.");
    expect(text).toContain("When the channel is disconnected, or another channel takes its place, those videos are deleted from the style.");
    expect(text).toContain("If you remove EasyEdit on your Google account's permissions page instead, they are deleted within a day.");
  });

  it("says the Style page lists only a channel's public videos", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toContain("the Style page can list the channel's newest public videos. It never lists private or unlisted ones.");
  });

  it("says the YouTube permission is also used to read the channel's videos for a style, linking that section", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toContain(
      "EasyEdit reads the channel's name and, when someone picks videos from it for the space's style, the details of those videos (see Your style).",
    );
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Your style" && !a.closest("nav"));
    expect(link?.getAttribute("href")).toBe("#your-style");
    expect(container.querySelector("#your-style")?.textContent).toBe("Your style");
  });

  it("says auto captions run in the browser", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).toContain(
      "Auto captions run in your browser. Your audio is not sent anywhere to be transcribed. The first time you use them, your browser downloads the speech model from Hugging Face.",
    );
  });
});
