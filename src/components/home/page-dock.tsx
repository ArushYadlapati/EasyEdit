"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

// The page's own timeline. On a computer the first screen's editor ends with its timeline, and that timeline becomes
// the page's dock: once the editor has gone up past the top of the window the timeline stops there, and as the page
// scrolls on it folds up into one track (home.css). Half way through the fold the dock takes that track over: its
// clips start out as the timeline's own video clips, in their places and with their names, and over the rest of the
// fold they grow and shrink into a clip for each section of the page, each as long as its section is tall, their
// names changing over inside them, and the sections past the timeline's last clip come in at the end of the track;
// its playhead starts where the timeline's stood and moves to where the page is being read. This component draws that track and says how far the fold has gone. A click on a clip goes to its
// section and puts the keyboard there. The clip under the playhead is marked as the current location, and drawn as
// your own selection is in the editor. It is the last thing in <main>, so the keyboard comes to it after the last
// section. Near the end of the page it steps up out of the window, so that nothing of the page's end is ever under it
// (asideFrom).
// Only on a computer: below 860 px wide the first screen has no timeline and there is no dock. Nothing is drawn on
// the server, so the page's HTML is the same for every window and the first render in the browser matches it.
// The clips are read from the page: each <section> with an id straight inside <main>, after the first screen, in
// page order. A section names its clip with data-dock-label; without one, the clip takes the first sentence of the
// section's heading. A section with no id belongs to the clip before it.

const DESKTOP = "(width > 860px)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
// No clip is drawn narrower than this share of the track, so a short section still has room for its name.
const MIN_SHARE = 0.08;
// The first screen's timeline and the dock, in px (home.css: --h-timeline, the dock's height, and --h-fold, which is
// the difference). The first screen ends a fold's length after its timeline, so while its foot is between those two
// lengths from the window's top the timeline is held there and folding.
export const TIMELINE = 176;
export const DOCK = 56;
export const FOLD = TIMELINE - DOCK;
// How far into the fold the dock takes the timeline's video track and playhead over (home.css swaps them there too).
export const HANDOVER = 0.5;
// How near a heading may come to the dock's foot, in px, before the dock steps aside for the page's end.
export const CLEAR = 48;

// For a section heading `heading` px down the document, in a section whose foot is `foot` px down, on a page that
// scrolls at most `last` px: how far down the page is scrolled once that heading has come nearer than CLEAR to the
// dock's foot, or null if the page can't scroll that far. The page's end starts at the last heading that can come
// that near, of the sections the last screen still shows below the dock: from there the page only ends, so from
// there on the dock is out of the window, up to the end, and nothing of the end is ever under it, at rest or on the
// way there. A section that has gone up past the dock by the end (null here too) is the page's middle, and the dock
// stays over it as it passes: on a tall window the last screen can start in the room above the agents' heading,
// with nothing under the dock, and the Teams section before it doesn't send the dock away. A link to a heading's
// section puts the section's top on the dock's foot and its heading a section's room below it, so the dock is still
// there when the link lands.
export function asideFrom(heading: number, foot: number, last: number): number | null {
  if (foot <= last + DOCK) return null;
  const from = heading - DOCK - CLEAR;
  return from < last ? from : null;
}

// How far the fold has gone, from 0 (the timeline whole) to 1 (folded into the dock), when the first screen's foot is
// `bottom` px from the window's top. With reduced motion the timeline isn't held or folded: it scrolls away with the
// page, and the dock is there once all of it has gone past the window's top.
export function foldAt(bottom: number, still: boolean): number {
  if (still) return bottom <= FOLD ? 1 : 0;
  return Math.min(1, Math.max(0, (TIMELINE + FOLD - bottom) / FOLD));
}

// How far the dock's clips have gone from the timeline's video clips to the sections' (0 to 1), at a fold: none
// until the handover, all of it once the fold is done.
export function morphAt(fold: number): number {
  return Math.min(1, Math.max(0, (fold - HANDOVER) / (1 - HANDOVER)));
}

type Clip = { id: string; label: string };
// A section's place on the page: how far down the document its top is, and its height, in px.
export type Span = { top: number; height: number };
// One of the first screen's video clips, as the dock's clips start out: where it starts on the track and how long it
// is, in % of the track as the timeline sets them, its name and its picture.
type Source = { left: number; width: number; name: string; poster: string | null };

