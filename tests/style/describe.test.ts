import { describe, expect, it } from "vitest";
import { CHANNEL_DAYS, canTryAgain, channelFactsStale, fillInWaitsFor, lengthWords, profileValueWords, progressWords, referenceFacts, referenceTitle } from "@/lib/style/describe";
import { STYLE_MESSAGES, STYLE_WORDS } from "@/lib/style/messages";
import { CHANNEL_FACTS_DAYS } from "@/lib/style/service";
import { ANALYSIS_LIMITS, type LinkAnalysis, type ProjectAnalysis, type StyleReference, type VideoAnalysis } from "@/lib/style/types";

const shots = (count: number, medianSeconds: number) => ({ count, averageSeconds: medianSeconds, medianSeconds, firstSeconds: medianSeconds, perMinute: 60 / medianSeconds });

function video(over: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return {
    kind: "video",
    seconds: 38,
    width: 1080,
    height: 1920,
    shots: shots(24, 1.6),
    cuts: [],
    speech: { words: 108, perMinute: 170.4, opening: "Okay so", talkingShare: 0.9 },
    sound: null,
    color: { brightness: 0.5, saturation: 0.4, warmth: 0 },
    sheet: null,
    analyzedAt: "2026-11-25T21:00:00.000Z",
    ...over,
  };
}

function project(over: Partial<ProjectAnalysis> = {}): ProjectAnalysis {
  return {
    kind: "project",
    seconds: 42,
    format: "short_9x16",
    fps: 30,
    shots: shots(18, 2.14),
    text: { clips: 0, perMinute: 0, fonts: [], averageWords: 0, sizes: { small: 0, medium: 0, large: 0 } },
    captions: null,
    transitions: { fade: 1, crossfade: 2, slide: 0, zoom: 0, whip: 0, dip: 0 },
    textAnimations: {},
    music: null,
    speedChanges: 0,
    looks: {},
    effects: [],
    ...over,
  };
}

const link = (over: Partial<LinkAnalysis> = {}): LinkAnalysis => ({ kind: "link", provider: "youtube", title: "Paper planes", fetchedAt: "2026-11-25T21:00:00.000Z", ...over });

function reference(over: Partial<StyleReference> = {}): StyleReference {
  return { id: "r1", kind: "video", title: "Match day recap", status: "ready", analysis: video(), hasSheet: true, createdAt: "2026-11-25T21:00:00.000Z", ...over };
}

// The facts as they read: the spaces that never break a line are spaces to a reader.
const NB = "\u00a0";
const read = (text: string | null) => text?.replaceAll(NB, " ") ?? null;
const facts = (over: Partial<StyleReference> = {}) => read(referenceFacts(reference(over)));

describe("a reference's line of facts", () => {
  it("says how long a video runs, how it's cut and how fast it talks", () => {
    expect(facts()).toBe("38 s · 24 shots, about 1.6 s each · talks 170 words a minute");
    expect(facts({ analysis: video({ speech: { words: 0, perMinute: 0, opening: "", talkingShare: 0 } }) })).toBe("38 s · 24 shots, about 1.6 s each · no talking");
    expect(facts({ analysis: video({ seconds: 125, speech: null, shots: shots(1, 12.4) }) })).toBe("2 min 5 s · 1 shot");
  });

  it("keeps each number with its unit, and each dot with the fact before it, when the line wraps", () => {
    // The line may break only at an ordinary space: after a dot, or between words that aren't a number and its unit.
    const breaks = (text: string | null) => (text ?? "").split(" ");
    expect(breaks(referenceFacts(reference()))).toEqual([`38${NB}s${NB}·`, `24${NB}shots,`, "about", `1.6${NB}s${NB}each${NB}·`, "talks", `170${NB}words`, `a${NB}minute`]);
    const youtube = reference({ kind: "link", provider: "youtube", author: "Paper Planes Club", analysis: link({ author: "Paper Planes Club", seconds: 512 }) });
    expect(breaks(referenceFacts(youtube))).toEqual([`YouTube${NB}·`, "Paper", "Planes", `Club${NB}·`, `8${NB}min${NB}32${NB}s`]);
    expect(breaks(referenceFacts(reference({ kind: "project", analysis: project() })))).toContain(`3${NB}transitions`);
  });

  it("says nothing for a video not looked at yet", () => {
    expect(referenceFacts(reference({ status: "pending", analysis: null, hasSheet: false }))).toBeNull();
  });

  it("names a link's site and author, and its length when the site gave one", () => {
    expect(facts({ kind: "link", provider: "youtube", author: "Paper Planes Club", analysis: link({ author: "Paper Planes Club" }) })).toBe("YouTube · Paper Planes Club");
    expect(facts({ kind: "link", provider: "youtube", analysis: link({ short: true, seconds: 31 }) })).toBe("YouTube Short · 31 s");
    expect(facts({ kind: "link", provider: "vimeo", analysis: link({ provider: "vimeo" }) })).toBe("Vimeo");
    expect(facts({ kind: "link", provider: "channel", analysis: link({ provider: "channel" }) })).toBe("Your YouTube channel");
  });

  it("says kindly when a link's details couldn't be read", () => {
    expect(referenceFacts(reference({ kind: "link", provider: "tiktok", analysis: link({ provider: "tiktok", unreadable: true }) }))).toBe(STYLE_MESSAGES.linkUnreadable);
  });

  it("counts a project's shots and transitions, and whether it has captions", () => {
    expect(facts({ kind: "project", analysis: project() })).toBe("Project · 42 s · 18 shots, about 2.1 s each · 3 transitions");
    const plain = project({ transitions: { fade: 0, crossfade: 0, slide: 0, zoom: 0, whip: 0, dip: 0 }, captions: { look: "karaoke", uppercase: false, y: 0.8 } });
    expect(facts({ kind: "project", analysis: plain })).toBe("Project · 42 s · 18 shots, about 2.1 s each · straight cuts · captions");
  });
});

