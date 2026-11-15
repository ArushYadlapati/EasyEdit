import { afterEach, expect, it, vi } from "vitest";
import { fetchBrandKit, saveBrandKit } from "@/lib/brand/client";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/types";

afterEach(() => vi.unstubAllGlobals());
const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

it("reads a kit", async () => {
  answer(200, DEFAULT_BRAND_KIT);
  await expect(fetchBrandKit("team1")).resolves.toEqual(DEFAULT_BRAND_KIT);
});

it("an answer that is not a kit is refused", async () => {
  for (const body of [{}, { ok: true }, { ...DEFAULT_BRAND_KIT, fonts: null }, { ...DEFAULT_BRAND_KIT, colors: "x" }]) {
    answer(200, body);
    await expect(fetchBrandKit("team1"), JSON.stringify(body)).rejects.toThrow();
  }
});

it("a refusal throws the server's words", async () => {
  answer(400, { code: "INVALID", message: '"Comic Sans MS" is not one of the fonts EasyEdit has.' });
  await expect(saveBrandKit("team1", { titleFont: "Comic Sans MS" })).rejects.toThrow('"Comic Sans MS" is not one of the fonts EasyEdit has.');
});
