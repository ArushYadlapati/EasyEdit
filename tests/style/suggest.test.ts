import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import { mergeSuggestion, suggestStyle } from "@/lib/style/suggest";
import { STYLE_PROFILE_KEYS, StyleProfile, type LinkAnalysis, type ProjectAnalysis, type VideoAnalysis } from "@/lib/style/types";

const shots = (medianSeconds: number, count = 10) => ({ count, averageSeconds: medianSeconds, medianSeconds, firstSeconds: medianSeconds, perMinute: 60 / medianSeconds });

// One of the space's videos, as a browser measured it: 30 s, tall, 2 s shots, nobody talking.
function video(over: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return {
    kind: "video",
    seconds: 30,
    width: 1080,
    height: 1920,
    shots: shots(2),
    cuts: [],
    speech: null,
    sound: null,
    color: { brightness: 0.5, saturation: 0.4, warmth: 0.1 },
    sheet: null,
    analyzedAt: "2026-11-25T21:00:00.000Z",
    ...over,
  };
}
const talking = (share = 0.8, opening = "Okay so today we're making pasta.") => ({ words: 120, perMinute: 160, opening, talkingShare: share });

// A public link: a title and, maybe, a length.
function link(over: Partial<LinkAnalysis> = {}): LinkAnalysis {
  return { kind: "link", provider: "youtube", title: "Match day recap", fetchedAt: "2026-11-25T21:00:00.000Z", ...over };
}

// A past project: 60 s of 9:16 cut every 2 s, with no text, captions, transitions, music or looks.
function project(over: Partial<ProjectAnalysis> = {}): ProjectAnalysis {
  return {
    kind: "project",
    seconds: 60,
    format: "short_9x16",
    fps: 30,
    shots: shots(2, 30),
    text: { clips: 0, perMinute: 0, fonts: [], averageWords: 0, sizes: { small: 0, medium: 0, large: 0 } },
    captions: null,
    transitions: { fade: 0, crossfade: 0, slide: 0, zoom: 0, whip: 0, dip: 0 },
    textAnimations: {},
    music: null,
    speedChanges: 0,
    looks: {},
    effects: [],
    ...over,
  };
}
const transitions = (counts: Partial<ProjectAnalysis["transitions"]>) => ({ ...project().transitions, ...counts });

// The suggestion, checked against what a style may hold.
function suggest(...analyses: (VideoAnalysis | LinkAnalysis | ProjectAnalysis)[]): StyleProfile {
  const style = suggestStyle(analyses);
  expect(StyleProfile.parse(style)).toEqual(style);
  return style;
}