describe("a reference's title", () => {
  const unread = (url: string, over: Partial<StyleReference> = {}) =>
    reference({ kind: "link", title: url, url, analysis: link({ title: url, unreadable: true }), hasSheet: false, ...over });

  it("names a link known only by its address by its site, from the address", () => {
    expect(referenceTitle(unread("https://www.tiktok.com/@paperplanesclub/video/7301234567890123456", { provider: "tiktok" }))).toBe("TikTok video from @paperplanesclub");
    expect(referenceTitle(unread("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))).toBe("YouTube video");
    expect(referenceTitle(unread("https://www.youtube.com/shorts/dQw4w9WgXcQ"))).toBe("YouTube Short");
    expect(referenceTitle(unread("https://vimeo.com/76979871", { provider: "vimeo" }))).toBe("Vimeo video");
    // A channel video whose details were cleared after 30 days keeps only its address too.
    expect(referenceTitle(unread("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { provider: "channel" }))).toBe("YouTube video");
  });

  it("keeps a title the site gave, and anything that isn't a link's address", () => {
    expect(referenceTitle(reference({ kind: "link", title: "Paper planes", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }))).toBe("Paper planes");
    expect(referenceTitle(reference())).toBe("Match day recap");
    expect(referenceTitle(reference({ kind: "project", title: "https://example.com is our site" }))).toBe("https://example.com is our site");
    // An address that isn't a video it can name stays as it is.
    expect(referenceTitle(unread("https://example.com/watch/123"))).toBe("https://example.com/watch/123");
  });
});

describe("plain lengths", () => {
  it("reads like a person would say them", () => {
    expect(read(lengthWords(0.4))).toBe("0 s");
    expect(read(lengthWords(38.4))).toBe("38 s");
    expect(read(lengthWords(60))).toBe("1 min");
    expect(read(lengthWords(125))).toBe("2 min 5 s");
    expect(read(lengthWords(3600))).toBe("1 h");
    expect(read(lengthWords(4320))).toBe("1 h 12 min");
  });

  it("never breaks a line inside a length", () => {
    expect(lengthWords(512)).not.toContain(" ");
    expect(lengthWords(4320)).toBe(`1${NB}h${NB}12${NB}min`);
  });
});

describe("progress", () => {
  it("names the step, with how far a counted step has got", () => {
    expect(progressWords({ stage: "waiting", done: 0 })).toBe("Waiting its turn…");
    expect(progressWords({ stage: "shots", done: 0 })).toBe("Looking at the shots…");
    expect(progressWords({ stage: "shots", done: 0.304 })).toBe("Looking at the shots… 30%");
    expect(progressWords({ stage: "listening", done: 0.42 })).toBe("Listening… 42%");
    expect(progressWords({ stage: "saving", done: 0.5 })).toBe("Saving…");
  });
});

describe("a channel video's facts", () => {
  const now = new Date("2026-11-25T21:00:00.000Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it("are kept as long as the server keeps them", () => {
    expect(CHANNEL_DAYS).toBe(CHANNEL_FACTS_DAYS);
    expect(STYLE_WORDS.learn.channelStale).toContain(`${CHANNEL_FACTS_DAYS} days`);
    expect(STYLE_WORDS.channel.note).toContain(`${CHANNEL_FACTS_DAYS} days`);
  });

  it("count as cut back once they're older than that, or of an age that can't be told", () => {
    const channel = (fetchedAt: string) => reference({ kind: "link", provider: "channel", analysis: link({ provider: "channel", fetchedAt }) });
    expect(channelFactsStale(channel(daysAgo(29)), now)).toBe(false);
    expect(channelFactsStale(channel(daysAgo(31)), now)).toBe(true);
    expect(channelFactsStale(reference({ kind: "link", provider: "channel", analysis: null }), now)).toBe(true);
    expect(channelFactsStale(reference({ kind: "link", provider: "youtube", analysis: link({ fetchedAt: daysAgo(90) }) }), now)).toBe(false);
  });
});

describe("a field's value for someone who can only read it", () => {
  it("is in the page's words", () => {
    const profile = {
      summary: "Bright and quick.",
      formats: ["short_9x16", "long_16x9"] as const,
      lengthSeconds: { min: 15, max: 45 },
      pace: "quick" as const,
      shotSeconds: 1.6,
      captions: { on: true, look: "karaoke" as const, uppercase: true, position: "lower" as const },
      music: "upbeat" as const,
      transitionKinds: ["crossfade" as const],
      look: "warm",
      never: ["long intros", "stock music"],
    };
    const words = (key: keyof typeof profile) => profileValueWords(key, { ...profile, formats: [...profile.formats] });
    expect(words("summary")).toBe("Bright and quick.");
    expect(words("formats")).toBe("Shorts, Reels and TikTok, YouTube");
    expect(words("lengthSeconds")).toBe("15 to 45 seconds");
    expect(words("pace")).toBe("Quick: A new shot every 1.2 to 2.5 seconds.");
    expect(words("shotSeconds")).toBe("About 1.6 seconds");
    expect(words("captions")).toBe("On · Karaoke · All caps · Bottom");
    expect(words("music")).toBe("Upbeat: Bright music with energy.");
    expect(words("transitionKinds")).toBe("Crossfade");
    expect(words("look")).toBe("Warm: A warmer, orange tint.");
    expect(words("never")).toBe("long intros; stock music");
    expect(profileValueWords("captions", { captions: { on: false } })).toBe("Off");
    expect(profileValueWords("lengthSeconds", { lengthSeconds: { min: 30, max: 30 } })).toBe("About 30 seconds");
    expect(profileValueWords("hook", {})).toBeNull();
    expect(profileValueWords("always", { always: [] })).toBeNull();
  });
});

describe("why Fill in from my videos waits", () => {
  const F = STYLE_WORDS.form;
  const waiting = reference({ status: "pending", analysis: null, hasSheet: false });
  const failed = reference({ status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.unreadable });

  it("asks for something to learn from when nothing is added", () => {
    expect(fillInWaitsFor([])).toBe(F.fillInFirst);
  });

  it("waits for a video still to be looked at, never asking for one that is there", () => {
    expect(fillInWaitsFor([waiting])).toBe(F.fillInWaiting);
    expect(fillInWaitsFor([failed, waiting])).toBe(F.fillInWaiting);
  });

  it("says so when nothing added could be looked at, rather than to wait for ever", () => {
    expect(fillInWaitsFor([failed])).toBe(F.fillInFailed);
    expect(fillInWaitsFor([failed, reference({ id: "r2", status: "failed", analysis: null, hasSheet: false })])).toBe(F.fillInFailed);
  });

  it("waits for nothing once anything it can read is ready", () => {
    expect(fillInWaitsFor([failed, waiting, reference({ id: "r3" })])).toBeNull();
    expect(fillInWaitsFor([reference({ id: "r4", kind: "link", analysis: link() })])).toBeNull();
  });
});

describe("whether Try again can help", () => {
  const hours = (n: number) => n * 3600 * 1000;

  it("offers it for a failure that may not happen again", () => {
    for (const failure of [STYLE_WORDS.analysisFailed.unreadable, STYLE_WORDS.analysisFailed.unknown, STYLE_WORDS.analysisNotSaved, STYLE_MESSAGES.badAnalysis]) {
      expect(canTryAgain(failure, hours(1))).toBe(true);
      expect(canTryAgain(failure, null)).toBe(true);
    }
  });

  it("doesn't for a video longer than a style looks at, which it always will be", () => {
    expect(canTryAgain(STYLE_WORDS.analysisFailed.tooLong, null)).toBe(false);
    expect(canTryAgain(STYLE_WORDS.analysisFailed.unknown, ANALYSIS_LIMITS.seconds * 1000 + 1)).toBe(false);
    expect(canTryAgain(STYLE_WORDS.analysisFailed.unknown, ANALYSIS_LIMITS.seconds * 1000)).toBe(true);
  });
});

describe("the Style page's words", () => {
  // Every string in STYLE_WORDS, with each wording that takes something filled in with a stand-in.
  function everyLine(value: unknown, key = ""): string[] {
    if (typeof value === "string") return [value];
    // filledSome takes the kinds of reference read; every other wording takes a number or a name.
    if (typeof value === "function" && key === "filledSome") return [String(value(2, ["video", "link", "project"])), String(value(1, ["video"]))];
    if (typeof value === "function") return [String(value(2, 2)), String(value("Ada", 2))];
    if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([name, inner]) => everyLine(inner, name));
    return [];
  }

  it("use no technical words, and no doubled spaces or stray punctuation", () => {
    const JARGON = /oembed|\bmcp\b|contact sheet|histogram|json|\bapi\b|analysis|token|\bnull\b|undefined/i;
    const lines = [...everyLine(STYLE_WORDS), STYLE_WORDS.tryIt.line(null), STYLE_WORDS.form.lastChanged(undefined, "just now")];
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) {
      expect(line).not.toMatch(JARGON);
      expect(line).not.toMatch(/ {2}|\s[.,]|\.\./);
      expect(line.trim()).toBe(line);
    }
  });
});
