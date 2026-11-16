// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LearnPage, { metadata } from "@/app/(dashboard)/learn/page";
import { markTutorialSeenAction } from "@/app/(dashboard)/tutorial/actions";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { TUTORIAL_CHAPTERS } from "@/lib/tutorial/script";
import { hasSeenTutorial, markTutorialSeen } from "@/lib/tutorial/seen";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";
import { makeTestDb } from "../helpers/db";
import { act, render, screen, within } from "../helpers/dom";

class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
  usePathname: () => "/learn",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const signedIn = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock("@/lib/access", () => ({ requireUser: vi.fn(async () => signedIn.user!) }));
let testDb: DB;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => testDb }));
// The action as the page hands it to the player: here it writes the mark and nothing else.
vi.mock("@/app/(dashboard)/tutorial/actions", () => ({
  markTutorialSeenAction: vi.fn(async () => {
    await markTutorialSeen(testDb, signedIn.user!.id);
    return {};
  }),
}));

const VIDEO = "https://cdn.test/easyedit-intro.mp4";
const ada: CurrentUser = { id: "u-ada", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };

beforeEach(async () => {
  signedIn.user = ada;
  testDb = await makeTestDb();
  await testDb.insert(user).values([{ id: ada.id, name: ada.name, email: ada.email }]);
  vi.mocked(markTutorialSeenAction).mockClear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const page = async () => render(await LearnPage());
const video = () => document.querySelector("video") as HTMLVideoElement;

describe("the Learn page", () => {
  it("shows the tutorial on a page of its own: a heading, the player and its ten chapters, and a way back", async () => {
    vi.stubEnv("TUTORIAL_VIDEO_URL", VIDEO);
    await page();
    expect(metadata.title).toBe("Learn");
    expect(screen.getByRole("heading", { level: 1, name: "Learn" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: TUTORIAL_WORDS.basics })).toBeTruthy();
    expect(video().getAttribute("src")).toBe(VIDEO);
    expect(video().getAttribute("poster")).toBe("https://cdn.test/easyedit-intro.jpg");
    expect(video().hasAttribute("autoplay")).toBe(false);
    expect(within(screen.getByRole("navigation", { name: "Chapters" })).getAllByRole("button")).toHaveLength(TUTORIAL_CHAPTERS.length);
    expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is not there on a server with no video", async () => {
    await expect(LearnPage()).rejects.toBeInstanceOf(NotFound);
    vi.stubEnv("TUTORIAL_VIDEO_URL", "not a link");
    await expect(LearnPage()).rejects.toBeInstanceOf(NotFound);
  });

  it("watching it here counts as having seen it, so the welcome does not follow", async () => {
    vi.stubEnv("TUTORIAL_VIDEO_URL", VIDEO);
    await page();
    expect(await hasSeenTutorial(testDb, ada.id)).toBe(false);
    await act(async () => {
      video().dispatchEvent(new Event("play"));
    });
    expect(markTutorialSeenAction).toHaveBeenCalledTimes(1);
    expect(await hasSeenTutorial(testDb, ada.id)).toBe(true);
    await act(async () => {
      video().dispatchEvent(new Event("play")); // paused and played again
    });
    expect(markTutorialSeenAction).toHaveBeenCalledTimes(1);
  });

  it("someone who has seen it can watch again and nothing is written", async () => {
    vi.stubEnv("TUTORIAL_VIDEO_URL", VIDEO);
    await markTutorialSeen(testDb, ada.id);
    await page();
    await act(async () => {
      video().dispatchEvent(new Event("play"));
    });
    expect(markTutorialSeenAction).not.toHaveBeenCalled();
  });

  it("says so when the video cannot load", async () => {
    vi.stubEnv("TUTORIAL_VIDEO_URL", VIDEO);
    await page();
    act(() => {
      video().dispatchEvent(new Event("error"));
    });
    expect(screen.getByRole("alert").textContent).toBe(TUTORIAL_WORDS.failed);
  });
});
