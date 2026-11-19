// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { HeroScene } from "@/components/home/hero-scene";
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

// The home stylesheet's rules, flattened: each rule's selectors and declarations, and the @media it sits in.
type Rule = { selectors: string[]; decls: Map<string, string>; media: string | null };
function cssRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (text: string, media: string | null) => {
    let at = 0;
    while (at < text.length) {
      const open = text.indexOf("{", at);
      if (open < 0) return;
      let close = open + 1;
      for (let depth = 1; depth > 0; close++) depth += text[close] === "{" ? 1 : text[close] === "}" ? -1 : 0;
      const head = text.slice(at, open).trim();
      const body = text.slice(open + 1, close - 1);
      at = close;
      if (head.startsWith("@media")) walk(body, head);
      else if (head.startsWith("@supports") || head.startsWith("@container")) walk(body, media);
      else if (!head.startsWith("@")) {
        const decls = new Map<string, string>();
        for (const decl of body.split(";")) {
          const colon = decl.indexOf(":");
          if (colon > 0) decls.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim().replace(/\s+/g, " "));
        }
        rules.push({ selectors: head.split(",").map((s) => s.trim().replace(/\s+/g, " ")), decls, media });
      }
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""), null);
  return rules;
}

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
    // The scroll-linked entrances end up where they would be once scrolled in, rather than rising as the page scrolls.
    expect(everything?.decls.get("animation-timeline")).toBe("auto !important");
    expect(everything?.decls.has("animation")).toBe(false);
  });

  it("keeps every looping animation off, since a loop has no last frame to land on", () => {
    const loops = rules
      .filter((r) => r.media === null && /\binfinite\b/.test(r.decls.get("animation") ?? ""))
      .flatMap((r) => r.selectors);
    expect(loops.sort()).toEqual([".h-edDot", ".h-marqueeTrack", ".h-uiDot"]);
    const off = reduced.filter((r) => r.decls.get("animation") === "none !important").flatMap((r) => r.selectors);
    for (const loop of loops) expect(off, loop).toContain(`.h-page ${loop}`);
  });

  it("hides both Pause pills, before the page's script has run too", () => {
    const hidden = reduced.filter((r) => r.decls.get("display") === "none").flatMap((r) => r.selectors);
    expect(hidden).toContain(".h-heroPause");
    expect(hidden).toContain(".h-marqueePause");
  });
});

describe("home hero (home.css)", () => {
  const css = readFileSync(join(process.cwd(), "src/components/home/home.css"), "utf8");
  const rules = cssRules(css);

  it("holds every moment in the drawn editor while the hero is paused", () => {
    const held = rules.find((r) => r.selectors.includes(".h-hero[data-paused] .h-ed *"));
    expect(held?.decls.get("animation-play-state")).toBe("paused !important");
    expect(held?.selectors).toContain(".h-hero[data-paused] .h-ed");
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