describe("a suggested style", () => {
  it("is empty with nothing to learn from", () => {
    expect(suggest()).toEqual({});
  });

  it("takes its pace and typical shot from the middle of the shot lengths, to 0.1 s", () => {
    expect(suggest(video({ shots: shots(1.4) }), video({ shots: shots(3.3) }), project({ shots: shots(2.14) }))).toMatchObject({ pace: "quick", shotSeconds: 2.1 });
    expect(suggest(video({ shots: shots(1.44) }), video({ shots: shots(1.56) }))).toMatchObject({ pace: "quick", shotSeconds: 1.5 });
    expect(suggest(video({ shots: shots(5) }))).toMatchObject({ pace: "calm", shotSeconds: 5 });
  });

  it("keeps the typical shot inside what a style may hold, and leaves out videos with no shots", () => {
    expect(suggest(video({ shots: shots(0.1) })).shotSeconds).toBe(0.2);
    expect(suggest(video({ seconds: 600, shots: shots(90, 1) })).shotSeconds).toBe(60);
    const none = suggest(video({ shots: { count: 0, averageSeconds: 0, medianSeconds: 0, firstSeconds: 0, perMinute: 0 } }));
    expect(none.pace).toBeUndefined();
    expect(none.shotSeconds).toBeUndefined();
  });

  it("takes the typical length from the shortest and longest, to 5 seconds", () => {
    expect(suggest(video({ seconds: 22 }), video({ seconds: 41 }), link({ seconds: 38 })).lengthSeconds).toEqual({ min: 20, max: 45 });
    expect(suggest(video({ seconds: 30 })).lengthSeconds).toEqual({ min: 30, max: 30 });
    expect(suggest(video({ seconds: 3 })).lengthSeconds).toEqual({ min: 1, max: 5 });
    expect(suggest(link()).lengthSeconds).toBeUndefined(); // a link with no length
  });

  it("uses the middle half of the lengths once there are four or more, so one odd video doesn't stretch it", () => {
    const style = suggest(...[10, 20, 30, 40, 200].map((seconds) => video({ seconds })));
    expect(style.lengthSeconds).toEqual({ min: 20, max: 40 });
  });

  it("says where they post from the projects' formats, the videos' shapes and links to tall clips, most used first", () => {
    const style = suggest(
      project({ format: "short_9x16" }),
      project({ format: "custom" }),
      video({ width: 1080, height: 1920 }),
      video({ width: 1080, height: 1350 }),
      video({ width: 1920, height: 1080 }),
      link({ short: true }),
      link({ short: false }),
    );
    expect(style.formats).toEqual(["short_9x16", "feed_4x5", "long_16x9"]);
    expect(suggest(video({ width: 1000, height: 1000 }), video({ width: 1080, height: 1080 })).formats).toEqual(["square_1x1"]);
    expect(suggest(link()).formats).toBeUndefined();
  });

  it("turns captions on in the projects' most used look, with their caps and place", () => {
    const style = suggest(
      project({ captions: { look: "karaoke", uppercase: true, y: 0.8 } }),
      project({ captions: { look: "karaoke", uppercase: true, y: 0.75 } }),
      project({ captions: { look: "bar", uppercase: false, y: 0.5 } }),
      project(),
    );
    expect(style.captions).toEqual({ on: true, look: "karaoke", uppercase: true, position: "lower" });
    expect(suggest(project({ captions: { look: "word", uppercase: false, y: 0.2 } })).captions).toEqual({ on: true, look: "word", uppercase: false, position: "upper" });
  });

  it("turns captions on when most videos have talking and no project shows a caption look", () => {
    expect(suggest(video({ speech: talking() }), video({ speech: talking() }), video()).captions).toEqual({ on: true });
    expect(suggest(video({ speech: talking() }), project()).captions).toEqual({ on: true });
    expect(suggest(video({ speech: talking(0.3) }), video()).captions).toBeUndefined(); // a few words isn't talking
    expect(suggest(video({ speech: talking() }), video()).captions).toBeUndefined(); // half isn't most
    expect(suggest(project()).captions).toBeUndefined();
  });

  it("says they start talking straight away when most videos have talking, with the first words of the first one", () => {
    const style = suggest(video({ speech: talking(0.8, "Hi, I'm Sam.") }), video(), video({ speech: talking() }));
    expect(style.hook).toBe(`Starts talking straight away: "Hi, I'm Sam."`);
    expect(suggest(video({ speech: talking() }), video()).hook).toBeUndefined();
    expect(suggest(project()).hook).toBeUndefined();
  });

  it("cuts long first words at a word to fit how they open", () => {
    const opening = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" "); // 199 characters
    const hook = suggest(video({ speech: talking(0.8, opening) })).hook!;
    expect(hook.length).toBeLessThanOrEqual(LIMITS.styleShortTextChars);
    expect(hook).toMatch(/^Starts talking straight away: "word0 word1 .* word\d+…"$/);
    // One first word too long to fit leaves the words out.
    expect(suggest(video({ speech: talking(0.8, "x".repeat(190)) })).hook).toBe("Starts talking straight away");
  });

  it("says how many transitions there are from how many of the projects' shots have one, and names the three kinds used most", () => {
    // Each project has 30 shots.
    expect(suggest(project(), project()).transitions).toBe("cuts");
    expect(suggest(project({ transitions: transitions({ fade: 1 }) })).transitions).toBe("cuts"); // 1 shot in 30
    expect(suggest(project({ transitions: transitions({ fade: 2 }) })).transitions).toBe("few"); // 1 in 15
    expect(suggest(project({ transitions: transitions({ fade: 2 }) }), project(), project()).transitions).toBe("cuts"); // 1 in 45
    expect(suggest(project({ transitions: transitions({ fade: 15 }) })).transitions).toBe("few"); // half isn't most
    expect(suggest(project({ transitions: transitions({ fade: 16 }) })).transitions).toBe("lots");
    // Fast cuts with 3 transitions a minute is still mostly cuts; slow shots with as many have one between most.
    expect(suggest(project({ shots: shots(1, 60), transitions: transitions({ whip: 3 }) })).transitions).toBe("few");
    expect(suggest(project({ shots: shots(10, 6), transitions: transitions({ crossfade: 4 }) })).transitions).toBe("lots");
    const lots = suggest(project({ transitions: transitions({ fade: 2, whip: 4, zoom: 8, slide: 4, dip: 0 }) }));
    expect(lots.transitions).toBe("lots");
    // Zoom most, then whip and slide (equal, in the editor's order); fade is fourth.
    expect(lots.transitionKinds).toEqual(["zoom", "slide", "whip"]);
    expect(suggest(project()).transitionKinds).toBeUndefined();
    expect(suggest(video()).transitions).toBeUndefined();
  });

  it("says nothing of how many transitions there are when the projects have no shots, but still names the kinds", () => {
    const empty = { count: 0, averageSeconds: 0, medianSeconds: 0, firstSeconds: 0, perMinute: 0 };
    const style = suggest(project({ shots: empty, transitions: transitions({ fade: 2 }) }));
    expect(style.transitions).toBeUndefined();
    expect(style.transitionKinds).toEqual(["fade"]);
  });

  it("takes the color look the projects use most, else natural", () => {
    expect(suggest(project({ looks: { warm: 3, mono: 1 } }), project({ looks: { mono: 1 } })).look).toBe("warm");
    expect(suggest(project({ looks: { warm: 2 } }), project({ looks: { cool: 2 } })).look).toBe("warm"); // equal: the editor's order
    expect(suggest(project({ looks: { nolook: 9 } })).look).toBe("natural");
    expect(suggest(project()).look).toBe("natural");
    expect(suggest(video()).look).toBeUndefined();
  });

  it("says how much on-screen text there is from the projects' text clips a minute", () => {
    const withText = (clips: number) => project({ text: { ...project().text, clips } });
    expect(suggest(withText(0)).text).toBe("none");
    expect(suggest(withText(5)).text).toBe("light");
    expect(suggest(withText(6)).text).toBe("lots");
    expect(suggest(withText(6), withText(0)).text).toBe("light"); // 6 over 2 minutes
    expect(suggest(video()).text).toBeUndefined();
  });

  it("says what music the projects have, soft when it's quiet on average, and never picks intense", () => {
    expect(suggest(project(), project()).music).toBe("none");
    expect(suggest(project({ music: { clips: 1, averageVolume: 0.3 } })).music).toBe("soft");
    expect(suggest(project({ music: { clips: 1, averageVolume: 0.35 } })).music).toBe("soft");
    expect(suggest(project({ music: { clips: 1, averageVolume: 1 } })).music).toBe("upbeat");
    // Weighed by clips: 3 at 0.2 and 1 at 0.8 is 0.35 on average.
    expect(suggest(project({ music: { clips: 3, averageVolume: 0.2 } }), project({ music: { clips: 1, averageVolume: 0.8 } })).music).toBe("soft");
    expect(suggest(project({ music: { clips: 4, averageVolume: 4 } })).music).not.toBe("intense");
    expect(suggest(video()).music).toBeUndefined();
  });

  it("leaves the words for people to write", () => {
    const style = suggest(video({ speech: talking() }), project({ captions: { look: "karaoke", uppercase: false, y: 0.8 } }), link({ seconds: 40, short: true }));
    for (const key of ["summary", "voice", "always", "never"] as const) expect(style[key]).toBeUndefined();
  });
});

