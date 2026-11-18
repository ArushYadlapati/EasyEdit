// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { HeroScene } from "@/components/home/hero-scene";
import { act, render, screen } from "../helpers/dom";

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

const phrase = () => document.querySelector(".h-heroPhrase [data-on]")?.textContent;
const sceneShown = () => document.querySelector<HTMLElement>(".h-hero")?.dataset.scene;
const leavingOverlays = () => document.querySelectorAll(".h-edOverlay[data-leaving]").length;
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("home hero scenes", () => {
  it("with motion allowed, moves to the next scene on its timer, crossfades and plays the new scene's clip", () => {
    stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    expect(phrase()).toBe("for AI agents.");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(played()).toEqual(["ai"]);

    advance(5000); // the first scene lasts 5 s
    expect(phrase()).toBe("for teams.");
    expect(sceneShown()).toBe("team");
    expect(played()).toEqual(["ai", "team"]);
    expect(leavingOverlays()).toBe(1); // the first scene's overlay fades out over the new one
    advance(600);
    expect(leavingOverlays()).toBe(0);

    advance(8500);
    expect(phrase()).toBe("for creators.");
  });

  it("with reduced motion asked for, starts no timer and keeps the first scene, on its poster", () => {
    stubReducedMotion(true);
    render(<HeroScene closedBeta={false} />);
    expect(vi.getTimerCount()).toBe(0);
    const line = document.querySelector(".h-heroLine")?.textContent;

    advance(120_000);
    expect(phrase()).toBe("for AI agents.");
    expect(sceneShown()).toBe("ai");
    expect(document.querySelector(".h-heroLine")?.textContent).toBe(line);
    expect(play).not.toHaveBeenCalled(); // no clip starts, so each video keeps its poster
    // Nothing changes by itself, so there is nothing to pause.
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });

  it("stops on the scene it shows when reduced motion is turned on, and moves on again when it is turned off", () => {
    const motion = stubReducedMotion(false);
    render(<HeroScene closedBeta={false} />);
    advance(5000);
    expect(sceneShown()).toBe("team");
    expect(leavingOverlays()).toBe(1);

    pause.mockClear();
    motion.switchTo(true);
    // The crossfade that was under way still finishes, and every clip stops.
    expect(pause).toHaveBeenCalledTimes(4);
    advance(600);
    expect(leavingOverlays()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();

    advance(60_000);
    expect(sceneShown()).toBe("team");
    expect(phrase()).toBe("for teams.");
    expect(played()).toEqual(["ai", "team"]);

    motion.switchTo(false);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(played()).toEqual(["ai", "team", "team"]); // the shown scene's clip plays again
    advance(8500);
    expect(phrase()).toBe("for creators.");
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
