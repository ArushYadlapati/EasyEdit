// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { HeroScene } from "@/components/home/hero-scene";
import { cssRules } from "../helpers/css-rules";
import { act, fireEvent, render, screen } from "../helpers/dom";

// A stand-in for the visitor's reduced-motion setting, which a test can change while the page is open.
function stubReducedMotion(reduce: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: reduce,
    addEventListener: (_: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_: "change", listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", (text: string) => {
    expect(text).toBe("(prefers-reduced-motion: reduce)");
    return query;
  });
  return {
    switchTo(next: boolean) {
      query.matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

let play: MockInstance<HTMLMediaElement["play"]>;
let pause: MockInstance<HTMLMediaElement["pause"]>;
// Which scenes' clips were started, in order (each video carries its scene in data-key).
const played = () => (play.mock.contexts as HTMLVideoElement[]).map((video) => video.dataset.key);

beforeEach(() => {
  vi.useFakeTimers();
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The headline's ending as drawn (its own text, without the author's name tag; deleted to nothing, it holds a
// zero-width space so the line keeps its height), who the tag names, and the tag's colour.
const clip = () => document.querySelector<HTMLElement>(".h-heroClip")!;
const ending = () => clip().firstChild?.nodeValue?.replace("\u200b", "");
const author = () => [document.querySelector(".h-heroTag")?.textContent, clip().dataset.tone];
const typing = () => clip().hasAttribute("data-typing");
const sceneShown = () => document.querySelector<HTMLElement>(".h-hero")?.dataset.scene;
const clipOf = (key: string) => document.querySelector<HTMLVideoElement>(`video[data-key="${key}"]`)!;
const leavingOverlays = () => document.querySelectorAll(".h-edOverlay[data-leaving]").length;
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
// Each keystroke is its own render, so the retyping is stepped through one keystroke at a time; returns what the
// ending showed along the way.
function typeOut() {
  const seen: string[] = [];
  for (let i = 0; i < 100 && typing(); i++) {
    advance(40);
    seen.push(ending() ?? "");
  }
  expect(typing()).toBe(false);
  return seen;
}

describe("home hero scenes", () => {
  it("with motion allowed, moves to the next scene on its timer, crossfades and plays the new scene's clip", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    expect(ending()).toBe("for AI agents.");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(played()).toEqual(["ai"]);

    advance(5000); // the first scene lasts 5 s
    expect(sceneShown()).toBe("team");
    expect(played()).toEqual(["ai", "team"]);
    expect(leavingOverlays()).toBe(1); // the first scene's overlay fades out over the new one
    typeOut();
    expect(ending()).toBe("for teams.");
    expect(leavingOverlays()).toBe(0);

    advance(8500);
    expect(sceneShown()).toBe("creators");
    typeOut();
    expect(ending()).toBe("for creators.");
  });

  it("marks each scene's overlay with its scene, so the vertical scene's lies over the part of the frame it keeps", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    const frame = () => document.querySelector<HTMLElement>(".h-edFrame")!;
    const overlays = () => [...document.querySelectorAll<HTMLElement>(".h-edOverlay")].map((o) => [o.dataset.scene, o.hasAttribute("data-leaving")]);
    expect(overlays()).toEqual([["ai", false]]);
    expect(frame().hasAttribute("data-vertical")).toBe(false);

    // Each keystroke typeOut steps through takes 40 ms of the scene, so the next change lands exactly on its time.
    advance(5000);
    advance(8500 - 40 * typeOut().length);
    expect(sceneShown()).toBe("creators");
    expect(frame().hasAttribute("data-vertical")).toBe(true);
    expect(overlays()).toEqual([
      ["team", true],
      ["creators", false],
    ]);
    advance(5000 - 40 * typeOut().length);
    expect(sceneShown()).toBe("browser");
    expect(frame().hasAttribute("data-vertical")).toBe(false);
    expect(overlays()).toEqual([
      ["creators", true],
      ["browser", false],
    ]);
  });

  it("has the next author retype the ending letter by letter: back to the part the two share, then the rest", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    expect(author()).toEqual(["Claude", "claude"]);
    expect(typing()).toBe(false);

    advance(5000);
    // The teammate takes over at once, from the old ending.
    expect(author()).toEqual(["Sam", "peer"]);
    expect(ending()).toBe("for AI agents.");
    expect(typing()).toBe(true);
    const seen = typeOut();
    expect(seen).toEqual([
      "for AI agents",
      "for AI agent",
      "for AI agen",
      "for AI age",
      "for AI ag",
      "for AI a",
      "for AI ",
      "for AI",
      "for A",
      "for ",
      "for t",
      "for te",
      "for tea",
      "for team",
      "for teams",
      "for teams.",
    ]);
    expect(author()).toEqual(["Sam", "peer"]);

    advance(8500);
    expect(author()).toEqual(["You", "you"]);
    typeOut();
    advance(5000);
    // Nothing in common: deleted to nothing, then typed from the start, and the clip keeps its line meanwhile.
    expect(author()).toEqual(["You", "you"]);
    const across = typeOut();
    expect(across.indexOf("")).toBe("for creators.".length - 1);
    expect(across.slice(-2)).toEqual(["in your browser", "in your browser."]);
    expect(ending()).toBe("in your browser.");
  });

  it("keeps the headline one stable sentence for screen readers, and the retyped ending hidden from them", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    const name = "The video editor for AI agents.";
    expect(screen.getByRole("heading", { level: 1, name })).toBeTruthy();
    // The drawn ending and the author's selection around it are hidden; the selection is a drawn piece of the editor.
    expect(clip().closest('[aria-hidden="true"]')).toBeTruthy();
    expect(clip().querySelector("[data-ui]")?.contains(document.querySelector(".h-heroTag"))).toBe(true);

    advance(5000);
    advance(40);
    expect(typing()).toBe(true);
    expect(screen.getByRole("heading", { level: 1, name })).toBeTruthy();
    typeOut();
    expect(ending()).toBe("for teams.");
    expect(screen.getByRole("heading", { level: 1, name })).toBeTruthy();
  });

  it("holds the scene and the retyping while paused, and carries on when played again", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    advance(5000);
    advance(40);
    advance(40);
    const halfway = ending();
    expect(halfway).toBe("for AI agent");

    const button = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Play" })).toBe(button);
    expect(document.querySelector(".h-hero")?.hasAttribute("data-paused")).toBe(true);
    for (let i = 0; i < 50; i++) advance(400);
    expect(ending()).toBe(halfway);
    expect(sceneShown()).toBe("team");
    expect(played()).toEqual(["ai", "team"]);

    fireEvent.click(button);
    expect(document.querySelector(".h-hero")?.hasAttribute("data-paused")).toBe(false);
    typeOut();
    expect(ending()).toBe("for teams.");
  });

  it("pauses from the editor's own play button, at the start of its timeline's ruler, named for what a press does", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    const button = screen.getByRole("button", { name: "Pause" });
    // The editor's control, not a pill of its own: in the timeline, before its ruler, with an icon for a face.
    const timeline = document.querySelector(".h-hero > .h-edTimeline")!;
    expect(button.parentElement).toBe(timeline);
    expect(button.className).toBe("h-edPlay");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect([button.title, button.hasAttribute("aria-pressed")]).toEqual(["Pause", false]);
    // Everything else in the timeline is decoration; the button is what a screen reader meets there.
    for (const el of timeline.children) if (el !== button) expect(el.getAttribute("aria-hidden"), el.className).toBe("true");
    // The first screen has no other Pause.
    expect(screen.getAllByRole("button")).toEqual([button]);
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Play" })).toBe(button);
    expect(button.title).toBe("Play");
  });

  it("after a Pause partway through a scene, carries on from the same point: the clip where it stopped, the scene for what was left", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    advance(3000);
    clipOf("ai").currentTime = 3; // where the clip has got to
    clipOf("team").currentTime = 6; // where the next clip stopped the last time round

    const button = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(button);
    advance(20_000);
    expect(sceneShown()).toBe("ai");

    fireEvent.click(button);
    expect(played()).toEqual(["ai", "ai"]);
    expect(clipOf("ai").currentTime).toBe(3);
    // The first scene lasts 5 s and 3 s of it had run, so 2 s are left.
    advance(1999);
    expect(sceneShown()).toBe("ai");
    advance(1);
    expect(sceneShown()).toBe("team");
    // A new scene starts its clip from the first frame and gets its full length.
    expect(clipOf("team").currentTime).toBe(0);
    advance(8499);
    expect(sceneShown()).toBe("team");
    advance(1);
    expect(sceneShown()).toBe("creators");
  });

  it("starts each scene's clip from its first frame every time round, not only the first", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    clipOf("ai").currentTime = 4.9;
    advance(5000);
    advance(8500);
    advance(5000);
    advance(4000);
    expect(sceneShown()).toBe("ai");
    expect(played()).toEqual(["ai", "team", "creators", "browser", "ai"]);
    expect(clipOf("ai").currentTime).toBe(0);
  });

  it("with reduced motion asked for, starts no timer and keeps the first scene, its ending whole, and no clip loaded", () => {
    stubReducedMotion(true);
    render(<HeroScene closedBeta={false} />);
    expect(vi.getTimerCount()).toBe(0);

    advance(120_000);
    expect(sceneShown()).toBe("ai");
    // The ending stands as it ends, with its author's selection, and is never retyped.
    expect(ending()).toBe("for AI agents.");
    expect(author()).toEqual(["Claude", "claude"]);
    expect(typing()).toBe(false);
    expect(play).not.toHaveBeenCalled(); // no clip starts, so each video keeps its poster
    // None of the clips is downloaded: no video has a source, only its poster.
    const videos = [...document.querySelectorAll("video")];
    expect(videos).toHaveLength(4);
    for (const video of videos) {
      expect(video.hasAttribute("src")).toBe(false);
      expect(video.getAttribute("poster")).toMatch(/\.webp$/);
    }
    // Nothing changes by itself, so there is nothing to pause.
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });

  it("sends no clip in the page's first HTML, and with motion allowed loads only the shown and the next scene's", () => {
    // Before the page has asked about reduced motion (the server's HTML), there is nothing for the browser to fetch.
    const html = renderToString(<HeroScene closedBeta={false} />);
    expect(html).not.toMatch(/<video[^>]* src=/);
    expect(html.match(/<video[^>]* poster="\/home\/[\w-]+\.webp"/g)).toHaveLength(4);

    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    const videos = [...document.querySelectorAll("video")];
    expect(videos.map((v) => v.getAttribute("src"))).toEqual([
      "/home/scene-friends.mp4",
      "/home/scene-city.mp4",
      "/home/scene-mountain.mp4",
      "/home/scene-wave.mp4",
    ]);
    expect(videos.map((v) => v.getAttribute("preload"))).toEqual(["auto", "auto", "none", "none"]);
  });

  it("stops on the scene it shows when reduced motion is turned on, and moves on again when it is turned off", () => {
    const motion = stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    advance(5000);
    expect(sceneShown()).toBe("team");
    expect(leavingOverlays()).toBe(1);
    advance(40);
    advance(40);
    expect(typing()).toBe(true);

    pause.mockClear();
    motion.switchTo(true);
    // The ending halfway through being retyped shows in full at once; the crossfade that was under way still
    // finishes, and every clip stops.
    expect(ending()).toBe("for teams.");
    expect(typing()).toBe(false);
    expect(pause).toHaveBeenCalledTimes(4);
    advance(600);
    expect(leavingOverlays()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();

    advance(60_000);
    expect(sceneShown()).toBe("team");
    expect(ending()).toBe("for teams.");
    expect(played()).toEqual(["ai", "team"]);

    const editor = document.querySelector(".h-ed");
    motion.switchTo(false);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(played()).toEqual(["ai", "team", "team"]); // the shown scene's clip plays again
    expect(typing()).toBe(false);
    // The scene starts over: a fresh editor, so its moments run from the beginning, with the clip from its first
    // frame and the scene's full length on the clock.
    expect(document.querySelector(".h-ed")).not.toBe(editor);
    expect(clipOf("team").currentTime).toBe(0);
    advance(8499);
    expect(sceneShown()).toBe("team");
    advance(1);
    expect(sceneShown()).toBe("creators");
    typeOut();
    expect(ending()).toBe("for creators.");
  });
});

