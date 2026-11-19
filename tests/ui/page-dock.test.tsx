// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipShares, PageDock, playheadAt } from "@/components/home/page-dock";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

// A page like the home page: the first screen, five sections (the last one named only by its heading, and ending with
// the page's closing action), the dock after them in <main>, then the footer.
function Page() {
  return (
    <div className="h-site">
      <main className="h-page">
        <section className="h-hero" aria-labelledby="home-title">
          <h1 id="home-title">The video editor for AI agents.</h1>
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
          <p data-dock-end>
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

// IntersectionObserver as the page sees it: each test says what crosses into or out of view.
class FakeIntersectionObserver {
  static all: FakeIntersectionObserver[] = [];
  readonly targets: Element[] = [];
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeIntersectionObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets.length = 0;
  }
  takeRecords() {
    return [];
  }
}
// Tells whatever watches `target` that it is now in view or not; `bottom` is where its lower edge is in the window.
function seen(target: Element, isIntersecting: boolean, bottom = 0) {
  for (const watch of FakeIntersectionObserver.all) {
    if (!watch.targets.includes(target)) continue;
    const entry = { target, isIntersecting, boundingClientRect: { bottom } } as unknown as IntersectionObserverEntry;
    act(() => watch.callback([entry], watch as unknown as IntersectionObserver));
  }
}

// Frames wait until a test runs them.
let frames: FrameRequestCallback[] = [];
function runFrames() {
  const now = frames;
  frames = [];
  for (const frame of now) frame(0);
}

beforeEach(() => {
  width = 1440;
  reduce = false;
  mediaListeners.clear();
  FakeIntersectionObserver.all = [];
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
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
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
// The observer watching the sections cross the middle of the window.
const middleWatch = () => FakeIntersectionObserver.all.find((watch) => watch.targets.includes(section("ai")))!;

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
    ]);
    // It is drawn UI, in <main> after the last section, so Tab reaches it once it has been through the page.
    expect(dock().hasAttribute("data-ui")).toBe(true);
    expect(dock().closest("main")).toBeTruthy();
    expect(section("agents").compareDocumentPosition(dock())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("marks the clip of the section across the middle of the window as the current location", () => {
    render(<Page />);
    const current = () => links().filter((a) => a.getAttribute("aria-current") === "location").map((a) => a.textContent);
    expect(middleWatch().options.rootMargin).toBe("-50% 0px -50% 0px");
    expect(current()).toEqual([]);

    seen(section("ai"), true);
    expect(current()).toEqual(["Ask an agent"]);
    seen(section("ai"), false);
    seen(section("free"), true);
    expect(current()).toEqual(["Free"]);
    // For the moment a boundary is on the line both sections touch it; the lower one is the one being read.
    seen(section("teams"), true);
    expect(current()).toEqual(["Teams"]);
    seen(section("free"), false);
    seen(section("teams"), false);
    expect(current()).toEqual([]);
  });

  it("comes up once the first screen has gone past the top of the window", () => {
    render(<Page />);
    const shown = () => dock().hasAttribute("data-shown");
    const hero = document.querySelector(".h-hero")!;
    const heroWatch = FakeIntersectionObserver.all.find((watch) => watch.targets.includes(hero))!;
    // The window less its top pixel: a first screen ending exactly on the window's top edge (as after a jump to the
    // first section) only touches the window, and has gone.
    expect(heroWatch.options.rootMargin).toBe("-1px 0px 0px 0px");
    expect(shown()).toBe(false);

    seen(hero, true, 900); // the editor and its timeline in the window
    expect(shown()).toBe(false);
    seen(hero, false, 1100); // below the window (a page opened scrolled up from the end) still keeps it down
    expect(shown()).toBe(false);
    seen(hero, false, -4); // gone past the top
    expect(shown()).toBe(true);
    seen(hero, true, 1); // one pixel of it back in view
    expect(shown()).toBe(false);
    seen(hero, false, 0); // its bottom on the window's top edge
    expect(shown()).toBe(true);
  });

  it("goes down while the page's closing action or the footer is in the window", () => {
    render(<Page />);
    const shown = () => dock().hasAttribute("data-shown");
    const close = document.querySelector("[data-dock-end]")!;
    const footer = document.querySelector("footer")!;
    seen(document.querySelector(".h-hero")!, false, -4);
    expect(shown()).toBe(true);

    seen(close, true); // the closing action comes up from the foot of the window, before the footer does
    expect(shown()).toBe(false);
    seen(footer, true);
    expect(shown()).toBe(false);
    seen(close, false); // scrolled on until only the footer is in view
    expect(shown()).toBe(false);
    seen(footer, false);
    expect(shown()).toBe(true);
    seen(close, true);
    seen(close, false); // back up, the closing action below the window again
    expect(shown()).toBe(true);
  });

  it("isn't there at all at 860 px wide or less, and comes and goes as the window crosses that width", () => {
    width = 800;
    render(<Page />);
    expect(screen.queryByRole("navigation", { name: "Page" })).toBeNull();
    expect(document.querySelector(".h-dock")).toBeNull();

    resizeTo(1024);
    expect(links()).toHaveLength(5);
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
    // Where each section is with the page at the top, and the window 800 px tall.
    const boxes: Record<string, [number, number]> = {
      ai: [1000, 1000],
      start: [2000, 500],
      free: [2500, 800],
      teams: [3300, 1200],
      agents: [4500, 600],
    };
    const measured = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const [top, height] = boxes[this.id] ?? [0, 0];
      return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top } as DOMRect;
    });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    render(<Page />);

    // 4100 px of sections: the clips take 1000, 500, 800, 1200 and 600 parts of the track, 4 px apart.
    const clipBoxes = links().map((a) => (a.parentElement as HTMLElement).style);
    const percent = (value: string) => Number(/([\d.]+)%/.exec(value)?.[1]);
    [1000, 500, 800, 1200, 600].forEach((part, i) => {
      expect(clipBoxes[i].width).toMatch(/^calc\([\d.]+% - 4px\)$/);
      expect(percent(clipBoxes[i].width)).toBeCloseTo((part / 4100) * 100, 6);
    });
    expect(percent(clipBoxes[2].left)).toBeCloseTo((1500 / 4100) * 100, 6);

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
    expect(playhead.style.transform).toBe(`translateX(${((1900 / 4100) * 100).toFixed(3)}%)`);
    expect(measured.mock.calls.length).toBe(reads); // nothing is measured while scrolling
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

  it("is a 56 px strip of the editor's Panel Charcoal held to the foot of the window, out of the way while down", () => {
    const dockRule = rule(".h-dock");
    // Main's last child, held to the foot of the window: it can't leave main, so it never passes over the footer.
    expect(dockRule).toContain("position: sticky;");
    expect(dockRule).toContain("bottom: 0;");
    // Its own place is in the room main leaves before the footer, which the negative margin gives back.
    expect(dockRule).toContain("margin: 24px var(--h-pad) -80px;");
    expect(rule(".h-page")).toMatch(/padding-bottom: clamp\(80px, 11vw, 140px\);/);
    expect(dockRule).toContain("height: 56px;");
    expect(dockRule).toContain("background: var(--ed-panel);");
    expect(dockRule).toContain("pointer-events: none;");
    expect(dockRule).toMatch(/transition:\s+transform 200ms var\(--h-ease\),\s+opacity 200ms/);
    // Shown, or holding the keyboard's focus; with the focus while it is down, it shows in its own place.
    expect(css).toMatch(/\.h-dock\[data-shown\],\n\.h-dock:focus-within \{[^}]*transform: none;/);
    expect(rule(".h-dock:not([data-shown]):focus-within")).toMatch(/position: relative;\s+border-radius: 12px;/);
    // Links reached with Tab stop above it only while it is up at the foot of the window.
    expect(rule("html:has(.h-dock[data-shown])")).toContain("scroll-padding-bottom: 72px;");
    // The playhead moves by transform; its box is as wide as the lane.
    expect(rule(".h-dockPlayhead")).toContain("left: var(--names);");
    expect(rule(".h-dockPlayhead")).not.toMatch(/\bleft: calc|\bwidth:/);
  });

  it("keeps its edge, the current clip and the playhead with the system's high contrast colours", () => {
    // The line is a border, which those colours keep, not a fill, which they replace with the window's background.
    expect(rule(".h-dockPlayhead")).toContain("border-left: 1px solid var(--ed-text);");
    expect(css).not.toContain(".h-dockPlayhead::before");
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).not.toBe(css);
    const block = forced.slice(0, forced.indexOf("\n}\n"));
    expect(block).toMatch(/\.h-dock \{\n\s+border: 1px solid CanvasText;/);
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
  });
});
