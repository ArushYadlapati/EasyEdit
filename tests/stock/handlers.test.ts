import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { stockConfig } from "@/lib/stock/config";
import { makeStockHandlers } from "@/lib/stock/handlers";
import { STOCK_MESSAGES } from "@/lib/stock/types";

vi.mock("server-only", () => ({}));

const USER = { id: "u1", name: "Sam" } as unknown as CurrentUser;
const VIDEO = {
  id: 7,
  duration: 9,
  url: "https://www.pexels.com/video/a-robot-7/",
  image: "https://images.pexels.com/videos/7/p.jpg",
  user: { name: "Ana", url: "https://www.pexels.com/@ana" },
  video_files: [{ file_type: "video/mp4", width: 1280, height: 720, link: "https://videos.pexels.com/video-files/7/7.mp4" }],
};

function setUp(options: { key?: string | null; signedIn?: boolean; answer?: () => Response | Promise<Response> } = {}) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const handlers = makeStockHandlers({
    auth: async () => (options.signedIn === false ? Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }) : USER),
    config: () => (options.key === null ? null : { key: options.key ?? "the-key" }),
    fetch: (async (url: string, init: RequestInit) => {
      asked.push({ url, headers: init.headers as Record<string, string> });
      return (options.answer ?? (() => Response.json({ videos: [VIDEO], next_page: "x" })))();
    }) as typeof fetch,
  });
  const get = (query: string) => handlers.search(new Request(`https://app.test/api/stock${query}`));
  return { get, asked };
}

describe("the setting", () => {
  it("is the key, and nothing without one", () => {
    expect(stockConfig({ PEXELS_API_KEY: " abc " })).toEqual({ key: "abc" });
    expect(stockConfig({})).toBeNull();
    expect(stockConfig({ PEXELS_API_KEY: "  " })).toBeNull();
  });
});

describe("GET /api/stock", () => {
  it("asks Pexels with this server's key and answers with the items", async () => {
    const { get, asked } = setUp();
    const response = await get("?kind=video&q=robot%20arm&page=2");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ on: true, more: true, items: [{ id: "7", kind: "video", seconds: 9, by: "Ana", file: "https://videos.pexels.com/video-files/7/7.mp4" }] });
    expect(asked).toEqual([{ url: "https://api.pexels.com/videos/search?per_page=24&page=2&query=robot+arm", headers: { authorization: "the-key" } }]);
    expect(response.headers.get("cache-control")).toBe("private, max-age=600");
  });
  it("never sends the key, or anything about the person, to the browser or in the address", async () => {
    const { get, asked } = setUp();
    const text = await (await get("?kind=image")).text();
    expect(text).not.toContain("the-key");
    expect(asked[0].url).toBe("https://api.pexels.com/v1/curated?per_page=24&page=1");
    expect(JSON.stringify(asked)).not.toMatch(/u1|Sam/);
  });
  it("says the library is off on a server without a key, and asks Pexels nothing", async () => {
    const { get, asked } = setUp({ key: null });
    const response = await get("?kind=video");
    expect([response.status, await response.json(), asked]).toEqual([200, { on: false }, []]);
  });
  it("is for signed-in people only", async () => {
    const { get, asked } = setUp({ signedIn: false });
    expect([(await get("?kind=video")).status, asked]).toEqual([401, []]);
  });
  it("refuses a kind, words or a page it does not take", async () => {
    const { get, asked } = setUp();
    for (const query of ["", "?kind=audio", `?kind=video&q=${"a".repeat(101)}`, "?kind=video&page=0", "?kind=video&page=41", "?kind=video&page=1.5", "?kind=video&page=x"]) {
      const response = await get(query);
      expect([query, response.status, (await response.json()).code]).toEqual([query, 400, "INVALID"]);
    }
    expect(asked).toEqual([]);
  });
  it("says so plainly when Pexels is busy, refuses or can't be reached", async () => {
    const busy = await setUp({ answer: () => new Response("", { status: 429 }) }).get("?kind=video");
    expect([busy.status, (await busy.json()).message]).toEqual([429, STOCK_MESSAGES.busy]);
    const refused = await setUp({ answer: () => new Response("bad key", { status: 401 }) }).get("?kind=video");
    expect([refused.status, (await refused.json()).message]).toEqual([502, STOCK_MESSAGES.failed]);
    const down = await setUp({ answer: () => Promise.reject(new Error("the-key leaked?")) }).get("?kind=video");
    expect([down.status, await down.json()]).toEqual([502, { code: "PLATFORM_REFUSED", message: STOCK_MESSAGES.failed }]);
    const junk = await setUp({ answer: () => new Response("<html>", { status: 200 }) }).get("?kind=video");
    expect(await junk.json()).toEqual({ on: true, items: [], more: false });
  });
});