describe("home page under reduced motion (home.css)", () => {
  const rules = cssRules(readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8"));
  const reduced = rules.filter((r) => r.media === "@media (prefers-reduced-motion: reduce)");

  it("lands each one-off animation on its last frame at once instead of removing it", () => {
    // Removing them would leave both halves of each before/after pair showing in one spot ("Claude is editing…"
    // over "Saved"); jumping to the end shows only the after half, as the scene ends with motion on.
    const everything = reduced.find((r) => r.selectors.includes(".h-page *"));
    expect(everything?.decls.get("animation-duration")).toBe("1ms !important");
    expect(everything?.decls.get("animation-delay")).toBe("0s !important");
    expect(everything?.decls.get("animation-iteration-count")).toBe("1 !important");
    expect(everything?.decls.get("animation-fill-mode")).toBe("both !important");
    expect(everything?.decls.has("animation")).toBe(false);
    // Nothing on the page rises in as it scrolls, so no animation runs on the scroll for this to hold back.
    expect(rules.some((r) => r.decls.has("animation-timeline") || r.decls.has("animation-range"))).toBe(false);
  });

  it("keeps every looping animation off, since a loop has no last frame to land on", () => {
    const loops = rules
      .filter((r) => r.media === null && /\binfinite\b/.test(r.decls.get("animation") ?? ""))
      .flatMap((r) => r.selectors);
    expect(loops.sort()).toEqual([".h-edDot", ".h-marqueeTrack", ".h-uiDot"]);
    const off = reduced.filter((r) => r.decls.get("animation") === "none !important").flatMap((r) => r.selectors);
    for (const loop of loops) expect(off, loop).toContain(`.h-page ${loop}`);
  });

  it("hides the editor's play button and the agents' Pause pill, before the page's script has run too", () => {
    const hidden = reduced.filter((r) => r.decls.get("display") === "none").flatMap((r) => r.selectors);
    expect(hidden).toContain(".h-edPlay");
    expect(hidden).toContain(".h-marqueePause");
    // On a phone the timeline is only the play button's row, so with nothing to play it goes, and the editor ends
    // with its preview.
    const phone = rules.filter((r) => r.media === "@media (max-width: 860px) and (prefers-reduced-motion: reduce)");
    expect(phone.find((r) => r.selectors.includes(".h-edTimeline"))?.decls.get("display")).toBe("none");
    expect(phone.find((r) => r.selectors.includes(".h-ed"))?.decls.get("border-radius")).toBe("12px");
  });
});

describe("home hero (home.css)", () => {
  const css = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
  const rules = cssRules(css);

  it("holds every moment in the drawn editor while the hero is paused", () => {
    const held = rules.find((r) => r.selectors.includes(".h-hero[data-paused] .h-ed *"));
    expect(held?.decls.get("animation-play-state")).toBe("paused !important");
    expect(held?.selectors).toContain(".h-hero[data-paused] .h-ed");
    // The timeline is drawn on its own now, under the editor; its playhead and clips hold too.
    expect(held?.selectors).toContain(".h-hero[data-paused] .h-edTimeline *");
  });

  it("draws the play button as the app's 28 px icon button, its focus ring inside its edge", () => {
    const base = (selector: string) => rules.find((r) => r.media === null && r.selectors.includes(selector))?.decls;
    const play = base(".h-edPlay");
    expect([play?.get("width"), play?.get("height"), play?.get("color")]).toEqual(["28px", "28px", "var(--ed-accent)"]);
    expect(base(".h-hero .h-edPlay:focus-visible")?.get("outline-offset")).toBe("-2px");
    expect(rules.some((r) => r.selectors.includes(".h-heroPause"))).toBe(false);
  });

  it("moves the drawn playhead with a transform rather than its left edge", () => {
    const frames = /@keyframes h-play \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(frames).toContain("transform: translateX(");
    expect(frames).not.toMatch(/\bleft\b/);
    const playhead = rules.find((r) => r.selectors.includes(".h-edPlayhead") && r.media === null);
    expect(playhead?.decls.get("animation")).toBe("h-play 4s linear both");
  });

  it("sets the headline's words in one colour, with the author's colour only on the selection around them", () => {
    const title = rules.filter((r) => r.selectors.some((s) => /^\.h-hero(Title|First|Ending|Clip)(\[|$)/.test(s)));
    for (const rule of title) expect(rule.decls.has("color"), rule.selectors.join(", ")).toBe(false);
    for (const tone of ["peer", "you"]) {
      expect(rules.find((r) => r.selectors.includes(`.h-heroClip[data-tone="${tone}"]`))?.decls.has("--tone")).toBe(true);
    }
    expect(rules.find((r) => r.selectors.includes(".h-heroBox"))?.decls.get("border")).toBe("2px solid var(--tone)");
  });

  it("lets the headline's lines wrap, so wider letter or word spacing shows it on more lines instead of cutting it off", () => {
    // The lines themselves, not the caret drawn after the clip.
    const title = rules.filter((r) => r.selectors.some((s) => /^\.h-hero(Title|First|Ending|Clip)(\[[^\]]*\])?$/.test(s)));
    expect(title.length).toBeGreaterThan(4);
    for (const rule of title) {
      const where = `${rule.selectors.join(", ")} ${rule.media ?? ""}`;
      expect(rule.decls.get("white-space") ?? "", where).not.toMatch(/^(nowrap|pre)$/);
      expect(rule.decls.has("text-wrap-mode"), where).toBe(false);
      // A fixed height would let a wrapped line run into whatever sits under it.
      expect(rule.decls.has("height"), where).toBe(false);
    }
    const base = (selector: string) => rules.find((r) => r.media === null && r.selectors.includes(selector));
    expect(base(".h-heroTitle")?.decls.get("max-width")).toBe("100%");
    expect(base(".h-heroClip")?.decls.get("white-space")).toBe("pre-wrap"); // "for " keeps its space
    expect(base(".h-heroEnding")?.decls.get("min-height")).toBe("1em");
  });

  it("keeps the selection round the ending in place while it is retyped: nothing in it is placed from its right edge", () => {
    const rule = (selector: string) => rules.find((r) => r.media === null && r.selectors.includes(selector))?.decls;
    // The box is a container, so the right-hand pieces can be carried across by its own width.
    expect(rule(".h-heroBox")?.get("container-type")).toBe("inline-size");
    const handles = rules.filter((r) => r.selectors.some((s) => s.startsWith(".h-heroHandle")));
    expect(handles.length).toBe(5);
    for (const handle of handles) expect(handle.decls.has("right"), handle.selectors.join(", ")).toBe(false);
    for (const at of ["tr", "br"]) {
      expect(rule(`.h-heroHandle[data-at="${at}"]`)?.get("left"), at).toBe("-4px");
      expect(rule(`.h-heroHandle[data-at="${at}"]`)?.get("translate"), at).toBe("100cqw 0");
    }
    // The caret is drawn by the box too, at its right end the same way, rather than after the words.
    const caret = rule(".h-heroClip[data-typing] .h-heroBox::after");
    expect(caret?.get("translate")).toBe("100cqw 0");
    expect(caret?.has("right")).toBe(false);
    expect(rules.some((r) => r.selectors.includes(".h-heroClip[data-typing]::after"))).toBe(false);
  });

  it("never lets what happens inside the editor change its size or move its preview", () => {
    const rule = (selector: string) => rules.find((r) => r.media === null && r.selectors.includes(selector))?.decls;
    // The side panels take the height they are given (their contents don't size them) and cut off what runs past it.
    const panels = rules.find((r) => r.media === null && r.selectors.includes(".h-edLeft") && r.selectors.includes(".h-edBody > .h-edRight"));
    expect(panels?.decls.get("contain")).toBe("size");
    expect(panels?.decls.get("overflow")).toBe("hidden");
    // Going vertical cuts the frame's sides away; its box keeps one size.
    expect(rule(".h-edFrame")?.get("clip-path")).toBe("inset(0 var(--cut))");
    expect(rule(".h-edFrame")?.get("transition")).toBe("clip-path 600ms var(--h-ease) 350ms");
    for (const frame of rules.filter((r) => r.selectors.some((s) => s.startsWith(".h-edFrame")))) {
      for (const size of ["width", "height", "aspect-ratio"]) {
        if (frame.selectors.includes(".h-edFrame") && frame.media === null) continue;
        expect(frame.decls.has(size), `${frame.selectors.join(", ")} ${size}`).toBe(false);
      }
    }
    const cut = rule(".h-edFrame[data-vertical]")?.get("--cut");
    expect(cut).toBe("calc(50% * 175 / 256)");
    // What is left is 9:16 at the frame's 16:9 height: 81/256 of its width.
    expect(1 - 2 * ((0.5 * 175) / 256)).toBeCloseTo((9 / 16) * (9 / 16), 10);
    // The vertical scene's overlay lies over exactly that part.
    expect(rule('.h-edOverlay[data-scene="creators"]')?.get("inset")).toBe(`0 ${cut}`);
  });

  it("keeps the band's lead and pills beside the headline on a wide window instead of at its far side", () => {
    const band = rules.find((r) => r.media === null && r.selectors.includes(".h-heroBand"))?.decls;
    expect(band?.get("grid-template-columns")).toBe("auto minmax(0, 30rem)");
    expect(band?.get("justify-content")).toBe("space-between");
    // The page's column: the headline's longer line (7.04em), the most room between the columns, and the side
    // column. The sections keep to it too, on the same left edge.
    expect(band?.get("max-width")).toBe("var(--h-column)");
    const page = rules.find((r) => r.media === null && r.selectors.includes(".h-page"))?.decls;
    expect(page?.get("--h-column")).toBe("calc(var(--h-display) * 7.04 + 176px + 30rem)");
    const section = rules.find((r) => r.media === null && r.selectors.includes(".h-section"))?.decls;
    expect(section?.get("max-width")).toBe("calc(var(--h-column) + 2 * var(--h-pad))");
    expect(section?.has("margin")).toBe(false); // not centred: its left edge is the page's
  });

  it("draws the timeline under the editor on its own, its ruler and first track above the window's foot", () => {
    const rule = (selector: string, media: string | null = null) =>
      rules.find((r) => r.media === media && r.selectors.includes(selector))?.decls;
    // The editor is its top bar and body; the timeline is the hero's third row, as long as the timeline and the fold.
    expect(rule(".h-ed")?.get("grid-template-rows")).toBe("44px minmax(0, 1fr)");
    expect(rule(".h-ed")?.get("border-radius")).toBe("12px 12px 0 0");
    expect(rule(".h-edTimeline")?.get("grid-row")).toBe("3");
    expect(rule(".h-edTimeline")?.get("height")).toBe("var(--h-timeline)");
    expect(rule(".h-edTimeline")?.get("border-radius")).toBe("0 0 12px 12px");
    const hero = rule(".h-hero");
    expect(hero?.get("grid-template-rows")).toBe("auto minmax(340px, 1fr) calc(var(--h-timeline) + var(--h-fold))");
    expect(hero?.get("--h-peek")).toBe("88px"); // the ruler (30), the first track (42) and the next clips' tops
    expect(hero?.get("min-height")).toBe(
      "calc( min(100svh - var(--h-bar), 56vw + 520px - var(--h-timeline)) - var(--h-peek) + var(--h-timeline) + var(--h-fold) )",
    );
    // A phone has room for the ruler's row only: the play button and View as, under the preview, as the app's
    // control row is.
    const phone = "@media (max-width: 860px)";
    expect(rule(".h-hero", phone)?.get("grid-template-rows")).toBe("auto auto auto");
    expect(rule(".h-ed", phone)?.has("border-radius")).toBe(false);
    expect(rule(".h-edTimeline", phone)?.get("height")).toBe("40px");
    const strip = rules.find((r) => r.media === phone && r.selectors.join(", ") === ".h-edTimeline > :not(.h-edPlay, .h-edViewAs)");
    expect(strip?.decls.get("display")).toBe("none");
  });

  it("holds the timeline at the window's top and folds it into one track, only with motion allowed", () => {
    const motion = "@media (width > 860px) and (prefers-reduced-motion: no-preference)";
    const rule = (selector: string) => rules.find((r) => r.media === motion && r.selectors.includes(selector))?.decls;
    const timeline = rule(".h-edTimeline");
    expect(timeline?.get("position")).toBe("sticky");
    expect(timeline?.get("top")).toBe("0");
    // Folded, it is the 56 px band round its video track (its lane 77 px down, so the band from 65), moved up by as
    // much: the dock's place, its lane 12 px down.
    expect(timeline?.get("translate")).toBe("0 calc(var(--fold, 0) * -65px)");
    expect(timeline?.get("clip-path")).toBe(
      "inset(calc(var(--fold, 0) * 65px - 1px) -1px calc(var(--fold, 0) * 55px - 1px) round 0 0 13px 13px)",
    );
    expect(176 - 65 - 55).toBe(56);
    // Its ruler, play button and other tracks go by half way, when the dock takes its video track's clips and its
    // playhead over at once (the dock's are drawn just as they are); the track's name goes over the third quarter, as
    // the dock's comes in over the last.
    const rest = rules.find(
      (r) =>
        r.media === motion &&
        r.selectors.join(", ") ===
          '.h-edTimeline > :is(.h-edViewAs, .h-edPlay, .h-edRuler, [data-track="text"], [data-track="audio"])',
    );
    expect(rest?.decls.get("opacity")).toBe("calc(1 - var(--fold, 0) * 2)");
    const handed = rule('.h-edTimeline > [data-track="video"] > .h-edLane');
    expect(handed?.get("opacity")).toBe("clamp(0, (0.5 - var(--fold, 0)) * 1000, 1)");
    expect(rules.find((r) => r.media === motion && r.selectors.includes(".h-edTimeline > .h-edPlayhead"))?.decls).toBe(handed);
    expect(rule('.h-edTimeline > [data-track="video"] > .h-edTrackName')?.get("opacity")).toBe("calc(3 - var(--fold, 0) * 4)");
    // With the keyboard on its play button the timeline is whole wherever it is held, over the dock (z 20).
    const focused = rule(".h-edTimeline:has(:focus-visible)");
    expect([focused?.get("--fold"), focused?.get("z-index")]).toEqual(["0", "21"]);
    // Nowhere else is it held: without motion it scrolls away with the page.
    const held = rules.filter((r) => r.selectors.includes(".h-edTimeline") && r.decls.get("position") === "sticky");
    expect(held.map((r) => r.media)).toEqual([motion]);
  });

  it("between a phone and a laptop, drops the media panel and makes the editor as tall as its preview needs", () => {
    const phone = rules.find((r) => r.selectors.includes(".h-edLeft") && r.media?.includes("max-width: 860px"));
    expect(phone?.decls.get("display")).toBe("none");
    const middle = rules.filter((r) => r.media === "@media (860px < width <= 1180px)");
    const rule = (selector: string) => middle.find((r) => r.selectors.includes(selector));
    expect(rule(".h-edLeft")?.decls.get("display")).toBe("none");
    // Two columns, the preview and Activity, and a height that follows the preview's width at 16:9.
    expect(rule(".h-edBody")?.decls.get("grid-template-columns")).toBe("minmax(0, 1fr) var(--side)");
    expect(rule(".h-edBody")?.decls.get("height")).toMatch(/^min\( calc\(\(100cqw - var\(--side\) - 48px\) \* 9 \/ 16 \+ 48px\)/);
    expect(rule(".h-ed")?.decls.get("container-type")).toBe("inline-size");
    // The first screen grows to fit the editor rather than holding it at the window's height.
    expect(rule(".h-hero")?.decls.get("min-height")).toBe("0");
  });
});
