import { LIMITS } from "@/lib/limits";
import { withSuffix } from "@/lib/text";
import { STYLE_MESSAGES } from "./messages";
import { ANALYSIS_LIMITS, LinkAnalysis, type LinkProvider, thumbnailAddress } from "./types";

// Public video links a style can learn from: reading what someone pasted, and asking the video's site for its public
// title, author and picture. Nothing is ever downloaded. Only three fixed addresses are ever called, one per site, with
// the link in the query, so a pasted link can't send the server anywhere else. The page may use the parts that don't
// fetch, to check a link as it's typed.

// The longest link, in characters, that is read at all.
export const LINK_CHARS = 500;

// The sites a pasted link can be on. (A link from the space's connected channel is the fourth provider, "channel".)
export type VideoProvider = Exclude<LinkProvider, "channel">;

// A video link that can be read: its site, the video's id there, the one address the site's video goes by, and
// whether it is a tall short clip (a YouTube Short, or any TikTok).
export type VideoLink = { ok: true; provider: VideoProvider; id: string; url: string; short: boolean };

// Why a pasted link can't be read: it's on Instagram, it's one of TikTok's short share links (which only say where the
// video is once they're opened), it's not a YouTube, Vimeo or TikTok video, or it isn't a link.
export type LinkRefusalReason = "instagram" | "tiktok-share" | "unsupported" | "invalid";

// A pasted link that can't be read, and why.
export type LinkRefusal = { ok: false; reason: LinkRefusalReason };

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_EMBED_HOSTS: ReadonlySet<string> = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);
const VIMEO_HOSTS: ReadonlySet<string> = new Set(["vimeo.com", "www.vimeo.com"]);
const TIKTOK_HOSTS: ReadonlySet<string> = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]);
const TIKTOK_SHARE_HOSTS: ReadonlySet<string> = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
const INSTAGRAM_HOSTS: ReadonlySet<string> = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
// Embed addresses that are eleven characters long but name a playlist or a channel's live stream, not a video.
const YOUTUBE_EMBED_WORDS: ReadonlySet<string> = new Set(["videoseries", "live_stream"]);
const VIMEO_ID = /^\d{1,20}$/;
// The private part of an unlisted Vimeo video's address, without which Vimeo won't say anything about it.
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i;
const TIKTOK_ID = /^\d{1,25}$/;
const TIKTOK_USER = /^@[a-z0-9._]{1,32}$/;

const refuse = (reason: LinkRefusalReason): LinkRefusal => ({ ok: false, reason });

// The parts of a path, without the empty one a closing slash leaves: "/shorts/abc/" → ["shorts", "abc"].
function partsOf(url: URL): string[] {
  const parts = url.pathname.split("/").slice(1);
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  return parts;
}

function youtubeLink(url: URL): VideoLink | null {
  const parts = partsOf(url);
  let id: string | null = null;
  let short = false;
  if (url.hostname === "youtu.be") {
    if (parts.length === 1) id = parts[0];
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (parts.length === 1 && parts[0] === "watch") id = url.searchParams.get("v");
    else if (parts.length === 2 && (parts[0] === "shorts" || parts[0] === "live")) {
      id = parts[1];
      short = parts[0] === "shorts";
    } else if (parts.length === 2 && parts[0] === "embed" && !YOUTUBE_EMBED_WORDS.has(parts[1])) id = parts[1];
  } else if (YOUTUBE_EMBED_HOSTS.has(url.hostname)) {
    if (parts.length === 2 && parts[0] === "embed" && !YOUTUBE_EMBED_WORDS.has(parts[1])) id = parts[1];
  }
  if (id === null || !YOUTUBE_ID.test(id)) return null;
  const canonical = short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
  return { ok: true, provider: "youtube", id, url: canonical, short };
}

