import type { BrandKit, BrandKitPatch } from "./types";

// The browser's calls to /api/brand. A refusal throws with the server's own message, which is written for people.
async function answer(response: Response): Promise<BrandKit> {
  const body = (await response.json().catch(() => null)) as (BrandKit & { message?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.message ?? "The brand kit could not be saved. Try again.");
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