// Each clip's share of the track: its section's share of the sections' height, but at least MIN_SHARE.
export function clipShares(heights: number[]): number[] {
  const total = heights.reduce((sum, h) => sum + h, 0);
  if (total <= 0) return heights.map(() => 1 / heights.length);
  const floored = heights.map((h) => Math.max(h / total, MIN_SHARE));
  const sum = floored.reduce((a, b) => a + b, 0);
  return floored.map((share) => share / sum);
}

// The line across the window the dock reads the page at, in px down the document, when the page is scrolled `y` px of
// at most `last`, in a window `height` px tall: the window's middle, until the last half a window of scroll, over
// which it goes on down to the window's foot. At the very end of the page it is past the last section, so the
// playhead has reached the end of the track.
export function readingLine(y: number, height: number, last: number): number {
  const left = Math.max(0, last - y);
  return y + height * Math.max(0.5, 1 - left / height);
}

// Where the playhead stands, from 0 (the start of the first clip) to 1 (the end of the last), when the reading line is
// `line` px down the document: as far into a clip as the line is into its section. Between two sections it waits at
// the end of the first; above the first it is at the start, and below the last at the end.
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

// The way back from playheadAt, for a playhead dragged to `at` (0 to 1): the reading line as far into a section as
// `at` is into its clip. Before the track's start it is the first section's top, after its end the last one's foot.
export function lineAt(at: number, spans: Span[], shares: number[]): number {
  if (spans.length === 0) return 0;
  let start = 0;
  for (let i = 0; i < spans.length; i++) {
    const { top, height } = spans[i];
    if (at <= start || shares[i] <= 0) return top;
    if (at < start + shares[i]) return top + (height * (at - start)) / shares[i];
    start += shares[i];
  }
  const end = spans[spans.length - 1];
  return end.top + end.height;
}

// The way back from readingLine: how far to scroll a window `height` px tall, on a page that scrolls at most `last`
// px, for the reading line to be `line` px down the document. While the line is the window's middle that is half a
// window above it; over the last half a window of scroll the line goes twice as fast as the page.
export function scrollFor(line: number, height: number, last: number): number {
  const middle = line - height / 2;
  const y = middle <= last - height / 2 ? middle : (line + last - height) / 2;
  return Math.min(last, Math.max(0, y));
}