function vimeoLink(url: URL): VideoLink | null {
  const parts = partsOf(url);
  let id: string | null = null;
  let hash: string | null = null;
  if (VIMEO_HOSTS.has(url.hostname)) {
    if (parts.length === 1) id = parts[0];
    else if (parts.length === 2 && VIMEO_HASH.test(parts[1])) [id, hash] = parts; // an unlisted video's share link
    else if (parts.length === 3 && parts[0] === "channels") id = parts[2];
  } else if (url.hostname === "player.vimeo.com" && parts.length === 2 && parts[0] === "video") {
    id = parts[1];
    const h = url.searchParams.get("h");
    if (h !== null && VIMEO_HASH.test(h)) hash = h;
  }
  if (id === null || !VIMEO_ID.test(id)) return null;
  const canonical = hash === null ? `https://vimeo.com/${id}` : `https://vimeo.com/${id}/${hash.toLowerCase()}`;
  return { ok: true, provider: "vimeo", id, url: canonical, short: false };
}

function tiktokLink(url: URL): VideoLink | null {
  if (!TIKTOK_HOSTS.has(url.hostname)) return null;
  const parts = partsOf(url);
  if (parts.length !== 3 || parts[1] !== "video") return null;
  // TikTok names are the same in any case, so one video has one address.
  const user = parts[0].toLowerCase();
  const id = parts[2];
  if (!TIKTOK_USER.test(user) || !TIKTOK_ID.test(id)) return null;
  return { ok: true, provider: "tiktok", id, url: `https://www.tiktok.com/${user}/video/${id}`, short: true };
}

// TikTok's short share links (vm.tiktok.com/…, vt.tiktok.com/… and tiktok.com/t/…), which the app's Share button
// gives. They only say which video they are once they're opened.
function isTiktokShareLink(url: URL): boolean {
  if (TIKTOK_SHARE_HOSTS.has(url.hostname)) return true;
  return TIKTOK_HOSTS.has(url.hostname) && partsOf(url)[0] === "t";
}

