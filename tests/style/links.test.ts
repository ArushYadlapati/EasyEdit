import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/lib/limits";
import { LINK_CHARS, fetchLinkFacts, isThumbnailHost, linkRefusalMessage, parseVideoLink, type VideoLink } from "@/lib/style/links";
import { STYLE_MESSAGES } from "@/lib/style/messages";
import { ANALYSIS_LIMITS, LinkAnalysis } from "@/lib/style/types";
import { isStorableText } from "@/lib/text";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const now = () => NOW;
const FETCHED_AT = NOW.toISOString();

// Characters spelled out, so the test file itself stays plain text.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const BACKSLASH = String.fromCharCode(92);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
const CLAPPER = String.fromCodePoint(0x1f3ac); // two UTF-16 units

const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SHORT = "https://www.youtube.com/shorts/abcDEF12_-x";
const VIMEO = "https://vimeo.com/76979871";
const TIKTOK = "https://www.tiktok.com/@scout2015/video/6718335390845095173";

type Call = { url: string; init: RequestInit | undefined };

// Pretend video sites that answer each request with the next of `answers` (an Error is thrown, the way a fetch that
// can't reach a site throws) and keep what they were asked.
function sites(...answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = answers.shift();
    if (!next) throw new Error("no answer left");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchFn, calls };
}

// The link parseVideoLink reads from a pasted address. The test stops if it is refused.
function link(raw: string): VideoLink {
  const parsed = parseVideoLink(raw);
  if (!parsed.ok) throw new Error(`${raw} was refused: ${parsed.reason}`);
  return parsed;
}

// What a link comes back as when its site told us nothing.
const linkOnly = (provider: VideoLink["provider"], url: string, extra: object = {}) => ({
  kind: "link",
  provider,
  title: url,
  ...extra,
  fetchedAt: FETCHED_AT,
  unreadable: true,
});

// Answers shaped like the sites' real ones (checked live on 2026-11-25).
const youtubeAnswer = {
  title: "Never Gonna Give You Up",
  author_name: "Rick Astley",
  author_url: "https://www.youtube.com/@RickAstleyYT",
  type: "video",
  height: 113,
  width: 200,
  version: "1.0",
  provider_name: "YouTube",
  provider_url: "https://www.youtube.com/",
  thumbnail_height: 360,
  thumbnail_width: 480,
  thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  html: '<iframe width="200" height="113" src="https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed" frameborder="0" allowfullscreen></iframe>',
};

const vimeoAnswer = {
  type: "video",
  version: "1.0",
  provider_name: "Vimeo",
  provider_url: "https://vimeo.com/",
  title: "The New Vimeo Player (You Know, For Videos)",
  author_name: "Vimeo Staff",
  author_url: "https://vimeo.com/staff",
  is_plus: "0",
  account_type: "enterprise",
  html: '<iframe src="https://player.vimeo.com/video/76979871?h=8272103f6e" width="640" height="360" frameborder="0"></iframe>',
  width: 640,
  height: 360,
  duration: 62,
  description: `It may look (mostly) the same on the surface, but under the hood we totally rebuilt our player.${NL}${NL}Here's a quick rundown.`,
  thumbnail_url: "https://i.vimeocdn.com/video/452001751-8216e0571a8b1b1e2f9b4e5d2d0b5c2b-d_640",
  thumbnail_width: 640,
  thumbnail_height: 360,
  upload_date: "2013-10-15 14:08:29",
  video_id: 76979871,
  uri: "/videos/76979871",
};

