"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

// The page's own timeline. The first screen's editor ends with its timeline; once that has scrolled up out of the
// window, a timeline drawn like it docks at the foot of the window: one track with a clip for each section of the
// page, each clip as long as its section is tall, and a playhead that stands where the middle of the window is on
// the page. A click on a clip goes to its section and puts the keyboard there. The clip of the section across the
// middle of the window is marked as the current location, and drawn as your own selection is in the editor. The dock
// goes down again when the end of the page comes up (its closing action, marked data-dock-end, and the footer), so it
// never sits over either. It is the last thing in <main>, held to the foot of the window (home.css), so at the end of
// the page it rests under the last section, above the footer.
// Only on a computer: below 860 px wide the first screen has no timeline and there is no dock. Nothing is drawn on
// the server, so the page's HTML is the same for every window and the first render in the browser matches it.
// The clips are read from the page: each <section> with an id straight inside <main>, after the first screen, in
// page order. A section names its clip with data-dock-label; without one, the clip takes the first sentence of the
// section's heading.

const DESKTOP = "(width > 860px)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
// The line across the window the dock reads the page at: its middle, the same line for the playhead and for which
// section is current.
const MIDDLE = "-50% 0px -50% 0px";
// The window less its top pixel. A first screen whose bottom is exactly on the window's top edge, as it is after a jump
// to the first section, touches the window and would still count as in view; against this line it has gone, while
// one pixel of it showing still counts.
const BELOW_TOP = "-1px 0px 0px 0px";
// No clip is drawn narrower than this share of the track, so a short section still has room for its name.
const MIN_SHARE = 0.08;

type Clip = { id: string; label: string };
// A section's place on the page: how far down the document its top is, and its height, in px.
export type Span = { top: number; height: number };

// Each clip's share of the track: its section's share of the sections' height, but at least MIN_SHARE.
export function clipShares(heights: number[]): number[] {
  const total = heights.reduce((sum, h) => sum + h, 0);
  if (total <= 0) return heights.map(() => 1 / heights.length);
  const floored = heights.map((h) => Math.max(h / total, MIN_SHARE));
  const sum = floored.reduce((a, b) => a + b, 0);
  return floored.map((share) => share / sum);
}

// Where the playhead stands, from 0 (the start of the first clip) to 1 (the end of the last), when the middle of the
// window is `line` px down the document: as far into a clip as the line is into its section. Between two sections it
// waits at the end of the first; above the first it is at the start, and below the last at the end.
export function playheadAt(line: number, spans: Span[], shares: number[]): number {
  let start = 0;
  for (let i = 0; i < spans.length; i++) {
    const { top, height } = spans[i];
    if (line < top) return start;
    if (line < top + height) return start + (shares[i] * (line - top)) / height;
    start += shares[i];
  }
  return Math.min(start, 1);
}

// Where each clip starts along the track, as a share of it.
function offsets(shares: number[]): number[] {
  return shares.map((_, i) => shares.slice(0, i).reduce((sum, share) => sum + share, 0));
}

function sameShares(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((share, i) => Math.abs(share - b[i]) < 0.0005);
}

function headingOf(section: HTMLElement): HTMLElement | null {
  const id = section.getAttribute("aria-labelledby");
  return (id ? document.getElementById(id) : null) ?? section.querySelector<HTMLElement>("h2, h3");
}

// "Ask an agent. Watch it edit." gives "Ask an agent".
function shortName(section: HTMLElement): string {
  const named = section.dataset.dockLabel?.trim();
  if (named) return named;
  const first = headingOf(section)?.textContent?.trim().match(/^[^.!?]+/)?.[0].trim();
  return first || section.id;
}

export function PageDock() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DESKTOP);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop ? <Dock /> : null;
}