// Reads a pasted video link. A YouTube (watch, Shorts, live, embed or youtu.be), Vimeo (including an unlisted video's
// share link, whose private part is kept) or TikTok video link comes back as the video's one address on its site,
// with any extras (start time, playlist, sharing tags) left off. A link with no "https://" gets one, and http becomes
// https. A link with a name, password or port in it, or longer than LINK_CHARS, is refused. So are TikTok's short
// share links, with their own reason: reading where they lead would mean fetching them.
export function parseVideoLink(raw: string): VideoLink | LinkRefusal {
  if (typeof raw !== "string") return refuse("invalid");
  const text = raw.trim();
  if (text === "" || text.length > LINK_CHARS) return refuse("invalid");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return refuse("invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return refuse("invalid");
  if (url.username || url.password || url.port) return refuse("invalid");
  if (INSTAGRAM_HOSTS.has(url.hostname)) return refuse("instagram");
  if (isTiktokShareLink(url)) return refuse("tiktok-share");
  return youtubeLink(url) ?? vimeoLink(url) ?? tiktokLink(url) ?? refuse("unsupported");
}

// What to tell someone whose link can't be read: why, and what to do instead.
export function linkRefusalMessage(reason: LinkRefusalReason): string {
  if (reason === "instagram") return STYLE_MESSAGES.instagram;
  if (reason === "tiktok-share") return STYLE_MESSAGES.tiktokShareLink;
  return STYLE_MESSAGES.badLink;
}

// Whether a link's picture address is one that may be shown: https on YouTube's, Vimeo's or TikTok's image servers.
export function isThumbnailHost(url: string): boolean {
  return thumbnailAddress(url) !== null;
}

// --- Asking the site ---

// Each site's public oEmbed address: the only addresses this file ever fetches.
const ENDPOINTS: Readonly<Record<VideoProvider, string>> = {
  youtube: "https://www.youtube.com/oembed",
  vimeo: "https://vimeo.com/api/oembed.json",
  tiktok: "https://www.tiktok.com/oembed",
};
const TIMEOUT_MS = 8000;
const ANSWER_BYTES = 64 * 1024; // more than any site's answer about one video needs
const AUTHOR_CHARS = 100;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// The answer's text, or null when it runs past maxBytes. A body that says it is too long isn't read at all, and one
// that turns out too long stops being read there.
async function cappedText(response: Response, maxBytes: number): Promise<string | null> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

// The site's answer about the link as a JSON object, or null when there's none: the site couldn't be reached, took
// too long, sent it elsewhere, said no, or answered with something else.
async function askSite(link: VideoLink, fetchFn: typeof fetch): Promise<Record<string, unknown> | null> {
  if (!Object.hasOwn(ENDPOINTS, link.provider)) return null; // never an address of anyone else's choosing
  const query = new URLSearchParams({ url: link.url, format: "json" });
  try {
    const response = await fetchFn(`${ENDPOINTS[link.provider]}?${query}`, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await cappedText(response, ANSWER_BYTES);
    if (text === null) return null;
    const body: unknown = JSON.parse(text);
    return isRecord(body) ? body : null;
  } catch {
    // Nothing of the error is kept: it can quote the address.
    return null;
  }
}

// A site's words on one line: control characters and direction overrides out, every run of spaces and line breaks
// made one space, and cut to max characters with "…" when longer. undefined when nothing is left.
function oneLine(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .toWellFormed()
    .replace(/[\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  if (text === "") return undefined;
  return text.length <= max ? text : withSuffix(text, "…", max);
}

// A length in seconds, to two places, when it is one a reference can have.
function secondsOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > ANALYSIS_LIMITS.seconds) return undefined;
  const seconds = Math.round(value * 100) / 100;
  return seconds > 0 ? seconds : undefined;
}

// The facts kept from a site's answer: its title, author and picture, and from Vimeo the length and description.
// Everything else the site sends, its embed HTML above all, is left behind.
function factsFrom(link: VideoLink, answer: Record<string, unknown>, fetchedAt: string): LinkAnalysis {
  const title = oneLine(answer.title, LIMITS.styleShortTextChars);
  const author = oneLine(answer.author_name, AUTHOR_CHARS);
  const thumbnailUrl = thumbnailAddress(answer.thumbnail_url) ?? undefined;
  const seconds = link.provider === "vimeo" ? secondsOf(answer.duration) : undefined;
  const description = link.provider === "vimeo" ? oneLine(answer.description, ANALYSIS_LIMITS.descriptionChars) : undefined;
  const nothing = !title && !author && !thumbnailUrl && seconds === undefined && !description;
  return {
    kind: "link",
    provider: link.provider,
    title: title ?? link.url,
    ...(author ? { author } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
    ...(description ? { description } : {}),
    ...(link.short ? { short: true } : {}),
    fetchedAt,
    ...(nothing ? { unreadable: true } : {}),
  };
}

// The link alone, for when the site told us nothing: the address stands in as the title.
function linkOnly(link: VideoLink, fetchedAt: string): LinkAnalysis {
  return { kind: "link", provider: link.provider, title: link.url, ...(link.short ? { short: true } : {}), fetchedAt, unreadable: true };
}

// Asks the link's site for the video's public facts (title, author, picture; from Vimeo also its length and
// description) and returns them as a link's analysis. It never fails: when the site can't be reached, takes longer
// than 8 seconds, redirects, says no, sends more than 64 KB or sends something unreadable, the link is still kept,
// with its address as the title and unreadable set. Nothing is logged.
export async function fetchLinkFacts(link: VideoLink, fetchFn: typeof fetch = fetch, now: () => Date = () => new Date()): Promise<LinkAnalysis> {
  const answer = await askSite(link, fetchFn);
  const fetchedAt = now().toISOString();
  if (!answer) return linkOnly(link, fetchedAt);
  const checked = LinkAnalysis.safeParse(factsFrom(link, answer, fetchedAt));
  return checked.success ? checked.data : linkOnly(link, fetchedAt);
}
