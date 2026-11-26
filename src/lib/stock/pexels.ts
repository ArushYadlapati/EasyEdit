import { STOCK_PAGE, type StockItem, type StockKind } from "./types";

// Pexels' API, as far as the stock library uses it: the address of a search, and its answer read into our items.
// Pure: nothing here fetches. Every address an item carries is checked to be Pexels' own, over https, so the browser
// is never sent anywhere else by an answer.

const API = "https://api.pexels.com";
const FILE_HOSTS = new Set(["videos.pexels.com", "images.pexels.com"]);
const SITE_HOSTS = new Set(["www.pexels.com", "pexels.com"]);
const VIDEO_LONG_SIDE = 1920; // the largest video file taken: the editor works at 1080p

// The address of a search's page. Without words: what is popular now.
export function searchUrl(kind: StockKind, query: string, page: number): string {
  const words = query.trim();
  const path = kind === "video" ? (words ? "/videos/search" : "/videos/popular") : words ? "/v1/search" : "/v1/curated";
  const params = new URLSearchParams({ per_page: String(STOCK_PAGE), page: String(page) });
  if (words) params.set("query", words);
  return `${API}${path}?${params}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const whole = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

// An https address on one of the hosts, or null.
function addressOn(value: unknown, hosts: ReadonlySet<string>): string | null {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && hosts.has(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

// A file name from words: lowercase letters and digits, joined by hyphens.
const slug = (words: string) => words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
// The words in a Pexels page address, as "/video/close-up-of-a-board-6754822/" → "close-up-of-a-board".
function wordsOf(page: string | null, id: string): string {
  const last = page?.split("/").filter(Boolean).at(-1) ?? "";
  return slug(last.endsWith(`-${id}`) ? last.slice(0, -id.length - 1) : "");
}

// The MP4 to take from a video's files: the largest whose long side is 1920 or less, else the smallest there is.
function pickVideoFile(files: unknown): { link: string; width: number; height: number } | null {
  if (!Array.isArray(files)) return null;
  const usable = files
    .filter(isRecord)
    .filter((file) => file.file_type === "video/mp4")
    .map((file) => ({ link: addressOn(file.link, FILE_HOSTS), width: whole(file.width), height: whole(file.height) }))
    .filter((file): file is { link: string; width: number; height: number } => file.link !== null && file.width > 0 && file.height > 0)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  const fits = usable.filter((file) => Math.max(file.width, file.height) <= VIDEO_LONG_SIDE);
  return fits.at(-1) ?? usable[0] ?? null;
}

function videoOf(raw: unknown): StockItem | null {
  if (!isRecord(raw)) return null;
  const id = String(whole(raw.id));
  const file = pickVideoFile(raw.video_files);
  const thumb = addressOn(raw.image, FILE_HOSTS);
  if (id === "0" || !file || !thumb) return null;
  const user = isRecord(raw.user) ? raw.user : {};
  const page = addressOn(raw.url, SITE_HOSTS);
  const words = wordsOf(page, id);
  return {
    id,
    kind: "video",
    width: file.width,
    height: file.height,
    seconds: whole(raw.duration) || null,
    thumb,
    file: file.link,
    fileName: `${words ? `${words}-` : ""}pexels-${id}.mp4`,
    by: text(user.name).slice(0, 80) || "Pexels",
    byUrl: addressOn(user.url, SITE_HOSTS),
    page,
  };
}

function photoOf(raw: unknown): StockItem | null {
  if (!isRecord(raw)) return null;
  const id = String(whole(raw.id));
  const src = isRecord(raw.src) ? raw.src : {};
  const file = addressOn(src.large2x, FILE_HOSTS) ?? addressOn(src.original, FILE_HOSTS);
  const thumb = addressOn(src.medium, FILE_HOSTS) ?? addressOn(src.small, FILE_HOSTS);
  if (id === "0" || !file || !thumb) return null;
  const page = addressOn(raw.url, SITE_HOSTS);
  const words = wordsOf(page, id) || slug(text(raw.alt));
  return {
    id,
    kind: "image",
    width: whole(raw.width),
    height: whole(raw.height),
    seconds: null,
    thumb,
    file,
    fileName: `${words ? `${words}-` : ""}pexels-${id}.jpg`,
    by: text(raw.photographer).slice(0, 80) || "Pexels",
    byUrl: addressOn(raw.photographer_url, SITE_HOSTS),
    page,
  };
}

// A search's answer as items. Anything that is not what Pexels sends, or points anywhere but Pexels, is left out.
export function readSearch(kind: StockKind, body: unknown): { items: StockItem[]; more: boolean } {
  if (!isRecord(body)) return { items: [], more: false };
  const list = kind === "video" ? body.videos : body.photos;
  const items = (Array.isArray(list) ? list : []).map(kind === "video" ? videoOf : photoOf).filter((item): item is StockItem => item !== null);
  return { items, more: typeof body.next_page === "string" && body.next_page !== "" };
}

// Whether an address is one of Pexels' file servers': the only place the browser fetches a stock file from.
export const isStockFile = (address: string): boolean => addressOn(address, FILE_HOSTS) !== null;
