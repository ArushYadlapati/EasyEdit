import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { driveConnection, spaceStorage } from "@/db/schema";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { seal } from "@/lib/storage/secret-box";
import { makeTestDb } from "../helpers/db";

// The real routes, as a browser reaches them with no session: the proxy lets /api/storage/* through, so the
// handlers themselves must turn a signed-out visitor into a page.
const getSession = vi.fn();
let testDb: DB;
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => testDb,
}));

const BASE = "https://app.test";
const KEY = randomBytes(32);

beforeEach(async () => {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-1");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "shh");
  vi.stubEnv("STORAGE_TOKEN_KEY", KEY.toString("base64"));
  vi.stubEnv("BETTER_AUTH_URL", BASE);
  testDb = await makeTestDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function expectRefusedPage(res: Response) {
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`${BASE}/dashboard?storage=refused`);
  expect(res.headers.get("content-type") ?? "").not.toMatch(/json/);
  expect(await res.text()).toBe("");
}

describe("the storage routes for a signed-out visitor", () => {
  it("connect lands on the fixed page, sets no cookie and never goes to Google", async () => {
    const { GET } = await import("@/app/api/storage/connect/route");
    const res = await GET(new Request(`${BASE}/api/storage/connect?space=${SEED_TEAM_ID}`));
    await expectRefusedPage(res);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("the callback lands on the fixed page, clears the cookie and stores nothing, even with a cookie it started", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("@/app/api/storage/callback/route");
    const started = seal(JSON.stringify({ state: "s1", verifier: "v1", userId: "u1", spaceId: SEED_TEAM_ID, exp: Date.now() + 600_000 }), KEY);
    const res = await GET(new Request(`${BASE}/api/storage/callback?code=c&state=s1`, { headers: { cookie: `ee_storage_oauth=${started}` } }));
    await expectRefusedPage(res);
    expect(res.headers.getSetCookie().find((line) => line.startsWith("ee_storage_oauth="))).toMatch(/^ee_storage_oauth=;.*Max-Age=0/);
    expect(fetchSpy).not.toHaveBeenCalled(); // no code exchanged at Google
    expect(await testDb.select().from(driveConnection)).toEqual([]);
    expect((await testDb.select().from(spaceStorage)).map((row) => row.kind)).toEqual(["shared_folder"]);
  });
});