// TikTok's answer today: no title, author or picture.
const tiktokAnswer = {
  version: "1.0",
  type: "video",
  width: "325",
  height: "578",
  html: '<iframe height="578" width="325" src="https://www.tiktok.com/player/v1/6718335390845095173?embed_from=oembed" frameborder="0" allowfullscreen loading="lazy"></iframe>',
  provider_url: "https://www.tiktok.com",
  provider_name: "TikTok",
  embed_product_id: "6718335390845095173",
  embed_type: "video",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseVideoLink", () => {
  it("reads every shape of YouTube link as the video's one address", () => {
    const watch = { ok: true, provider: "youtube", id: "dQw4w9WgXcQ", url: WATCH, short: false };
    const shapes = [
      WATCH,
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123&index=2",
      "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be",
      "https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch/?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ#comments",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=Ab12Cd34&t=10",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=shared",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ?start=30&rel=0",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      "www.youtube.com/watch?v=dQw4w9WgXcQ",
      "youtu.be/dQw4w9WgXcQ",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "http://youtu.be/dQw4w9WgXcQ",
      "HTTPS://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com:443/watch?v=dQw4w9WgXcQ", // the usual port is no port
      `  ${WATCH}  `,
      `${TAB}${WATCH}${NL}`,
    ];
    for (const raw of shapes) expect(parseVideoLink(raw), raw).toEqual(watch);
  });

  it("knows a Short is a Short", () => {
    const short = { ok: true, provider: "youtube", id: "abcDEF12_-x", url: SHORT, short: true };
    for (const raw of [SHORT, "https://youtube.com/shorts/abcDEF12_-x/", "https://m.youtube.com/shorts/abcDEF12_-x?feature=share", "youtube.com/shorts/abcDEF12_-x"]) {
      expect(parseVideoLink(raw), raw).toEqual(short);
    }
  });

  it("reads Vimeo video links, from the site or the player", () => {
    const vimeo = { ok: true, provider: "vimeo", id: "76979871", url: VIMEO, short: false };
    const shapes = [
      VIMEO,
      "https://www.vimeo.com/76979871",
      "https://vimeo.com/76979871/",
      "https://vimeo.com/76979871?share=copy",
      "https://player.vimeo.com/video/76979871",
      "https://player.vimeo.com/video/76979871?badge=0&autopause=0",
      "https://player.vimeo.com/video/76979871?h=not-a-hash", // a private part that can't be one is left off
      "https://vimeo.com/channels/staffpicks/76979871",
      "vimeo.com/76979871",
      "http://vimeo.com/76979871",
    ];
    for (const raw of shapes) expect(parseVideoLink(raw), raw).toEqual(vimeo);
  });

  it("keeps the private part of an unlisted Vimeo video's link, without which Vimeo says nothing", () => {
    const unlisted = { ok: true, provider: "vimeo", id: "76979871", url: "https://vimeo.com/76979871/8272103f6e", short: false };
    const shapes = [
      "https://vimeo.com/76979871/8272103f6e",
      "https://vimeo.com/76979871/8272103F6E?share=copy",
      "https://vimeo.com/76979871/8272103f6e/",
      "https://player.vimeo.com/video/76979871?h=8272103f6e&badge=0",
    ];
    for (const raw of shapes) expect(parseVideoLink(raw), raw).toEqual(unlisted);
  });

  it("reads TikTok video links, with the name in one case, as tall short clips", () => {
    const tiktok = { ok: true, provider: "tiktok", id: "6718335390845095173", url: TIKTOK, short: true };
    const shapes = [
      TIKTOK,
      "https://tiktok.com/@scout2015/video/6718335390845095173",
      "https://m.tiktok.com/@scout2015/video/6718335390845095173",
      "https://www.tiktok.com/@Scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc",
      "https://www.tiktok.com/@scout2015/video/6718335390845095173/",
      "tiktok.com/@scout2015/video/6718335390845095173",
    ];
    for (const raw of shapes) expect(parseVideoLink(raw), raw).toEqual(tiktok);
    expect(parseVideoLink("https://www.tiktok.com/@the.coach_99/video/7300000000000000001")).toMatchObject({
      ok: true,
      url: "https://www.tiktok.com/@the.coach_99/video/7300000000000000001",
    });
  });

  it("refuses every Instagram link with its own reason", () => {
    const shapes = [
      "https://www.instagram.com/reel/C1a2B3c4D5e/",
      "https://instagram.com/p/C1a2B3c4D5e/",
      "https://www.instagram.com/tv/C1a2B3c4D5e",
      "https://m.instagram.com/reel/C1a2B3c4D5e/?igsh=abc",
      "https://instagr.am/p/C1a2B3c4D5e/",
      "http://www.instagram.com/reel/C1a2B3c4D5e/",
      "instagram.com/reel/C1a2B3c4D5e",
      "https://www.instagram.com/someone/",
    ];
    for (const raw of shapes) expect(parseVideoLink(raw), raw).toEqual({ ok: false, reason: "instagram" });
  });

  it("refuses TikTok's short share links with their own reason", () => {
    const shapes = [
      "https://vm.tiktok.com/ZMabc123/",
      "https://vt.tiktok.com/ZSabc123/",
      "https://www.tiktok.com/t/ZTabc123/",
      "https://tiktok.com/t/ZTabc123",
      "vm.tiktok.com/ZMabc123",
    ];
    for (const raw of shapes) expect(parseVideoLink(raw), raw).toEqual({ ok: false, reason: "tiktok-share" });
  });

  it("refuses links that aren't to a YouTube, Vimeo or TikTok video", () => {
    const shapes = [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/embed/videoseries?list=PL1234567890", // a playlist, eleven characters like an id
      "https://www.youtube.com/embed/live_stream?channel=UCuAXFkgsw1L7xaCfnd5JJOw", // a channel's live stream
      "https://www.youtube-nocookie.com/embed/videoseries?list=PL1234567890",
      "https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ/more",
      "https://www.youtube.com/@RickAstleyYT",
      "https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/watch",
      "https://www.youtube.com/watch?v=",
      "https://www.youtube.com/watch?v=dQw4w9WgXc", // ten characters
      "https://www.youtube.com/watch?v=dQw4w9WgXcQQ", // twelve
      "https://www.youtube.com/watch?v=dQw4w9WgX%21Q",
      "https://www.youtube.com/shorts/",
      "https://www.youtube.com/shorts/abcDEF12_-x/more",
      "https://youtu.be/",
      "https://youtu.be/dQw4w9WgXcQ/extra",
      "https://www.youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://evilyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be.evil.example/dQw4w9WgXcQ",
      "https://www.youtube.com./watch?v=dQw4w9WgXcQ",
      "https://vimeo.com/channels/staffpicks",
      "https://vimeo.com/channels/abcdef", // looks like a private part, but there's no video
      "https://vimeo.com/showcase/1234567",
      "https://vimeo.com/76979871/not-a-hash",
      "https://vimeo.com/76979871/8272103f6e/extra",
      "https://vimeo.com/staff",
      "https://vimeo.com/",
      "https://player.vimeo.com/76979871",
      "https://evil.example/vimeo.com/76979871",
      "https://www.tiktok.com/@scout2015",
      "https://www.tiktok.com/@scout2015/photo/6718335390845095173",
      "https://www.tiktok.com/scout2015/video/6718335390845095173",
      "https://www.tiktok.com/@scout2015/video/abc",
      "https://www.tiktok.com/@scout%2F2015/video/6718335390845095173",
      "https://www.facebook.com/watch/?v=10153231379946729",
      "https://x.com/someone/status/1",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://192.168.0.1/watch?v=dQw4w9WgXcQ",
      "https://localhost/watch?v=dQw4w9WgXcQ",
      "https://[::1]/watch?v=dQw4w9WgXcQ",
    ];
    for (const raw of shapes) expect(parseVideoLink(raw), raw).toEqual({ ok: false, reason: "unsupported" });
  });

  it("refuses what isn't a web link, or has a name, password or port in it", () => {
    const shapes = [
      "",
      "   ",
      "not a link",
      "check this out https://youtu.be/dQw4w9WgXcQ",
      "ftp://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "data:text/html,<p>hi</p>",
      "file:///etc/passwd",
      "mailto:someone@example.com",
      "https://user:secret@www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://user@youtu.be/dQw4w9WgXcQ",
      "https://:secret@vimeo.com/76979871",
      "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
      "https://youtu.be:444/dQw4w9WgXcQ",
      "http://www.youtube.com:443/watch?v=dQw4w9WgXcQ",
      "https://vimeo.com:80/76979871",
      "https://",
      "https://exa mple.com/",
    ];
    for (const raw of shapes) expect(parseVideoLink(raw), JSON.stringify(raw)).toEqual({ ok: false, reason: "invalid" });
    expect(parseVideoLink(42 as unknown as string)).toEqual({ ok: false, reason: "invalid" });
    expect(parseVideoLink(null as unknown as string)).toEqual({ ok: false, reason: "invalid" });
  });

  it(`reads a link of up to ${LINK_CHARS} characters, spaces around it not counted`, () => {
    const longest = `${WATCH}&x=${"a".repeat(LINK_CHARS - WATCH.length - 3)}`;
    expect(longest).toHaveLength(LINK_CHARS);
    expect(parseVideoLink(longest)).toMatchObject({ ok: true, url: WATCH });
    expect(parseVideoLink(`   ${longest}   `)).toMatchObject({ ok: true, url: WATCH });
    expect(parseVideoLink(`${longest}a`)).toEqual({ ok: false, reason: "invalid" });
  });

  it("says what to do instead for each refusal", () => {
    expect(linkRefusalMessage("instagram")).toBe(STYLE_MESSAGES.instagram);
    expect(linkRefusalMessage("tiktok-share")).toBe(STYLE_MESSAGES.tiktokShareLink);
    expect(STYLE_MESSAGES.tiktokShareLink).toContain("/video/");
    expect(linkRefusalMessage("unsupported")).toBe(STYLE_MESSAGES.badLink);
    expect(linkRefusalMessage("invalid")).toBe(STYLE_MESSAGES.badLink);
  });
});