describe("filling in from a suggestion", () => {
  const suggestion: StyleProfile = {
    formats: ["short_9x16"],
    lengthSeconds: { min: 20, max: 45 },
    pace: "quick",
    shotSeconds: 1.6,
    hook: `Starts talking straight away: "Okay so today we're making pasta."`,
    captions: { on: true, look: "karaoke" },
    music: "soft",
    look: "natural",
  };

  it("fills only the fields left empty, says which in the Style page's order, and changes nothing else", () => {
    const current: StyleProfile = { summary: "Quick, bright recaps", music: "upbeat", formats: [], hook: "" };
    const { profile, filled } = mergeSuggestion(current, suggestion);
    expect(profile).toEqual({ ...suggestion, summary: "Quick, bright recaps", music: "upbeat" });
    expect(filled).toEqual(["formats", "lengthSeconds", "pace", "shotSeconds", "hook", "captions", "look"]);
    expect(filled).toEqual(STYLE_PROFILE_KEYS.filter((key) => filled.includes(key)));
    expect(current).toEqual({ summary: "Quick, bright recaps", music: "upbeat", formats: [], hook: "" });
  });

  it("fills nothing when everything is set, or when the suggestion is empty", () => {
    expect(mergeSuggestion(suggestion, { ...suggestion, music: "upbeat" })).toEqual({ profile: suggestion, filled: [] });
    expect(mergeSuggestion({ text: "lots" }, {})).toEqual({ profile: { text: "lots" }, filled: [] });
  });

  it("never fills a pace or typical shot that disagrees with the other one the person set", () => {
    expect(mergeSuggestion({ pace: "calm" }, suggestion).profile).not.toHaveProperty("shotSeconds");
    expect(mergeSuggestion({ pace: "quick" }, suggestion).profile.shotSeconds).toBe(1.6);
    expect(mergeSuggestion({ shotSeconds: 6 }, suggestion).profile).not.toHaveProperty("pace");
    expect(mergeSuggestion({ shotSeconds: 2 }, suggestion).profile.pace).toBe("quick");
  });

  it("doesn't share lists or objects with the suggestion", () => {
    const { profile } = mergeSuggestion({}, suggestion);
    expect(profile.formats).not.toBe(suggestion.formats);
    expect(profile.captions).not.toBe(suggestion.captions);
  });
});
