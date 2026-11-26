// The stock library: free videos and photos from Pexels, searched through this server (which holds the key) and
// then fetched by the browser straight from Pexels' file servers into the space's own library, as any upload.

export type StockKind = "video" | "image";

export type StockItem = {
  id: string;
  kind: StockKind;
  width: number;
  height: number;
  seconds: number | null; // a video's length
  thumb: string; // a small picture of it
  file: string; // the file to fetch
  fileName: string;
  by: string; // who made it
  byUrl: string | null;
  page: string | null; // its page at Pexels
};

// on false: this server has no stock library (no key), so the editor shows none.
export type StockResult = { on: true; items: StockItem[]; more: boolean } | { on: false };

export const STOCK_PAGE = 24; // results asked for at a time
export const STOCK_QUERY_CHARS = 100;
export const STOCK_PAGES = 40; // how far a search can be paged

export const STOCK_MESSAGES = {
  failed: "Couldn't search the stock library. Try again.",
  busy: "The stock library is busy. Try again in a minute.",
  fileFailed: "Couldn't get that file from Pexels. Try again.",
  none: "Nothing found. Try other words.",
} as const;
