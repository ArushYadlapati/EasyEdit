// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clipShares,
  currentAt,
  DOCK,
  FOLD,
  foldAt,
  HANDOVER,
  morphAt,
  PageDock,
  playheadAt,
  readingLine,
  TIMELINE,
} from "@/components/home/page-dock";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

// A page like the home page: the first screen, five sections (one named only by its heading), the page's close, the
// dock after them in <main>, then the footer. With `heroTimeline`, the first screen ends with its timeline's video
// track and playhead, as the home page's does.
function Page({ heroTimeline = false }: { heroTimeline?: boolean }) {
  return (
    <div className="h-site">
      <main className="h-page">
        <section className="h-hero" aria-labelledby="home-title">
          <h1 id="home-title">The video editor for AI agents.</h1>
          {heroTimeline && (
            <div className="h-edTimeline">
              <div className="h-edTrack" data-track="video">
                <span className="h-edLane">
                  {["bonfire", "shibuya", "ridge", "wave"].map((name, i) => (
                    <span key={name} className="h-edClip" style={{ left: `${i * 25}%`, width: "24.6%" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a clip thumbnail in a drawn interface */}
                      <img src={`/home/scene-${name}.webp`} alt="" />
                      {`${name}.mp4`}
                    </span>
                  ))}
                </span>
              </div>
              <span className="h-edPlayhead" />
            </div>
          )}
        </section>
        <section id="ai" aria-labelledby="ai-title" data-dock-label="Ask an agent">
          <h2 id="ai-title">Ask an agent. Watch it edit.</h2>
        </section>
        <section id="start" aria-labelledby="start-title" data-dock-label="First project">
          <h2 id="start-title">Make your first project.</h2>
        </section>
        <section id="free" aria-labelledby="free-title" data-dock-label="Free">
          <h2 id="free-title">Free. Your files stay in your Drive.</h2>
        </section>
        <section id="teams" aria-labelledby="teams-title" data-dock-label="Teams">
          <h2 id="teams-title">Built for teams.</h2>
        </section>
        <section id="agents" aria-labelledby="agents-title">
          <h2 id="agents-title">Works with every AI agent.</h2>
        </section>
        <section id="timeline" className="h-close" aria-labelledby="close-title" data-dock-label="One timeline">
          <h2 id="close-title">You and your agent share one timeline.</h2>
          <p>
            <a href="/login">Start free</a>
          </p>
        </section>
        <PageDock />
      </main>
      <footer>© 2026 EasyEdit</footer>
    </div>
  );
}

// The window: its width and reduced-motion setting, which a test can change while the page is open.
let width = 1440;
let reduce = false;
const mediaListeners = new Set<() => void>();
function resizeTo(next: number) {
  width = next;
  act(() => mediaListeners.forEach((listener) => listener()));
}

// Frames wait until a test runs them.
let frames: FrameRequestCallback[] = [];
function runFrames() {
  const now = frames;
  frames = [];
  act(() => {
    for (const frame of now) frame(0);
  });
}

beforeEach(() => {
  width = 1440;
  reduce = false;
  mediaListeners.clear();
  frames = [];
  vi.stubGlobal("matchMedia", (text: string) => ({
    get matches() {
      if (text === "(width > 860px)") return width > 860;
      if (text === "(prefers-reduced-motion: reduce)") return reduce;
      throw new Error(`unexpected media query ${text}`);
    },
    addEventListener: (_: "change", listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: "change", listener: () => void) => mediaListeners.delete(listener),
  }));
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dock = () => screen.getByRole("navigation", { name: "Page" });
const links = () => within(dock()).getAllByRole("link");
const section = (id: string) => document.getElementById(id)!;
// Scrolls the window to `y` and runs the frame that follows.
function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  fireEvent.scroll(window);
  runFrames();
}
// Where each section is with the page at the top (top, height), the window 800 px tall and the page 6000 px long.
const BOXES: Record<string, [number, number]> = {
  ai: [1000, 1000],
  start: [2000, 500],
  free: [2500, 800],
  teams: [3300, 1200],
  agents: [4500, 400],
  timeline: [4900, 600],
};
function layOut(boxes: Record<string, [number, number]> = BOXES) {
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", { value: 6000, configurable: true });
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const [top, height] = boxes[this.id] ?? [0, 0];
    const y = top - window.scrollY;
    return { top: y, height, bottom: y + height, left: 0, right: 0, width: 0, x: 0, y } as DOMRect;
  });
}

