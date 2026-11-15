import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { makeBrandHandlers } from "@/lib/brand/handlers";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ed" }, "editor");
  await joinSpace(db, { id: "vi" }, "viewer");
  await joinSpace(db, { id: "out" }, "admin", personalSpaceId("out"));
  let current: CurrentUser = testUser({ id: "ed" });
  const brand = makeBrandHandlers({ db: () => db, auth: vi.fn(async () => current) });
  const as = (id: string) => (current = testUser({ id }));
  return { brand, as };
}

const url = (space: string | null) => `http://x/api/brand${space === null ? "" : `?space=${space}`}`;
const get = (space: string | null) => new Request(url(space));
const patch = (space: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url(space), { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const read = async (r: Response) => ({ status: r.status, body: await r.json() });

describe("/api/brand", () => {
  it("a member reads the kit", async () => {
    const { brand, as } = await setup();
    as("vi");
    expect(await read(await brand.get(get(SEED_TEAM_ID)))).toEqual({
      status: 200,
      body: { fonts: { title: "Geist", subtitle: "Geist", body: "Geist" }, colors: [], logos: [], updatedAt: null },
    });
  });

  it("an editor patches it", async () => {
    const { brand } = await setup();
    const r = await read(await brand.patch(patch(SEED_TEAM_ID, { titleFont: "Orbitron", colors: ["#FF5A1F"] })));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ fonts: { title: "Orbitron" }, colors: ["#ff5a1f"] });
    expect((await read(await brand.get(get(SEED_TEAM_ID)))).body.fonts.title).toBe("Orbitron");
  });

  it("a non-member gets the unknown-space answer", async () => {
    const { brand, as } = await setup();
    as("out");
    const unknown = await read(await brand.get(get("never-existed")));
    expect(unknown.status).toBe(404);
    expect(await read(await brand.get(get(SEED_TEAM_ID)))).toEqual(unknown);
    expect(await read(await brand.patch(patch(SEED_TEAM_ID, { colors: [] })))).toEqual(unknown);
    expect(await read(await brand.get(get(null)))).toEqual(unknown);
  });

  it("a viewer's patch is 403", async () => {
    const { brand, as } = await setup();
    as("vi");
    expect((await brand.patch(patch(SEED_TEAM_ID, { colors: [] }))).status).toBe(403);
  });

  it("a bad body is 400", async () => {
    const { brand } = await setup();
    for (const body of [{ colors: "red" }, { extra: 1 }, { titleFont: 5 }, "not json", { titleFont: "Comic Sans MS" }]) {
      const r = await read(await brand.patch(patch(SEED_TEAM_ID, body)));
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.code).toBe("INVALID");
    }
  });

  it("a patch from another site is refused", async () => {
    const { brand } = await setup();
    const r = await brand.patch(patch(SEED_TEAM_ID, { colors: [] }, { origin: "https://evil.example" }));
    expect(r.status).toBe(403);
  });
});
