import { describe, expect, it } from "vitest";
import { CHANNEL_DAYS, channelFactsStale, lengthWords, profileValueWords, progressWords, referenceFacts } from "@/lib/style/describe";
import { STYLE_MESSAGES, STYLE_WORDS } from "@/lib/style/messages";
import { CHANNEL_FACTS_DAYS } from "@/lib/style/service";
import type { LinkAnalysis, ProjectAnalysis, StyleReference, VideoAnalysis } from "@/lib/style/types";

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

describe("a reference's line of facts", () => {
  it("says how long a video runs, how it's cut and how fast it talks", () => {
    expect(referenceFacts(reference())).toBe("38 s · 24 shots, about 1.6 s each · talks 170 words a minute");
    expect(referenceFacts(reference({ analysis: video({ speech: { words: 0, perMinute: 0, opening: "", talkingShare: 0 } }) }))).toBe("38 s · 24 shots, about 1.6 s each · no talking");
    expect(referenceFacts(reference({ analysis: video({ seconds: 125, speech: null, shots: shots(1, 12.4) }) }))).toBe("2 min 5 s · 1 shot");
  });

  it("says nothing for a video not looked at yet", () => {
    expect(referenceFacts(reference({ status: "pending", analysis: null, hasSheet: false }))).toBeNull();
  });

  it("names a link's site and author, and its length when the site gave one", () => {
    const youtube = reference({ kind: "link", provider: "youtube", author: "Paper Planes Club", analysis: link({ author: "Paper Planes Club" }) });
    expect(referenceFacts(youtube)).toBe("YouTube · Paper Planes Club");
    expect(referenceFacts(reference({ kind: "link", provider: "youtube", analysis: link({ short: true, seconds: 31 }) }))).toBe("YouTube Short · 31 s");
    expect(referenceFacts(reference({ kind: "link", provider: "vimeo", analysis: link({ provider: "vimeo" }) }))).toBe("Vimeo");
    expect(referenceFacts(reference({ kind: "link", provider: "channel", analysis: link({ provider: "channel" }) }))).toBe("Your YouTube channel");
  });

  it("says kindly when a link's details couldn't be read", () => {
    expect(referenceFacts(reference({ kind: "link", provider: "tiktok", analysis: link({ provider: "tiktok", unreadable: true }) }))).toBe(STYLE_MESSAGES.linkUnreadable);
  });

  it("counts a project's shots and transitions, and whether it has captions", () => {
    expect(referenceFacts(reference({ kind: "project", analysis: project() }))).toBe("Project · 42 s · 18 shots, about 2.1 s each · 3 transitions");
    const plain = project({ transitions: { fade: 0, crossfade: 0, slide: 0, zoom: 0, whip: 0, dip: 0 }, captions: { look: "karaoke", uppercase: false, y: 0.8 } });
    expect(referenceFacts(reference({ kind: "project", analysis: plain }))).toBe("Project · 42 s · 18 shots, about 2.1 s each · straight cuts · captions");
  });
});

describe("plain lengths", () => {
  it("reads like a person would say them", () => {
    expect(lengthWords(0.4)).toBe("0 s");
    expect(lengthWords(38.4)).toBe("38 s");
    expect(lengthWords(60)).toBe("1 min");
    expect(lengthWords(125)).toBe("2 min 5 s");
    expect(lengthWords(3600)).toBe("1 h");
    expect(lengthWords(4320)).toBe("1 h 12 min");
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

describe("the Style page's words", () => {
  // Every string in STYLE_WORDS, with each wording that takes something filled in with a stand-in.
  function everyLine(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "function") return [String(value(2, 2)), String(value("Ada", 2))];
    if (typeof value === "object" && value !== null) return Object.values(value).flatMap(everyLine);
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
