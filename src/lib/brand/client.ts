import type { BrandKit, BrandKitPatch } from "./types";

const FAILED = "The brand kit could not be saved. Try again.";
const isString = (v: unknown): v is string => typeof v === "string";

// Whether an answer has a kit's shape, so a page that answers something else never reaches the editor's drawing.
function isKit(body: unknown): body is BrandKit {
  if (typeof body !== "object" || body === null) return false;
  const { fonts, colors, logos } = body as Record<string, unknown>;
  if (typeof fonts !== "object" || fonts === null) return false;
  const { title, subtitle, body: text } = fonts as Record<string, unknown>;
  return isString(title) && isString(subtitle) && isString(text) && Array.isArray(colors) && colors.every(isString) && Array.isArray(logos);
}

// The browser's calls to /api/brand. A refusal throws with the server's own message, which is written for people.
async function answer(response: Response): Promise<BrandKit> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null ? (body as { message?: unknown }).message : undefined;
    throw new Error(isString(message) ? message : FAILED);
  }
  if (!isKit(body)) throw new Error(FAILED);
  return body;
}

export async function fetchBrandKit(spaceId: string): Promise<BrandKit> {
  return answer(await fetch(`/api/brand?space=${encodeURIComponent(spaceId)}`, { cache: "no-store" }));
}

export async function saveBrandKit(spaceId: string, patch: BrandKitPatch): Promise<BrandKit> {
  return answer(
    await fetch(`/api/brand?space=${encodeURIComponent(spaceId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}