describe("page dock", () => {
  it("draws nothing on the server, so the page's HTML is the same for every window", () => {
    expect(renderToString(<PageDock />)).toBe("");
    expect(renderToString(<Page />)).not.toContain('aria-label="Page"');
  });

  it("has a link for each section after the first screen, in page order, named short, to the section", () => {
    render(<Page />);
    expect(links().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Ask an agent", "#ai"],
      ["First project", "#start"],
      ["Free", "#free"],
      ["Teams", "#teams"],
      ["Works with every AI agent", "#agents"], // no data-dock-label: the first sentence of its heading
      ["One timeline", "#timeline"], // the page's close is the last clip
    ]);
    // It is drawn UI, in <main> after the last section, so Tab reaches it once it has been through the page.
    expect(dock().hasAttribute("data-ui")).toBe(true);
    expect(dock().closest("main")).toBeTruthy();
    expect(document.querySelector(".h-close")!.compareDocumentPosition(dock())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("marks the clip under the playhead as the current location: the section across the middle of the window", () => {
    layOut();
    render(<Page />);
    runFrames();
    const current = () => links().filter((a) => a.getAttribute("aria-current") === "location").map((a) => a.textContent);
    expect(current()).toEqual([]); // the middle of the window (400) is still above the sections

    scrollTo(1000); // the middle: 1400
    expect(current()).toEqual(["Ask an agent"]);
    scrollTo(2300); // 2700
    expect(current()).toEqual(["Free"]);
    // On a boundary the lower section is the one being read.
    scrollTo(2900); // 3300
    expect(current()).toEqual(["Teams"]);
    // The page's last screen: the line has gone on down to the window's foot, past the close, so the close is current.
    scrollTo(5200);
    expect(current()).toEqual(["One timeline"]);
  });

  it("gives a section with no id to the clip before it", () => {
    function Short() {
      return (
        <main>
          <section className="h-hero" />
          <section id="a" data-dock-label="A">
            <h2>A.</h2>
          </section>
          <section className="extra">
            <h2>More of A.</h2>
          </section>
          <section id="b" data-dock-label="B">
            <h2>B.</h2>
          </section>
          <PageDock />
        </main>
      );
    }
    render(<Short />);
    expect(links().map((a) => a.textContent)).toEqual(["A", "B"]);
  });

  it("folds the first screen's timeline into the dock as the page scrolls, and is the whole strip once it has", () => {
    // The first screen's foot is 1300 px down the page.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const bottom = this.classList.contains("h-hero") ? 1300 - window.scrollY : 0;
      return { top: 0, height: bottom, bottom, left: 0, right: 0, width: 0, x: 0, y: 0 } as DOMRect;
    });
    const scrollTo = (y: number) => {
      Object.defineProperty(window, "scrollY", { value: y, configurable: true });
      fireEvent.scroll(window);
      runFrames();
    };
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    render(<Page />);
    runFrames();
    const hero = document.querySelector<HTMLElement>(".h-hero")!;
    const fold = () => [hero.style.getPropertyValue("--fold"), dock().style.getPropertyValue("--fold")];
    const shown = () => dock().hasAttribute("data-shown");
    expect(fold()).toEqual(["0.0000", "0.0000"]);
    expect(shown()).toBe(false);

    // The timeline's top on the window's top (its foot a timeline and a fold from it): held, not folded yet.
    scrollTo(1300 - TIMELINE - FOLD);
    expect(fold()).toEqual(["0.0000", "0.0000"]);
    // Half way.
    scrollTo(1300 - TIMELINE - FOLD / 2);
    expect(fold()).toEqual(["0.5000", "0.5000"]);
    expect(shown()).toBe(false);
    // Folded: the dock is the strip, and takes the pointer.
    scrollTo(1300 - TIMELINE);
    expect(fold()).toEqual(["1.0000", "1.0000"]);
    expect(shown()).toBe(true);
    scrollTo(5000);
    expect(shown()).toBe(true);
    // Back up, it unfolds again the same way.
    scrollTo(1300 - TIMELINE - FOLD / 4);
    expect(fold()).toEqual(["0.7500", "0.7500"]);
    expect(shown()).toBe(false);
  });

  it("with reduced motion, holds and folds nothing: the dock is simply there once the timeline has gone past the top", () => {
    reduce = true;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const bottom = this.classList.contains("h-hero") ? 1300 - window.scrollY : 0;
      return { top: 0, height: bottom, bottom, left: 0, right: 0, width: 0, x: 0, y: 0 } as DOMRect;
    });
    Object.defineProperty(window, "scrollY", { value: 1300 - TIMELINE - FOLD / 2, configurable: true });
    render(<Page />);
    runFrames();
    expect(dock().style.getPropertyValue("--fold")).toBe("0.0000");
    expect(dock().hasAttribute("data-shown")).toBe(false);
    // The timeline's foot (a fold above the first screen's) on the window's top.
    Object.defineProperty(window, "scrollY", { value: 1300 - FOLD, configurable: true });
    fireEvent.scroll(window);
    runFrames();
    expect(dock().style.getPropertyValue("--fold")).toBe("1.0000");
    expect(dock().hasAttribute("data-shown")).toBe(true);
  });

  it("works out the fold from where the first screen's foot is in the window", () => {
    expect(FOLD).toBe(TIMELINE - DOCK);
    expect(foldAt(2000, false)).toBe(0);
    expect(foldAt(TIMELINE + FOLD, false)).toBe(0);
    expect(foldAt(TIMELINE + FOLD / 2, false)).toBe(0.5);
    expect(foldAt(TIMELINE, false)).toBe(1);
    expect(foldAt(-500, false)).toBe(1);
    expect(foldAt(FOLD + 1, true)).toBe(0);
    expect(foldAt(FOLD, true)).toBe(1);
  });

  it("gives the timeline back whole if the dock goes (a window narrowed to a phone's width)", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const bottom = this.classList.contains("h-hero") ? 100 : 0;
      return { top: 0, height: bottom, bottom, left: 0, right: 0, width: 0, x: 0, y: 0 } as DOMRect;
    });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    render(<Page />);
    runFrames();
    const hero = document.querySelector<HTMLElement>(".h-hero")!;
    expect(hero.style.getPropertyValue("--fold")).toBe("1.0000");
    resizeTo(800);
    expect(hero.style.getPropertyValue("--fold")).toBe("");
  });

  it("isn't there at all at 860 px wide or less, and comes and goes as the window crosses that width", () => {
    width = 800;
    render(<Page />);
    expect(screen.queryByRole("navigation", { name: "Page" })).toBeNull();
    expect(document.querySelector(".h-dock")).toBeNull();

    resizeTo(1024);
    expect(links()).toHaveLength(6);
    resizeTo(860); // the phone layout, where the first screen has no timeline
    expect(document.querySelector(".h-dock")).toBeNull();
  });

  it("goes to the section smoothly, gives its heading the focus and puts the section in the address", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<Page />);
    const followed = fireEvent.click(within(dock()).getByRole("link", { name: "Teams" }));
    expect(followed).toBe(false); // the page scrolls there itself, instead of jumping
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(section("teams"));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    const heading = section("teams-title");
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(window.location.hash).toBe("#teams");
  });

  it("with reduced motion, goes to the section at once", () => {
    reduce = true;
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<Page />);
    fireEvent.click(within(dock()).getByRole("link", { name: "Free" }));
    expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(document.activeElement).toBe(section("free-title"));
  });

  it("leaves a click that opens a new tab or window to the browser", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<Page />);
    const link = within(dock()).getByRole("link", { name: "Free" });
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("sizes each clip by its section's height and moves the playhead on the next frame after a scroll, by transform", () => {
    const measured = layOut();
    render(<Page />);

    // 4500 px of sections: the clips take 1000, 500, 800, 1200, 400 and 600 parts of the track, 4 px apart.
    const clipBoxes = links().map((a) => (a.parentElement as HTMLElement).style);
    const percent = (value: string) => Number(/([\d.]+)%/.exec(value)?.[1]);
    [1000, 500, 800, 1200, 400, 600].forEach((part, i) => {
      expect(clipBoxes[i].getPropertyValue("--width")).toMatch(/^calc\([\d.]+% - 4px\)$/);
      expect(percent(clipBoxes[i].getPropertyValue("--width"))).toBeCloseTo((part / 4500) * 100, 6);
    });
    expect(percent(clipBoxes[2].getPropertyValue("--left"))).toBeCloseTo((1500 / 4500) * 100, 6);

    const playhead = document.querySelector<HTMLElement>(".h-dockPlayhead")!;
    runFrames();
    expect(playhead.style.transform).toBe("translateX(0.000%)"); // the middle of the window is still above the sections

    const reads = measured.mock.calls.length;
    Object.defineProperty(window, "scrollY", { value: 2500, configurable: true }); // the middle of the window: 2900
    fireEvent.scroll(window);
    fireEvent.scroll(window);
    expect(playhead.style.transform).toBe("translateX(0.000%)"); // not until the next frame
    expect(frames).toHaveLength(1); // two scroll events, one frame
    runFrames();
    // Half way into Free: past Ask an agent and First project (1500 parts), then 400 of its 800.
    expect(playhead.style.transform).toBe(`translateX(${((1900 / 4500) * 100).toFixed(3)}%)`);
    expect(measured.mock.calls.length).toBe(reads); // nothing is measured while scrolling

    // Scrolled to the very end, the playhead has reached the end of the last clip, the close's.
    scrollTo(6000 - 800);
    expect(playhead.style.transform).toBe("translateX(100.000%)");
  });

  it("reads the page at the window's middle, and over the last half a window of scroll goes on down to its foot", () => {
    // A 6000 px page in an 800 px window: at most 5200 px of scroll.
    expect(readingLine(0, 800, 5200)).toBe(400);
    expect(readingLine(3000, 800, 5200)).toBe(3400);
    expect(readingLine(4800, 800, 5200)).toBe(5200); // half a window from the end: still the middle
    expect(readingLine(5000, 800, 5200)).toBe(5600); // three quarters of the way down the window
    expect(readingLine(5200, 800, 5200)).toBe(6000); // the page's foot
    expect(currentAt(900, [{ top: 1000, height: 500 }])).toBe(-1);
    expect(currentAt(1000, [{ top: 1000, height: 500 }, { top: 1500, height: 500 }])).toBe(0);
    expect(currentAt(1500, [{ top: 1000, height: 500 }, { top: 1500, height: 500 }])).toBe(1);
    expect(currentAt(9000, [{ top: 1000, height: 500 }, { top: 1500, height: 500 }])).toBe(1);
  });

  it("takes the first screen's video clips and playhead over half way through the fold, and changes them into its own", () => {
    // The first screen's foot is 1300 px down the page; its playhead stands 60% along its 1000 px video lane.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList.contains("h-hero")) return { top: 0, bottom: 1300 - window.scrollY, height: 1300 } as DOMRect;
      if (this.classList.contains("h-edLane")) return { left: 100, width: 1000, top: 0, bottom: 0 } as DOMRect;
      if (this.classList.contains("h-edPlayhead")) return { left: 700, width: 1000, top: 0, bottom: 0 } as DOMRect;
      const [top, height] = BOXES[this.id] ?? [0, 0];
      return { top: top - window.scrollY, height, bottom: top - window.scrollY + height } as DOMRect;
    });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 6000, configurable: true });
    render(<Page heroTimeline />);
    runFrames();

    // Each clip starts out as one of the first screen's video clips, where it is and as long; the sections past the
    // last of those start out as nothing at the track's end, and grow in from there. Only the clips that are the
    // first screen's own carry its names and pictures.
    const boxes = links().map((a) => (a.parentElement as HTMLElement).style);
    expect(boxes.map((b) => [b.getPropertyValue("--from-left"), b.getPropertyValue("--from-width")])).toEqual([
      ["0%", "24.6%"],
      ["25%", "24.6%"],
      ["50%", "24.6%"],
      ["75%", "24.6%"],
      ["100%", "0%"],
      ["100%", "0%"],
    ]);
    const from = [...dock().querySelectorAll(".h-dockFrom")];
    expect(from.map((el) => [el.textContent, el.querySelector("img")?.getAttribute("src")])).toEqual([
      ["bonfire.mp4", "/home/scene-bonfire.webp"],
      ["shibuya.mp4", "/home/scene-shibuya.webp"],
      ["ridge.mp4", "/home/scene-ridge.webp"],
      ["wave.mp4", "/home/scene-wave.webp"],
    ]);
    // They are for the eye: each link is named by its section alone.
    expect(links().map((a) => a.textContent)).toEqual([
      "Ask an agent",
      "First project",
      "Free",
      "Teams",
      "Works with every AI agent",
      "One timeline",
    ]);

    const playhead = document.querySelector<HTMLElement>(".h-dockPlayhead")!;
    const at = () => Number(/translateX\(([\d.]+)%\)/.exec(playhead.style.transform)?.[1]);
    // At the handover the dock's playhead stands where the first screen's did.
    scrollTo(1300 - TIMELINE - FOLD * (1 - HANDOVER));
    expect(dock().style.getPropertyValue("--fold")).toBe("0.5000");
    expect(at()).toBeCloseTo(60, 3);
    // Three quarters of the way, it has gone half way to where the page is read (the middle of the window, 1494 px
    // down, is 49.4% into Ask an agent, whose clip is 1000 of the track's 4500 parts).
    const reading = (line: number) => (((line - 1000) / 1000) * 1000 * 100) / 4500;
    scrollTo(1300 - TIMELINE - FOLD / 4);
    expect(at()).toBeCloseTo(60 + (reading(1094 + 400) - 60) / 2, 3);
    // Folded: it is where the page is read.
    scrollTo(1300 - TIMELINE);
    expect(at()).toBeCloseTo(reading(1124 + 400), 3);
    expect(morphAt(0)).toBe(0);
    expect(morphAt(HANDOVER)).toBe(0);
    expect(morphAt(0.75)).toBe(0.5);
    expect(morphAt(1)).toBe(1);
  });

  it("puts the playhead as far into a clip as the middle of the window is into its section", () => {
    const spans = [
      { top: 1000, height: 1000 },
      { top: 2000, height: 500 },
      { top: 2600, height: 400 }, // 100 px after the one above it
    ];
    const shares = [0.5, 0.25, 0.25];
    expect(playheadAt(0, spans, shares)).toBe(0);
    expect(playheadAt(1500, spans, shares)).toBe(0.25);
    expect(playheadAt(2250, spans, shares)).toBe(0.625);
    expect(playheadAt(2550, spans, shares)).toBe(0.75); // between two sections: at the end of the first one's clip
    expect(playheadAt(2800, spans, shares)).toBe(0.875);
    expect(playheadAt(9000, spans, shares)).toBe(1);
  });

  it("gives a short section a clip wide enough for its name", () => {
    expect(clipShares([1000, 1000, 2000])).toEqual([0.25, 0.25, 0.5]);
    const shares = clipShares([50, 3000, 3000, 3000]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(shares[0]).toBeGreaterThan(0.07); // 0.5% of the page, drawn as about 8% of the track
    expect(clipShares([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe("page dock styles", () => {
  const css = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };

  it("is a 56 px strip of the editor's Panel Charcoal held at the top of the window, its panel only once folded", () => {
    const dockRule = rule(".h-dock");
    expect(dockRule).toContain("position: fixed;");
    expect(dockRule).toContain("top: 0;");
    expect(dockRule).toContain("right: var(--h-pad);");
    expect(dockRule).toContain("left: var(--h-pad);");
    expect(dockRule).toContain("height: 56px;");
    expect(dockRule).toContain("border-radius: 0 0 12px 12px;");
    expect(dockRule).toContain("pointer-events: none;");
    // Its panel is under its track, and shows once the fold is done (or while it has the focus), and so does the
    // page's black behind it, from one edge of the window to the other, so nothing scrolling under it shows beside it.
    expect(rule(".h-dock::before")).toContain("background: var(--ed-panel);");
    expect(rule(".h-dock::before")).toContain("opacity: 0;");
    const backing = rule(".h-dock::after");
    for (const decl of ["right: calc(-1 * var(--h-pad));", "left: calc(-1 * var(--h-pad));", "bottom: -1px;", "background: #000;", "z-index: -2;", "opacity: 0;"]) {
      expect(backing).toContain(decl);
    }
    expect(css).toMatch(
      /\.h-dock\[data-shown\]::before,\n\.h-dock:focus-within::before,\n\.h-dock\[data-shown\]::after,\n\.h-dock:focus-within::after \{\n\s+opacity: 1;/,
    );
    expect(css).toMatch(/\.h-dock\[data-shown\],\n\.h-dock:focus-within \{\n\s+--morph: 1;\n\s+--taken: 1;\n\s+pointer-events: auto;/);
    // While the timeline folds, its track rides on the timeline's video track (65 px lower). It has the track from
    // the handover on, and its name comes in over the last quarter.
    expect(rule(".h-dockName,\n.h-dockLane")).toContain("translate: 0 calc((1 - var(--fold, 0)) * 65px);");
    expect(rule(".h-dockName")).toContain("opacity: calc(var(--fold, 0) * 4 - 3);");
    expect(css).toMatch(/\n\.h-dockLane \{[^}]*opacity: var\(--taken\);/);
    expect(rule(".h-dock")).toContain("--morph: clamp(0, (var(--fold, 0) - 0.5) * 2, 1);");
    expect(rule(".h-dock")).toContain("--taken: clamp(0, (var(--fold, 0) - 0.5) * 1000 + 1, 1);");
    // Each clip goes from the timeline clip's place to its section's as the clips change over, and the names roll
    // over inside them, the old up and out as the new comes up from below, so the two never lie over each other.
    expect(rule(".h-dockLane > li")).toContain("left: calc(var(--from-left, var(--left)) * (1 - var(--morph)) + var(--left) * var(--morph));");
    expect(rule(".h-dockLane > li")).toContain(
      "width: calc(var(--from-width, var(--width)) * (1 - var(--morph)) + var(--width) * var(--morph));",
    );
    expect(rule(".h-dock")).toContain("--label: clamp(0, (var(--morph) - 0.2) / 0.6, 1);");
    expect(rule(".h-dockClip > span")).toContain("opacity: var(--label);");
    expect(rule(".h-dockClip > span")).toContain("translate: 0 calc((1 - var(--label)) * 20px);");
    expect(rule(".h-dockFrom")).toContain("opacity: calc(1 - var(--label));");
    expect(rule(".h-dockFrom")).toContain("translate: 0 calc(var(--label) * -20px);");
    // Each clip is cut to its own box while it grows in from nothing, but not while its link has the focus.
    expect(rule(".h-dockLane > li")).toContain("clip-path: inset(0 round 4px);");
    expect(rule(".h-dockLane > li:focus-within")).toContain("clip-path: none;");
    // The current clip is drawn as your selection once the dock is the strip, not while it is still the timeline's.
    expect(css).toMatch(
      /\n\.h-dock\[data-shown\] \.h-dockClip\[aria-current\],\n\.h-dock:focus-within \.h-dockClip\[aria-current\] \{\n\s+border-color: var\(--ed-accent\);/,
    );
    expect(css).not.toMatch(/\n\.h-dockClip\[aria-current\] \{/);
    // The playhead is as tall as what shows of the timeline while it folds, and glides only once the dock shows.
    expect(rule(".h-dockPlayhead")).toContain("height: calc(56px + (1 - var(--fold, 0)) * 120px);");
    expect(rule(".h-dockPlayhead")).not.toContain("transition");
    expect(rule(".h-dock[data-shown] .h-dockPlayhead")).toContain("transition: transform 160ms var(--h-ease);");
    // Links reached with Tab stop below it while it shows.
    expect(rule("html:has(.h-dock[data-shown])")).toContain("scroll-padding-top: 72px;");
    // The playhead moves by transform; its box is as wide as the lane.
    expect(rule(".h-dockPlayhead")).toContain("left: var(--names);");
    expect(rule(".h-dockPlayhead")).not.toMatch(/\bleft: calc|\bwidth:/);
  });

  it("folds over as much scroll as the timeline loses, the same number in the page's styles and in the dock", () => {
    expect(rule(".h-page")).toContain(`--h-fold: ${FOLD}px;`);
    expect(css).toContain(`--h-timeline: ${TIMELINE}px;`);
  });

  it("keeps its edge, the current clip and the playhead with the system's high contrast colours", () => {
    // The line is a border, which those colours keep, not a fill, which they replace with the window's background.
    expect(rule(".h-dockPlayhead")).toContain("border-left: 1px solid var(--ed-text);");
    expect(css).not.toContain(".h-dockPlayhead::before");
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).not.toBe(css);
    const block = forced.slice(0, forced.indexOf("\n}\n"));
    expect(block).toMatch(/\.h-dock::before \{\n\s+border: 1px solid CanvasText;/);
    expect(block).toMatch(/\.h-dockClip\[aria-current\] \{\n\s+border: 2px solid Highlight;/);
    expect(block).toMatch(
      /\.h-dockClip\[aria-current\]::before,\n\s+\.h-dockClip\[aria-current\]::after \{\n\s+forced-color-adjust: none;\n\s+background: Highlight;/,
    );
    expect(block).toMatch(/\.h-dockPlayhead::after \{\n\s+forced-color-adjust: none;\n\s+background: CanvasText;/);
  });

  it("comes and goes at once with reduced motion, and its playhead jumps instead of gliding", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    const block = reduced.slice(0, reduced.indexOf("\n}\n"));
    expect(block).toMatch(/\.h-dock,\n\s+\.h-dock \*,\n\s+\.h-dock \*::before,\n\s+\.h-dock \*::after \{\n\s+transition: none !important;/);
    expect(block).toMatch(/\.h-dockName,\n\s+\.h-dockLane \{\n\s+translate: none;/);
  });
});
