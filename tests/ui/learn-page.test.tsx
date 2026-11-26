// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LessonPage, { generateMetadata } from "@/app/(dashboard)/learn/[lesson]/page";
import LearnPage, { metadata } from "@/app/(dashboard)/learn/page";
import { markTutorialSeenAction } from "@/app/(dashboard)/tutorial/actions";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { hasSeenTutorial, markTutorialSeen } from "@/lib/tutorial/seen";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";
import { makeTestDb } from "../helpers/db";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

class NotFound extends Error {}
class Redirect extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}
// The guide as the recording wrote it: here a small one of three lessons, with whatever credit a test sets.
const voice = vi.hoisted(() => ({ credit: null as string | null }));
vi.mock("@/lib/tutorial/script", async () => {
  const { GUIDE: lessons } = await import("../helpers/guide");
  return {
    GUIDE_LESSONS: lessons,
    get GUIDE_VOICE_CREDIT() {
      return voice.credit;
    },
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
  redirect: (to: string) => {
    throw new Redirect(to);
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

const VIDEO = "https://cdn.test/guide/basics.mp4";
const ada: CurrentUser = { id: "u-ada", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "editor" };
let play: ReturnType<typeof vi.fn<() => Promise<void>>>;

beforeEach(async () => {
  signedIn.user = ada;
  testDb = await makeTestDb();
  await testDb.insert(user).values([{ id: ada.id, name: ada.name, email: ada.email }]);
  vi.mocked(markTutorialSeenAction).mockClear();
  voice.credit = null;
  window.localStorage.clear();
  play = vi.fn(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Each page hands over to one server component that does the work (LessonView). The test renderer does not run a
// server component it finds inside a page, so the one the page returned is run here and its result drawn.
async function drawn(page: ReactNode) {
  const view = page as ReactElement<Record<string, unknown>, (props: Record<string, unknown>) => Promise<ReactNode>>;
  return render(await view.type(view.props));
}
const first = async (query: Record<string, string> = {}) => drawn(await LearnPage({ params: Promise.resolve({}), searchParams: Promise.resolve(query) }));
const lesson = async (slug: string, query: Record<string, string> = {}) => drawn(await LessonPage({ params: Promise.resolve({ lesson: slug }), searchParams: Promise.resolve(query) }));
const video = () => document.querySelector("video") as HTMLVideoElement;
const chapters = () => within(screen.getByRole("navigation", { name: "Chapters" })).getAllByRole("button");
const menu = () => screen.getByRole("navigation", { name: "Lessons" });
const transcript = () => screen.getByRole("region", { name: "Transcript" });
const at = (seconds: number, event = "timeupdate") =>
  act(() => {
    video().currentTime = seconds;
    video().dispatchEvent(new Event(event));
  });

describe("the Learn page", () => {
  beforeEach(() => vi.stubEnv("TUTORIAL_VIDEO_URL", VIDEO));

  it("opens on the first lesson: its name, what is in it, its length and place, its player and chapters, and a way back", async () => {
    await first();
    expect(metadata.title).toBe("Learn");
    expect(screen.getByRole("heading", { level: 1, name: "The basics" })).toBeTruthy();
    expect(screen.getByText("From a new project to a finished video.")).toBeTruthy();
    expect(screen.getByText("1:00 · Lesson 1 of 3")).toBeTruthy();
    expect(video().getAttribute("src")).toBe(VIDEO);
    expect(video().getAttribute("poster")).toBe("https://cdn.test/guide/basics.jpg");
    expect(video().hasAttribute("autoplay")).toBe(false);
    expect(chapters().map((c) => c.textContent)).toEqual(["Welcome0:00", "A new project0:10", "Export0:40"]);
    expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("credits the voice beside the lesson's length when the recording names one, and not otherwise", async () => {
    voice.credit = "voice.example";
    const { unmount } = await first();
    expect(screen.getByText("1:00 · Lesson 1 of 3 · Voice by voice.example")).toBeTruthy();
    unmount();
    voice.credit = null;
    await first();
    expect(screen.queryByText(/Voice by/)).toBeNull();
  });

  it("lists every lesson under its section, with its length, and marks the one showing", async () => {
    await lesson("text");
    expect(within(menu()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Start here", "Editing"]);
    const links = within(menu()).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["The basics1:00", "/learn", null],
      ["Text and captions0:40", "/learn/text", "page"],
      ["Sound0:30", "/learn/sound", null],
    ]);
  });

  it("shows any other lesson at its own address, with its own video from beside the first one's", async () => {
    await lesson("text");
    expect((await generateMetadata({ params: Promise.resolve({ lesson: "text" }), searchParams: Promise.resolve({}) })).title).toBe("Text and captions · Learn");
    expect(screen.getByRole("heading", { level: 1, name: "Text and captions" })).toBeTruthy();
    expect(screen.getByText("0:40 · Lesson 2 of 3")).toBeTruthy();
    expect(video().getAttribute("src")).toBe("https://cdn.test/guide/text.mp4");
    expect(video().getAttribute("poster")).toBe("https://cdn.test/guide/text.jpg");
    expect(chapters()).toHaveLength(2);
  });

  it("leads on to the next lesson, and says so at the last", async () => {
    const { unmount } = await lesson("text");
    expect(screen.getByRole("link", { name: "Next: Sound" }).getAttribute("href")).toBe("/learn/sound");
    unmount();
    await lesson("sound");
    expect(screen.queryByRole("link", { name: /^Next/ })).toBeNull();
    expect(screen.getByText(TUTORIAL_WORDS.lastLesson)).toBeTruthy();
  });

  it("sends the first lesson's own name to the Learn page, keeping the moment asked for", async () => {
    await expect(lesson("basics")).rejects.toMatchObject({ to: "/learn" });
    await expect(lesson("basics", { t: "41" })).rejects.toMatchObject({ to: "/learn?t=41" });
  });

  it("is not there for a lesson the guide does not have, or on a server with no videos", async () => {
    await expect(lesson("nope")).rejects.toBeInstanceOf(NotFound);
    vi.stubEnv("TUTORIAL_VIDEO_URL", "");
    await expect(first()).rejects.toBeInstanceOf(NotFound);
    await expect(lesson("text")).rejects.toBeInstanceOf(NotFound);
    vi.stubEnv("TUTORIAL_VIDEO_URL", "not a link");
    await expect(first()).rejects.toBeInstanceOf(NotFound);
  });

  it("a link to a moment stands the video there once its length is known, without playing it", async () => {
    await lesson("text", { t: "21" });
    expect(chapters().map((c) => c.getAttribute("aria-current"))).toEqual([null, "true"]);
    act(() => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });
    expect(video().currentTime).toBe(21);
    expect(play).not.toHaveBeenCalled();
    // A moment that is not in the lesson is the start.
    expect(within(transcript()).getByRole("button", { name: /Click Auto captions/ }).getAttribute("aria-current")).toBe("true");
  });

  it("a link to another moment of the lesson showing gets a player of its own, so the video moves there", async () => {
    // The search links to a moment of the very lesson on screen: the page is drawn again with the new moment, and the
    // player, which stands at its moment only once, has to be a new one.
    const page = async (t: string) => {
      const view = (await LessonPage({ params: Promise.resolve({ lesson: "text" }), searchParams: Promise.resolve({ t }) })) as ReactElement<Record<string, unknown>, (props: Record<string, unknown>) => Promise<ReactNode>>;
      return view.type(view.props);
    };
    const { rerender } = render(await page("2"));
    act(() => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });
    expect(video().currentTime).toBe(2);
    const before = video();
    rerender(await page("21"));
    expect(video()).not.toBe(before);
    act(() => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });
    expect(video().currentTime).toBe(21);
  });

  it("a chapter jumps the video to its start and plays, and the one playing is marked", async () => {
    await first();
    fireEvent.click(chapters()[2]);
    expect(video().currentTime).toBe(40);
    expect(play).toHaveBeenCalledTimes(1);
    at(12);
    expect(chapters().map((c) => c.getAttribute("aria-current"))).toEqual([null, "true", null]);
  });

  it("writes out everything said, under its chapter; a line plays from there, and the line being said is marked", async () => {
    await first();
    expect(within(transcript()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Welcome", "A new project", "Export"]);
    const lines = () => within(transcript()).getAllByRole("button");
    expect(lines().map((l) => l.textContent)).toEqual(["0:01Welcome to EasyEdit.", "0:11To start a video, click New project.", "0:41When you're done, click Export.", "0:46Nothing is uploaded."]);
    fireEvent.click(lines()[2]);
    expect(video().currentTime).toBe(41);
    expect(play).toHaveBeenCalledTimes(1);
    at(47);
    expect(lines().map((l) => l.getAttribute("aria-current"))).toEqual([null, null, null, "true"]);
    at(45.5); // between two lines
    expect(lines().every((l) => l.getAttribute("aria-current") === null)).toBe(true);
  });

  it("ticks a lesson in the menu once it has played into its last seconds, and keeps the tick", async () => {
    const { unmount } = await first();
    at(30);
    expect(within(menu()).queryByRole("img", { name: "Watched" })).toBeNull();
    at(56);
    expect(within(within(menu()).getByRole("link", { name: /The basics/ })).getByRole("img", { name: "Watched" })).toBeTruthy();
    unmount();
    await lesson("sound");
    expect(within(menu()).getAllByRole("img", { name: "Watched" })).toHaveLength(1);
  });

  it("searches everything said: each line found is a link to its moment, and clearing brings the lessons back", async () => {
    await first();
    const search = screen.getByRole("searchbox", { name: "Search the guide" });
    fireEvent.change(search, { target: { value: "fade" } });
    const results = screen.getByRole("region", { name: "Search results" });
    const found = within(results).getAllByRole("link");
    expect(found.map((a) => [a.getAttribute("href"), a.textContent])).toEqual([["/learn/sound?t=2", "Fade a clip in and out.Sound · 0:02"]]);
    expect(within(results).getByRole("status").textContent).toBe("1 line");
    expect(within(menu()).queryByRole("heading", { level: 2 })).toBeNull();
    fireEvent.change(search, { target: { value: "zebra" } });
    expect(screen.getByRole("status").textContent).toBe(TUTORIAL_WORDS.noResults("zebra"));
    fireEvent.change(search, { target: { value: " " } });
    expect(within(menu()).getAllByRole("link")).toHaveLength(3);
  });

  it("watching a lesson here counts as having been welcomed, so the welcome does not follow", async () => {
    await lesson("sound");
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

  it("someone who has been welcomed can watch again and nothing is written", async () => {
    await markTutorialSeen(testDb, ada.id);
    await first();
    await act(async () => {
      video().dispatchEvent(new Event("play"));
    });
    expect(markTutorialSeenAction).not.toHaveBeenCalled();
  });

  it("says so when the video cannot load, and the chapters wait", async () => {
    await first();
    act(() => {
      video().dispatchEvent(new Event("error"));
    });
    expect(screen.getByRole("alert").textContent).toBe(TUTORIAL_WORDS.failed);
    expect(chapters().every((c) => (c as HTMLButtonElement).disabled)).toBe(true);
  });
});
