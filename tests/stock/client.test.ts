import { describe, expect, it } from "vitest";
import { searchStock, stockFile } from "@/lib/stock/client";
import { STOCK_MESSAGES, type StockItem } from "@/lib/stock/types";

const ITEM: StockItem = { id: "7", kind: "video", width: 1280, height: 720, seconds: 9, thumb: "https://images.pexels.com/videos/7/p.jpg", file: "https://videos.pexels.com/video-files/7/7.mp4", fileName: "a-robot-pexels-7.mp4", by: "Ana", byUrl: null, page: null };
const answering = (make: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    return make(url, init);
  }) as typeof fetch;
  return { fetchFn, asked };
};

describe("searching", () => {
  it("asks this server and reads its answer", async () => {
    const { fetchFn, asked } = answering(() => Response.json({ on: true, items: [ITEM], more: true }));
    expect(await searchStock("video", " robot arm ", 2, undefined, fetchFn)).toEqual({ ok: true, result: { on: true, items: [ITEM], more: true } });
    expect(asked[0].url).toBe("/api/stock?kind=video&q=robot+arm&page=2");
  });
  it("reads a server without a stock library as off", async () => {
    const { fetchFn } = answering(() => Response.json({ on: false }));
    expect(await searchStock("image", "", 1, undefined, fetchFn)).toEqual({ ok: true, result: { on: false } });
  });
  it("gives the server's sentence for a refusal, and its own when there is none or no answer", async () => {
    const busy = answering(() => Response.json({ code: "PLATFORM_REFUSED", message: STOCK_MESSAGES.busy }, { status: 429 }));
    expect(await searchStock("video", "x", 1, undefined, busy.fetchFn)).toEqual({ ok: false, message: STOCK_MESSAGES.busy });
    const broken = answering(() => new Response("<html>", { status: 500 }));
    expect(await searchStock("video", "x", 1, undefined, broken.fetchFn)).toEqual({ ok: false, message: STOCK_MESSAGES.failed });
    const offline = answering(() => Promise.reject(new TypeError("offline")));
    expect(await searchStock("video", "x", 1, undefined, offline.fetchFn)).toEqual({ ok: false, message: STOCK_MESSAGES.failed });
  });
});

describe("getting a file", () => {
  it("fetches it from Pexels with no cookies and no referrer, as a named file of its kind", async () => {
    const { fetchFn, asked } = answering(() => new Response(new Blob(["12345"])));
    const file = (await stockFile(ITEM, undefined, fetchFn))!;
    expect([file.name, file.type, file.size]).toEqual(["a-robot-pexels-7.mp4", "video/mp4", 5]);
    expect(asked).toEqual([{ url: ITEM.file, init: { signal: undefined, credentials: "omit", referrerPolicy: "no-referrer" } }]);
    const photo = (await stockFile({ ...ITEM, kind: "image", file: "https://images.pexels.com/photos/7/7.jpeg", fileName: "x-pexels-7.jpg" }, undefined, fetchFn))!;
    expect(photo.type).toBe("image/jpeg");
  });
  it("fetches nothing from anywhere else", async () => {
    const { fetchFn, asked } = answering(() => new Response(new Blob(["12345"])));
    expect(await stockFile({ ...ITEM, file: "https://example.com/7.mp4" }, undefined, fetchFn)).toBeNull();
    expect(await stockFile({ ...ITEM, file: "/api/media/7" }, undefined, fetchFn)).toBeNull();
    expect(asked).toEqual([]);
  });
  it("is nothing when the file is refused, empty or can't be reached", async () => {
    expect(await stockFile(ITEM, undefined, answering(() => new Response("", { status: 404 })).fetchFn)).toBeNull();
    expect(await stockFile(ITEM, undefined, answering(() => new Response(new Blob([]))).fetchFn)).toBeNull();
    expect(await stockFile(ITEM, undefined, answering(() => Promise.reject(new TypeError("offline"))).fetchFn)).toBeNull();
  });
});