describe("fetchLinkFacts", () => {
  it("keeps a YouTube video's title, author and picture, and nothing else", async () => {
    const { fetchFn, calls } = sites(Response.json(youtubeAnswer));
    const facts = await fetchLinkFacts(link(WATCH), fetchFn, now);
    expect(facts).toEqual({
      kind: "link",
      provider: "youtube",
      title: "Never Gonna Give You Up",
      author: "Rick Astley",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      fetchedAt: FETCHED_AT,
    });
    expect(LinkAnalysis.parse(facts)).toEqual(facts);
    expect(calls[0].url).toBe("https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json");
  });

  it("asks about a Short by its Shorts address and keeps that it's a Short", async () => {
    const { fetchFn, calls } = sites(Response.json({ ...youtubeAnswer, title: "Fastest pit stop" }));
    const facts = await fetchLinkFacts(link(SHORT), fetchFn, now);
    expect(facts).toMatchObject({ title: "Fastest pit stop", short: true });
    expect(new URL(calls[0].url).searchParams.get("url")).toBe(SHORT);
    // A youtu.be link doesn't say whether it's a Short.
    const plain = await fetchLinkFacts(link("https://youtu.be/abcDEF12_-x"), sites(Response.json(youtubeAnswer)).fetchFn, now);
    expect(plain.short).toBeUndefined();
  });

  it("keeps a Vimeo video's length and description too, on one line", async () => {
    const { fetchFn, calls } = sites(Response.json(vimeoAnswer));
    const facts = await fetchLinkFacts(link("https://player.vimeo.com/video/76979871?badge=0"), fetchFn, now);
    expect(facts).toEqual({
      kind: "link",
      provider: "vimeo",
      title: "The New Vimeo Player (You Know, For Videos)",
      author: "Vimeo Staff",
      thumbnailUrl: vimeoAnswer.thumbnail_url,
      seconds: 62,
      description: "It may look (mostly) the same on the surface, but under the hood we totally rebuilt our player. Here's a quick rundown.",
      fetchedAt: FETCHED_AT,
    });
    expect(calls[0].url).toBe("https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871&format=json");
  });

  it("asks about an unlisted Vimeo video with its private part", async () => {
    const { fetchFn, calls } = sites(Response.json(vimeoAnswer));
    const facts = await fetchLinkFacts(link("https://player.vimeo.com/video/76979871?h=8272103f6e"), fetchFn, now);
    expect(facts.title).toBe(vimeoAnswer.title);
    expect(calls[0].url).toBe("https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2F8272103f6e&format=json");
  });

  it("keeps a length only when it's one a video can have, to two places", async () => {
    const cases: [unknown, number | undefined][] = [
      [62.456, 62.46],
      [0.004, undefined],
      [0, undefined],
      [-5, undefined],
      ["62", undefined],
      [ANALYSIS_LIMITS.seconds + 1, undefined],
      [null, undefined],
    ];
    for (const [duration, seconds] of cases) {
      const facts = await fetchLinkFacts(link(VIMEO), sites(Response.json({ ...vimeoAnswer, duration })).fetchFn, now);
      expect(facts.seconds, String(duration)).toBe(seconds);
    }
  });

  it("takes a length and description only from Vimeo", async () => {
    const facts = await fetchLinkFacts(link(WATCH), sites(Response.json({ ...youtubeAnswer, duration: 212, description: "A song." })).fetchFn, now);
    expect(facts.seconds).toBeUndefined();
    expect(facts.description).toBeUndefined();
  });

  it("keeps a TikTok link, a tall short clip, with its address as the title when TikTok says nothing about it", async () => {
    const { fetchFn, calls } = sites(Response.json(tiktokAnswer));
    const facts = await fetchLinkFacts(link(TIKTOK), fetchFn, now);
    expect(facts).toEqual(linkOnly("tiktok", TIKTOK, { short: true }));
    expect(LinkAnalysis.parse(facts)).toEqual(facts);
    expect(calls[0].url).toBe(
      "https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40scout2015%2Fvideo%2F6718335390845095173&format=json",
    );
  });

  it("keeps what TikTok does send, from its own picture servers", async () => {
    const thumbnail = "https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/abc123?x-expires=1700000000&x-signature=xyz";
    const answer = { ...tiktokAnswer, title: "Robot dance #robotics", author_name: "Scout", thumbnail_url: thumbnail };
    const facts = await fetchLinkFacts(link(TIKTOK), sites(Response.json(answer)).fetchFn, now);
    expect(facts).toEqual({
      kind: "link",
      provider: "tiktok",
      title: "Robot dance #robotics",
      author: "Scout",
      thumbnailUrl: thumbnail,
      short: true,
      fetchedAt: FETCHED_AT,
    });
  });

  it("asks only each site's fixed address, with just the link and the format in the query", async () => {
    const cases: [string, string, string][] = [
      [WATCH, "https://www.youtube.com/oembed", WATCH],
      ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&callback=evil&url=https://evil.example", "https://www.youtube.com/oembed", WATCH],
      [SHORT, "https://www.youtube.com/oembed", SHORT],
      ["https://player.vimeo.com/video/76979871", "https://vimeo.com/api/oembed.json", VIMEO],
      ["https://m.tiktok.com/@Scout2015/video/6718335390845095173?format=xml", "https://www.tiktok.com/oembed", TIKTOK],
    ];
    for (const [raw, endpoint, canonical] of cases) {
      const { fetchFn, calls } = sites(Response.json({ title: "A video" }));
      await fetchLinkFacts(link(raw), fetchFn, now);
      expect(calls, raw).toHaveLength(1);
      const asked = new URL(calls[0].url);
      expect(`${asked.origin}${asked.pathname}`, raw).toBe(endpoint);
      expect([...asked.searchParams], raw).toEqual([
        ["url", canonical],
        ["format", "json"],
      ]);
      expect(asked.hash).toBe("");
    }
  });

  it("can't be pointed anywhere else, whatever the link says", async () => {
    const odd: VideoLink = { ok: true, provider: "vimeo", id: "1", url: "https://evil.example/?a=1&format=xml#top", short: false };
    const { fetchFn, calls } = sites(Response.json({}));
    await fetchLinkFacts(odd, fetchFn, now);
    const asked = new URL(calls[0].url);
    expect(asked.origin).toBe("https://vimeo.com");
    expect(asked.pathname).toBe("/api/oembed.json");
    expect([...asked.searchParams]).toEqual([
      ["url", odd.url],
      ["format", "json"],
    ]);
  });

  it("asks nobody about a link whose site isn't one of the three", async () => {
    for (const provider of ["channel", "__proto__", "constructor", "toString"]) {
      const odd = { ok: true, provider, id: "1", url: WATCH, short: false } as unknown as VideoLink;
      const { fetchFn, calls } = sites(Response.json(youtubeAnswer));
      const facts = await fetchLinkFacts(odd, fetchFn, now);
      expect(calls, provider).toHaveLength(0);
      expect(facts.unreadable, provider).toBe(true);
    }
  });

  it("gives up after 8 seconds, never follows a redirect, and sends nothing but the question", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { fetchFn, calls } = sites(Response.json(youtubeAnswer));
    await fetchLinkFacts(link(WATCH), fetchFn, now);
    expect(timeout).toHaveBeenCalledWith(8000);
    const init = calls[0].init;
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect([...new Headers(init?.headers)]).toEqual([["accept", "application/json"]]);
  });

  it("never keeps the embed HTML or anything else the site sends", async () => {
    const answers: [string, object][] = [
      [WATCH, youtubeAnswer],
      [VIMEO, vimeoAnswer],
      [TIKTOK, tiktokAnswer],
    ];
    const allowed = ["kind", "provider", "title", "author", "thumbnailUrl", "seconds", "description", "short", "fetchedAt", "unreadable"];
    for (const [raw, answer] of answers) {
      const facts = await fetchLinkFacts(link(raw), sites(Response.json(answer)).fetchFn, now);
      for (const key of Object.keys(facts)) expect(allowed, `${raw}: ${key}`).toContain(key);
      expect(JSON.stringify(facts), raw).not.toMatch(/<|iframe|blockquote|embed/i);
    }
  });

  it("keeps a picture only from the sites' own image servers, over https", async () => {
    const dropped: unknown[] = [
      "http://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://evil.example/hqdefault.jpg",
      "https://i.ytimg.com.evil.example/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://evil-i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://tiktokcdn.com.evil.example/a.jpg",
      "https://user:pw@i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://i.ytimg.com:8443/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "//i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      `https://i.ytimg.com/${"a".repeat(ANALYSIS_LIMITS.thumbnailChars)}`,
      "",
      42,
      null,
      ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
    ];
    for (const thumbnail_url of dropped) {
      const facts = await fetchLinkFacts(link(WATCH), sites(Response.json({ ...youtubeAnswer, thumbnail_url })).fetchFn, now);
      expect(facts.thumbnailUrl, String(thumbnail_url)).toBeUndefined();
      expect(facts.title).toBe("Never Gonna Give You Up");
      expect(facts.unreadable).toBeUndefined();
    }
  });

  it("puts the site's words on one line, inside their caps, without splitting an emoji", async () => {
    const answer = {
      ...vimeoAnswer,
      title: `  Match day${NL}${TAB}recap${NUL} ${RIGHT_TO_LEFT_OVERRIDE}final${CR}${NL}  `,
      author_name: "a".repeat(150),
      description: `Line one.${CR}${NL}Line two.${" more".repeat(200)}`,
    };
    const facts = await fetchLinkFacts(link(VIMEO), sites(Response.json(answer)).fetchFn, now);
    expect(facts.title).toBe("Match day recap final");
    expect(facts.author).toBe(`${"a".repeat(99)}…`);
    expect(facts.description?.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.descriptionChars);
    expect(facts.description?.startsWith("Line one. Line two. more")).toBe(true);
    expect(facts.description?.endsWith("…")).toBe(true);

    const long = `${"x".repeat(LIMITS.styleShortTextChars - 2)}${CLAPPER}yyy`;
    const cut = await fetchLinkFacts(link(WATCH), sites(Response.json({ ...youtubeAnswer, title: long })).fetchFn, now);
    expect(cut.title).toBe(`${"x".repeat(LIMITS.styleShortTextChars - 2)}…`);
    expect(cut.title.isWellFormed()).toBe(true);
  });

  it("makes text Postgres can't hold into text it can", async () => {
    const body = `{"title":"Half ${BACKSLASH}ud83c an emoji","author_name":"Nul${BACKSLASH}u0000l"}`;
    const facts = await fetchLinkFacts(link(WATCH), sites(new Response(body)).fetchFn, now);
    expect(isStorableText(facts.title)).toBe(true);
    expect(facts.title.startsWith("Half ")).toBe(true);
    expect(facts.author).toBe("Nul l");
  });

  it("leaves out words that are blank or aren't words", async () => {
    const facts = await fetchLinkFacts(link(WATCH), sites(Response.json({ ...youtubeAnswer, title: `  ${NL} `, author_name: 7 })).fetchFn, now);
    expect(facts).toEqual({ kind: "link", provider: "youtube", title: WATCH, thumbnailUrl: youtubeAnswer.thumbnail_url, fetchedAt: FETCHED_AT });
  });

  it("is unreadable when nothing in the answer can be kept", async () => {
    const answer = { title: 12, author_name: "", thumbnail_url: "https://evil.example/a.jpg", html: "<iframe></iframe>" };
    const facts = await fetchLinkFacts(link(WATCH), sites(Response.json(answer)).fetchFn, now);
    expect(facts).toEqual(linkOnly("youtube", WATCH));
  });

  it("reads an answer of up to 64 KB and no more", async () => {
    const answerOf = (bytes: number) => {
      const head = '{"title":"Fits","pad":"';
      const tail = '"}';
      return head + "x".repeat(bytes - head.length - tail.length) + tail;
    };
    const fits = await fetchLinkFacts(link(WATCH), sites(new Response(answerOf(64 * 1024))).fetchFn, now);
    expect(fits).toEqual({ kind: "link", provider: "youtube", title: "Fits", fetchedAt: FETCHED_AT });
    const over = await fetchLinkFacts(link(WATCH), sites(new Response(answerOf(64 * 1024 + 1))).fetchFn, now);
    expect(over).toEqual(linkOnly("youtube", WATCH));
  });

  it("stops reading an answer that never ends", async () => {
    const state = { reads: 0, cancelled: false };
    const chunk = new TextEncoder().encode(" ".repeat(1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.reads += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      },
    });
    const facts = await fetchLinkFacts(link(WATCH), sites(new Response(body)).fetchFn, now);
    expect(facts).toEqual(linkOnly("youtube", WATCH));
    expect(state.cancelled).toBe(true);
    expect(state.reads).toBeLessThanOrEqual(66);
  });

  it("doesn't read an answer that says it's too long", async () => {
    const state = { cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(youtubeAnswer)));
        controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    });
    const answer = new Response(body, { headers: { "content-length": String(100_000) } });
    const facts = await fetchLinkFacts(link(WATCH), sites(answer).fetchFn, now);
    expect(facts).toEqual(linkOnly("youtube", WATCH));
    expect(state.cancelled).toBe(true);
  });

  it("still keeps the link, with nothing logged, when the site can't help", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const failures: [string, () => Response | Error][] = [
      ["can't be reached", () => new TypeError("fetch failed")],
      ["takes too long", () => new DOMException("The operation was aborted due to timeout", "TimeoutError")],
      ["redirects", () => new TypeError("fetch failed", { cause: new Error("unexpected redirect") })],
      ["answers a redirect anyway", () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } })],
      ["says the video is private", () => new Response("Unauthorized", { status: 401 })],
      ["has no such video", () => new Response("Not Found", { status: 404 })],
      ["is down", () => Response.json(youtubeAnswer, { status: 500 })],
      ["says something odd", () => Response.json(youtubeAnswer, { status: 201 })],
      ["answers with a page", () => new Response("<html><body>Hi</body></html>")],
      ["answers with nothing", () => new Response("")],
      ["answers with no body", () => new Response(null)],
      ["answers with a list", () => Response.json([youtubeAnswer])],
      ["answers with words", () => Response.json("Never Gonna Give You Up")],
      ["answers with null", () => Response.json(null)],
      ["answers with half the JSON", () => new Response(JSON.stringify(youtubeAnswer).slice(0, 40))],
    ];
    for (const [what, answer] of failures) {
      const { fetchFn, calls } = sites(answer());
      const facts = await fetchLinkFacts(link(WATCH), fetchFn, now);
      expect(facts, what).toEqual(linkOnly("youtube", WATCH));
      expect(LinkAnalysis.parse(facts)).toEqual(facts);
      expect(calls, what).toHaveLength(1);
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("keeps a Short a Short even when YouTube can't be reached", async () => {
    const facts = await fetchLinkFacts(link(SHORT), sites(new TypeError("fetch failed")).fetchFn, now);
    expect(facts).toEqual(linkOnly("youtube", SHORT, { short: true }));
  });

  it("stamps the time the site was asked", async () => {
    const later = new Date("2026-11-26T08:30:00.000Z");
    const facts = await fetchLinkFacts(link(WATCH), sites(Response.json(youtubeAnswer)).fetchFn, () => later);
    expect(facts.fetchedAt).toBe(later.toISOString());
  });
});

describe("isThumbnailHost", () => {
  it("allows pictures from YouTube's, Vimeo's and TikTok's image servers over https only", () => {
    const allowed = [
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://i.vimeocdn.com/video/452001751-d_640",
      "https://p16-sign-va.tiktokcdn.com/obj/abc.image",
      "https://p19-sign.tiktokcdn-us.com/obj/abc.image",
    ];
    for (const url of allowed) expect(isThumbnailHost(url), url).toBe(true);
    const refused = [
      "http://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "https://i.ytimg.com.evil.example/a.jpg",
      "https://evil.example/i.ytimg.com/a.jpg",
      "https://user:pw@i.vimeocdn.com/a.jpg",
      "https://i.vimeocdn.com:8443/a.jpg",
      "https://tiktokcdn.com/a.jpg",
      "https://www.youtube.com/favicon.ico",
      "javascript:alert(1)",
      "not a link",
      "",
    ];
    for (const url of refused) expect(isThumbnailHost(url), url).toBe(false);
  });
});
