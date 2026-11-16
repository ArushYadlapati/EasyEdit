// @vitest-environment happy-dom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialDialog } from "@/components/dashboard/tutorial-dialog";
import { TUTORIAL_CAPTIONS, TUTORIAL_CHAPTERS } from "@/lib/tutorial/script";
import { TUTORIAL_WORDS } from "@/lib/tutorial/words";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

const VIDEO = { url: "https://cdn.test/easyedit-intro.mp4", poster: "https://cdn.test/easyedit-intro.jpg" };

let play: ReturnType<typeof vi.fn<() => Promise<void>>>;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onWatched: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  onClose = vi.fn<() => void>();
  onWatched = vi.fn<() => void>();
  // A real player starts, then says so. Here starting only says so.
  play = vi.fn(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
});

afterEach(() => vi.restoreAllMocks());

function dialog({ open = true, firstVisit = true } = {}) {
  return <TutorialDialog open={open} video={VIDEO} firstVisit={firstVisit} onClose={onClose} onWatched={onWatched} />;
}

const video = () => document.querySelector("video") as HTMLVideoElement;
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const chapters = () => within(screen.getByRole("navigation", { name: "Chapters" })).getAllByRole("button");
const footerNames = () =>
  [TUTORIAL_WORDS.skip, TUTORIAL_WORDS.watch, TUTORIAL_WORDS.done].filter((name) => screen.queryByRole("button", { name }) !== null);

describe("the tutorial dialog", () => {
  it("shows the video with its poster, and never starts by itself", () => {
    render(dialog());
    expect(screen.getByRole("dialog", { name: "Welcome to EasyEdit" })).toBeTruthy();
    expect(video().getAttribute("src")).toBe(VIDEO.url);
    expect(video().getAttribute("poster")).toBe(VIDEO.poster);
    expect(video().hasAttribute("autoplay")).toBe(false);
    expect(video().hasAttribute("controls")).toBe(true);
    expect(play).not.toHaveBeenCalled();
    expect(onWatched).not.toHaveBeenCalled();
  });

  it("lists the ten chapters, each with its number, name and time", () => {
    render(dialog());
    expect(chapters()).toHaveLength(10);
    expect(chapters()[0].textContent).toBe("1Welcome0:00");
    expect(chapters()[2].textContent).toContain("3Dashboard");
  });

  it("a chapter jumps the video to its start and plays", () => {
    render(dialog());
    fireEvent.click(chapters()[2]);
    expect(video().currentTime).toBe(TUTORIAL_CHAPTERS[2].start);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("marks the chapter that is playing", () => {
    render(dialog());
    expect(chapters()[0].getAttribute("aria-current")).toBe("true");
    video().currentTime = TUTORIAL_CHAPTERS[3].start + 1;
    act(() => {
      video().dispatchEvent(new Event("timeupdate"));
    });
    expect(chapters().map((c) => c.getAttribute("aria-current"))).toEqual([null, null, null, "true", null, null, null, null, null, null]);
  });

  it("Watch plays it and reports the first play once, then the foot offers only Done", () => {
    render(dialog());
    expect(footerNames()).toEqual([TUTORIAL_WORDS.skip, TUTORIAL_WORDS.watch]);
    fireEvent.click(button(TUTORIAL_WORDS.watch));
    expect(play).toHaveBeenCalledTimes(1);
    expect(onWatched).toHaveBeenCalledTimes(1);
    expect(footerNames()).toEqual([TUTORIAL_WORDS.done]);
    act(() => {
      video().dispatchEvent(new Event("play")); // paused and played again from the player's own button
    });
    expect(onWatched).toHaveBeenCalledTimes(1);
    fireEvent.click(button(TUTORIAL_WORDS.done));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the player's own play button counts as watching too", () => {
    render(dialog());
    act(() => {
      video().dispatchEvent(new Event("play"));
    });
    expect(onWatched).toHaveBeenCalledTimes(1);
    expect(footerNames()).toEqual([TUTORIAL_WORDS.done]);
  });

  it("Skip for now closes it on a first visit, and is not offered when it was opened from the menu", () => {
    const { unmount } = render(dialog());
    fireEvent.click(button(TUTORIAL_WORDS.skip));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onWatched).not.toHaveBeenCalled();
    unmount();
    render(dialog({ firstVisit: false }));
    expect(footerNames()).toEqual([TUTORIAL_WORDS.watch]);
  });

  it("says so when the video cannot load, and still closes", () => {
    render(dialog());
    act(() => {
      video().dispatchEvent(new Event("error"));
    });
    expect(screen.getByRole("alert").textContent).toBe(TUTORIAL_WORDS.failed);
    expect(document.querySelector("video")).toBeNull();
    expect(footerNames()).toEqual([TUTORIAL_WORDS.done]);
    fireEvent.click(button(TUTORIAL_WORDS.done));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a play the browser refuses is not an error the person sees", async () => {
    play.mockImplementation(() => Promise.reject(new DOMException("not allowed", "NotAllowedError")));
    render(dialog());
    fireEvent.click(button(TUTORIAL_WORDS.watch));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(footerNames()).toEqual([TUTORIAL_WORDS.skip, TUTORIAL_WORDS.watch]);
  });

  it("carries the narration as captions the player shows: one track, every line, even when effects run twice", () => {
    render(<StrictMode>{dialog()}</StrictMode>);
    const tracks = video().textTracks;
    expect(tracks.length).toBe(1);
    expect(tracks[0].kind).toBe("captions");
    expect(tracks[0].mode).toBe("showing");
    expect(tracks[0].cues?.length).toBe(TUTORIAL_CAPTIONS.length);
    expect((tracks[0].cues?.[0] as VTTCue).text).toBe(TUTORIAL_CAPTIONS[0].text);
  });

  it("the player has a name, and Watch hands it the keyboard, so Space pauses the video and does not close the dialog", () => {
    render(dialog());
    expect(video().getAttribute("aria-label")).toBe(TUTORIAL_WORDS.video);
    fireEvent.click(button(TUTORIAL_WORDS.watch));
    expect(document.activeElement).toBe(video());
  });

  it("a video that had already failed before the dialog could listen is still reported", () => {
    const failedAlready = vi.spyOn(HTMLMediaElement.prototype, "error", "get").mockReturnValue({ code: 4, message: "" } as MediaError);
    render(dialog());
    expect(screen.getByRole("alert").textContent).toBe(TUTORIAL_WORDS.failed);
    expect(footerNames()).toEqual([TUTORIAL_WORDS.done]);
    failedAlready.mockRestore();
  });

  it("when the video fails the keyboard goes to Done", () => {
    render(dialog());
    act(() => {
      video().dispatchEvent(new Event("error"));
    });
    expect(document.activeElement).toBe(button(TUTORIAL_WORDS.done));
  });

  it("each opening starts from the beginning", () => {
    const { rerender } = render(dialog());
    fireEvent.click(button(TUTORIAL_WORDS.watch));
    expect(footerNames()).toEqual([TUTORIAL_WORDS.done]);
    rerender(dialog({ open: false }));
    expect(document.querySelector("video")).toBeNull();
    rerender(dialog({ open: true }));
    expect(footerNames()).toEqual([TUTORIAL_WORDS.skip, TUTORIAL_WORDS.watch]);
  });
});