// Which clip the playhead is on: the last section whose top the reading line has passed (between two sections the
// upper one, below the last the last), or -1 while the line is still above the first.
export function currentAt(line: number, spans: Span[]): number {
  let at = -1;
  spans.forEach((span, i) => {
    if (span.top <= line) at = i;
  });
  return at;
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

// The first screen's video clips, from its timeline's video track (their places are set as percentages).
function videoClips(hero: HTMLElement | null): Source[] {
  if (!hero) return [];
  return [...hero.querySelectorAll<HTMLElement>('[data-track="video"] .h-edClip')].map((clip) => ({
    left: Number.parseFloat(clip.style.left) || 0,
    width: Number.parseFloat(clip.style.width) || 0,
    name: clip.textContent?.trim() ?? "",
    poster: clip.querySelector("img")?.getAttribute("src") ?? null,
  }));
}

// Where the first screen's own playhead stands along its video track, from 0 to 1, or null when it can't be read.
function heroPlayhead(hero: HTMLElement): number | null {
  const line = hero.querySelector(".h-edPlayhead")?.getBoundingClientRect();
  const lane = hero.querySelector('[data-track="video"] .h-edLane')?.getBoundingClientRect();
  if (!line || !lane || lane.width <= 0) return null;
  return Math.min(1, Math.max(0, (line.left - lane.left) / lane.width));
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
  const [sources, setSources] = useState<Source[]>([]);
  const [shares, setShares] = useState<number[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  // Whether the first screen's timeline has folded all the way into the dock, so the dock is the whole strip.
  const [shown, setShown] = useState(false);
  // Whether it has stepped up out of the window for the page's end.
  const [aside, setAside] = useState(false);
  const grip = useRef<HTMLSpanElement>(null);
  // Whether its playhead is held and being dragged.
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const main = nav.current?.closest("main");
    if (!main) return;
    const children = [...main.children] as HTMLElement[];
    const hero = children.find((el) => el.classList.contains("h-hero")) ?? null;
    // Every section after the first screen, each with the clip it belongs to: its own, or the one before it.
    const owner = new Map<HTMLElement, HTMLElement>();
    let last: HTMLElement | null = null;
    for (const el of children) {
      if (el.tagName !== "SECTION" || el === hero) continue;
      if (el.id !== "") last = el;
      if (last) owner.set(el, last);
    }
    const everySection = [...owner.keys()];
    const sections = everySection.filter((el) => owner.get(el) === el);
    setClips(sections.map((section) => ({ id: section.id, label: shortName(section) })));
    setSources(videoClips(hero));
    const motion = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION) : null;

    // On the next frame after a scroll: how far the fold has gone, written as --fold on the first screen and on the
    // dock (only when it changes), the playhead, moved by transform, and the current clip. Where the first screen and
    // the sections are, and how tall the page is, is measured when something changes size, never while scrolling.
    let spans: Span[] = [];
    let parts: number[] = [];
    let heroBottom = 0;
    let pageHeight = 0;
    // From how far down the page the dock is out of the window for its end (asideFrom), or null.
    let asideAt: number | null = null;
    let folded = -1;
    // Where the first screen's playhead stood when the dock took it over, as a share of the track.
    let from: number | null = null;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const fold = hero ? foldAt(heroBottom - window.scrollY, motion?.matches ?? false) : 1;
      // Part way through the fold, from the handover on. The moment the dock comes into that part, from either side,
      // it reads where the first screen's playhead is, which the dock's then starts from.
      const between = (f: number) => f >= HANDOVER && f < 1;
      if (between(fold) && !between(folded)) from = hero ? heroPlayhead(hero) : null;
      if (fold !== folded) {
        folded = fold;
        const value = fold.toFixed(4);
        hero?.style.setProperty("--fold", value);
        nav.current?.style.setProperty("--fold", value);
        setShown(fold >= 1);
      }
      const line = readingLine(window.scrollY, window.innerHeight, pageHeight - window.innerHeight);
      const reading = playheadAt(line, spans, parts);
      // While the clips change over, the playhead has gone as far from where the timeline's stood to where the page
      // is read as they have; with one of its links focused the dock shows whole, and the playhead with it.
      const focused = nav.current?.contains(document.activeElement) ?? false;
      const at = between(fold) && from !== null && !focused ? from + (reading - from) * morphAt(fold) : reading;
      if (playhead.current) playhead.current.style.transform = `translateX(${(at * 100).toFixed(3)}%)`;
      const on = currentAt(line, spans);
      setCurrent(on >= 0 ? sections[on].id : null);
      // While its playhead is held it stays in the window, even dragged to the page's end, and steps aside once let go.
      setAside(!held && fold >= 1 && asideAt !== null && window.scrollY > asideAt);
    };
    // Its playhead can be held, by the grip on its line, and dragged along the track: the page scrolls at once to where
    // the playhead would stand there (lineAt, then scrollFor), so it stays under the pointer. Dragged to the track's
    // start it goes no further up than where the dock shows (the first screen's foot, folded), and to its end, to the
    // page's end.
    let held = false;
    const dragTo = (clientX: number) => {
      const lane = nav.current?.querySelector(".h-dockLane")?.getBoundingClientRect();
      if (!lane || lane.width <= 0) return;
      const at = (clientX - lane.left) / lane.width;
      const last = pageHeight - window.innerHeight;
      const still = motion?.matches ?? false;
      const top = hero ? heroBottom - (still ? FOLD : TIMELINE) : 0;
      const y = at >= 1 ? last : scrollFor(lineAt(at, spans, parts), window.innerHeight, last);
      window.scrollTo({ top: Math.round(Math.min(last, Math.max(top, y))), behavior: "instant" });
    };
    const hold = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      grip.current?.setPointerCapture(event.pointerId);
      held = true;
      setDragging(true);
      dragTo(event.clientX);
    };
    const drag = (event: PointerEvent) => {
      if (held && grip.current?.hasPointerCapture(event.pointerId)) dragTo(event.clientX);
    };
    const letGo = () => {
      if (!held) return;
      held = false;
      setDragging(false);
      schedule();
    };
    const handle = grip.current;
    handle?.addEventListener("pointerdown", hold);
    handle?.addEventListener("pointermove", drag);
    handle?.addEventListener("pointerup", letGo);
    handle?.addEventListener("pointercancel", letGo);
    handle?.addEventListener("lostpointercapture", letGo);
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(draw);
    };
    const measure = () => {
      const y = window.scrollY;
      // To the whole px, as the page scrolls: a link to the first section lands the first screen's foot right where
      // the fold ends, and a fraction of a px left over would leave the fold just short of done.
      if (hero) heroBottom = Math.round(hero.getBoundingClientRect().bottom + y);
      pageHeight = document.documentElement.scrollHeight;
      // A clip runs from its section's top to the foot of the last section it holds.
      spans = sections.map((section) => {
        const box = section.getBoundingClientRect();
        const held = everySection.filter((el) => owner.get(el) === section);
        const bottom = Math.max(box.bottom, ...held.map((el) => el.getBoundingClientRect().bottom));
        return { top: box.top + y, height: bottom - box.top };
      });
      const next = clipShares(spans.map((span) => span.height));
      if (!sameShares(parts, next)) {
        parts = next;
        setShares(next);
      }
      // Where the page's end starts: the last section heading that can come up to the dock, of the sections still
      // below it at the end.
      const last = pageHeight - window.innerHeight;
      asideAt = null;
      sections.forEach((section, i) => {
        const heading = headingOf(section);
        const foot = spans[i].top + spans[i].height;
        const at = heading ? asideFrom(heading.getBoundingClientRect().top + y, foot, last) : null;
        if (at !== null) asideAt = Math.max(asideAt ?? at, at);
      });
      schedule();
    };
    measure();
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    sizes?.observe(main);
    if (hero) sizes?.observe(hero);
    for (const section of everySection) sizes?.observe(section);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    motion?.addEventListener("change", schedule);
    const dock = nav.current;
    dock?.addEventListener("focusin", schedule);
    dock?.addEventListener("focusout", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      sizes?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      motion?.removeEventListener("change", schedule);
      dock?.removeEventListener("focusin", schedule);
      dock?.removeEventListener("focusout", schedule);
      handle?.removeEventListener("pointerdown", hold);
      handle?.removeEventListener("pointermove", drag);
      handle?.removeEventListener("pointerup", letGo);
      handle?.removeEventListener("pointercancel", letGo);
      handle?.removeEventListener("lostpointercapture", letGo);
      // Without the dock (a window narrowed to a phone's width) the timeline is whole again.
      hero?.style.removeProperty("--fold");
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
    // Before the fold is done, and while it is out of the window for the page's end, it keeps its links, so the
    // keyboard still reaches them, and it shows while one of them has focus (home.css). Until the sections are read
    // it has nothing to offer, so it isn't there at all.
    <nav
      ref={nav}
      aria-label="Page"
      className="h-dock"
      data-ui
      data-shown={shown || undefined}
      data-aside={aside || undefined}
      data-dragging={dragging || undefined}
      hidden={clips.length === 0}
    >
      <span className="h-dockName" aria-hidden="true">
        On this page
      </span>
      <ol className="h-dockLane">
        {clips.map((clip, i) => {
          const share = shares[i] ?? 1 / clips.length;
          const left = starts[i] ?? i * share;
          // The first screen's video clip this one starts out as. There are fewer of those than sections, so the
          // sections past the last of them start out as nothing at the end of the track and grow in from there as
          // the clips change over, the others making room.
          const source: Source | undefined = sources[i];
          const place: Record<string, string> = { "--left": `${left * 100}%`, "--width": `calc(${share * 100}% - 4px)` };
          if (sources.length > 0) {
            place["--from-left"] = `${source ? source.left : 100}%`;
            place["--from-width"] = `${source ? source.width : 0}%`;
          }
          return (
            <li key={clip.id} style={place as CSSProperties}>
              <a
                href={`#${clip.id}`}
                className="h-dockClip"
                aria-current={current === clip.id ? "location" : undefined}
                onClick={(e) => jump(e, clip.id)}
              >
                <span>{clip.label}</span>
              </a>
              {source && (
                <span className="h-dockFrom" aria-hidden="true">
                  {source.poster && (
                    // eslint-disable-next-line @next/next/no-img-element -- a clip thumbnail in a drawn interface
                    <img src={source.poster} alt="" width={64} height={36} />
                  )}
                  {source.name}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {/* The grip is for a pointer: the clips' links already take the keyboard and a screen reader to each section. */}
      <span ref={playhead} className="h-dockPlayhead" aria-hidden="true">
        <span ref={grip} className="h-dockGrip" title="Drag to scroll the page" />
      </span>
    </nav>
  );
}