function Dock() {
  const nav = useRef<HTMLElement>(null);
  const playhead = useRef<HTMLSpanElement>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [shares, setShares] = useState<number[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  // Whether the first screen, which ends with the editor's timeline, has gone up past the top of the window.
  const [pastHero, setPastHero] = useState(false);
  // Whether the page's closing action or the footer is in the window.
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const main = nav.current?.closest("main");
    if (!main) return;
    const children = [...main.children] as HTMLElement[];
    const hero = children.find((el) => el.classList.contains("h-hero")) ?? null;
    const sections = children.filter((el) => el.tagName === "SECTION" && el.id !== "" && el !== hero);
    setClips(sections.map((section) => ({ id: section.id, label: shortName(section) })));

    // The playhead moves on the next frame after a scroll, by transform only. Where the sections are is measured
    // when something changes size, never while scrolling.
    let spans: Span[] = [];
    let parts: number[] = [];
    let frame = 0;
    const draw = () => {
      frame = 0;
      const at = playheadAt(window.scrollY + window.innerHeight / 2, spans, parts);
      if (playhead.current) playhead.current.style.transform = `translateX(${(at * 100).toFixed(3)}%)`;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };
    const measure = () => {
      const y = window.scrollY;
      spans = sections.map((section) => {
        const box = section.getBoundingClientRect();
        return { top: box.top + y, height: box.height };
      });
      const next = clipShares(spans.map((span) => span.height));
      if (!sameShares(parts, next)) {
        parts = next;
        setShares(next);
      }
      schedule();
    };
    measure();
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    sizes?.observe(main);
    for (const section of sections) sizes?.observe(section);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const watching: IntersectionObserver[] = [];
    if (typeof IntersectionObserver === "function") {
      // The sections across the middle line (one, or two for the moment a boundary is on it: the lower one counts).
      const across = new Set<Element>();
      const middle = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) across.add(entry.target);
            else across.delete(entry.target);
          }
          const inView = sections.filter((section) => across.has(section));
          setCurrent(inView.length > 0 ? inView[inView.length - 1].id : null);
        },
        { rootMargin: MIDDLE },
      );
      for (const section of sections) middle.observe(section);
      watching.push(middle);

      if (hero) {
        const heroWatch = new IntersectionObserver(
          (entries) => {
            const entry = entries[entries.length - 1];
            // Out of view above that line, not below the window.
            setPastHero(!entry.isIntersecting && entry.boundingClientRect.bottom < 1);
          },
          { rootMargin: BELOW_TOP },
        );
        heroWatch.observe(hero);
        watching.push(heroWatch);
      } else {
        setPastHero(true);
      }

      // The end of the page: the closing action, and the footer after <main>. The dock is down while any of them is
      // in the window.
      const footer = document.querySelector("main ~ footer");
      const ends = [...main.querySelectorAll("[data-dock-end]"), ...(footer ? [footer] : [])];
      if (ends.length > 0) {
        const endsInView = new Set<Element>();
        const endWatch = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) endsInView.add(entry.target);
            else endsInView.delete(entry.target);
          }
          setAtEnd(endsInView.size > 0);
        });
        for (const end of ends) endWatch.observe(end);
        watching.push(endWatch);
      }
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      sizes?.disconnect();
      for (const observer of watching) observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // Goes to the section and gives its heading the focus, so that Tab carries on from there. A click that opens a new
  // tab or window is left to the browser.
  function jump(e: MouseEvent<HTMLAnchorElement>, id: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const section = document.getElementById(id);
    if (!section) return;
    e.preventDefault();
    const still = typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
    section.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    const heading = headingOf(section) ?? section;
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    window.history.replaceState(window.history.state, "", `#${id}`);
  }

  const starts = offsets(shares);
  return (
    // Down, it keeps its links, so the keyboard still reaches them after the last section, and it shows in its place
    // under the last section while one of them has focus (home.css). Until the sections are read it has nothing to
    // offer, so it isn't there at all.
    <nav ref={nav} aria-label="Page" className="h-dock" data-ui data-shown={(pastHero && !atEnd) || undefined} hidden={clips.length === 0}>
      <span className="h-dockName" aria-hidden="true">
        On this page
      </span>
      <ol className="h-dockLane">
        {clips.map((clip, i) => {
          const share = shares[i] ?? 1 / clips.length;
          const left = starts[i] ?? i * share;
          return (
            <li key={clip.id} style={{ left: `${left * 100}%`, width: `calc(${share * 100}% - 4px)` }}>
              <a
                href={`#${clip.id}`}
                className="h-dockClip"
                aria-current={current === clip.id ? "location" : undefined}
                onClick={(e) => jump(e, clip.id)}
              >
                <span>{clip.label}</span>
              </a>
            </li>
          );
        })}
      </ol>
      <span ref={playhead} className="h-dockPlayhead" aria-hidden="true" />
    </nav>
  );
}
