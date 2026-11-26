import { isStockFile } from "./pexels";
import { STOCK_MESSAGES, type StockItem, type StockKind, type StockResult } from "./types";

// The browser's side of the stock library: asks this server for a page of a search, and fetches a chosen file
// straight from Pexels (its file servers let any page read them), so it can go into the library as any upload.

export type StockSearch = { ok: true; result: StockResult } | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export async function searchStock(kind: StockKind, query: string, page: number, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<StockSearch> {
  try {
    const params = new URLSearchParams({ kind, q: query.trim(), page: String(page) });
    const response = await fetchFn(`/api/stock?${params}`, { signal });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, message: isRecord(body) && typeof body.message === "string" && body.message ? body.message : STOCK_MESSAGES.failed };
    if (!isRecord(body) || body.on !== true) return { ok: true, result: { on: false } };
    return { ok: true, result: { on: true, items: Array.isArray(body.items) ? (body.items as StockItem[]) : [], more: body.more === true } };
  } catch {
    return { ok: false, message: STOCK_MESSAGES.failed };
  }
}

// A stock item's file, as a File the upload queue takes. Pexels is told nothing about the page that asks (no
// cookies, no referrer). null when it can't be had.
export async function stockFile(item: StockItem, signal?: AbortSignal, fetchFn: typeof fetch = fetch): Promise<File | null> {
  if (!isStockFile(item.file)) return null;
  try {
    const response = await fetchFn(item.file, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size === 0) return null;
    return new File([blob], item.fileName, { type: item.kind === "video" ? "video/mp4" : "image/jpeg" });
  } catch {
    return null;
  }
}
