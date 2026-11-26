import "server-only";

type Settings = Record<string, string | undefined>;

// The only place the stock library's setting is read. PEXELS_API_KEY is this server's key for Pexels' API. Without
// it there is no stock library on this server (no button). The key is never put in a message or sent to a browser.
export function stockConfig(env: Settings = process.env): { key: string } | null {
  const key = env.PEXELS_API_KEY?.trim();
  return key ? { key } : null;
}
