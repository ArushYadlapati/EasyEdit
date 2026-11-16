import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { storageBlock } from "@/lib/storage/availability";
import type { StorageConfig } from "@/lib/storage/config";
import { makeConnectHandlers } from "@/lib/storage/connect-handlers";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

const BASE = "https://app.test";
const cfg: StorageConfig = { clientId: "client-1", clientSecret: "shh", tokenKey: randomBytes(32), redirectUri: `${BASE}/api/storage/callback` };

async function connect(space: string) {
  const db = await makeTestDb();
  await joinSpace(db, { id: "u1" }, "admin");
  await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
  const handlers = makeConnectHandlers({
    db: () => db,
    auth: async () => testUser({ id: "u1" }),
    config: () => cfg,
    fetch: (async () => {
      throw new Error("no call to Google expected");
    }) as typeof fetch,
    setUp: vi.fn(async () => {}),
    block: () => null,
  });
  const res = await handlers.connect(new Request(`${BASE}/api/storage/connect?space=${space}`));
  expect(res.status).toBe(302);
  return { location: res.headers.get("location")!, cookies: res.headers.getSetCookie() };
}

describe("what stops a personal space getting storage", () => {
  afterEach(() => void vi.unstubAllEnvs());

  it("closed, it reads as a server that can't set storage up, so no page offers a setup", () => {
    vi.stubEnv("PERSONAL_SPACES", "");
    expect(storageBlock("personal", { config: () => cfg })).toBe("server");
  });

  it("switched on, nothing stops it", () => {
    expect(storageBlock("personal", { config: () => cfg })).toBeNull();
  });
});

describe("connecting a Google account while personal spaces are not offered", () => {
  afterEach(() => void vi.unstubAllEnvs());

  it("a personal space is sent to its coming-soon page, never to Google, and keeps no cookie", async () => {
    vi.stubEnv("PERSONAL_SPACES", "");
    const { location, cookies } = await connect(personalSpaceId("u1"));
    expect(location).toBe(`${BASE}/s/personal`);
    expect(cookies).toEqual([]);
  });

  it("a team still goes to Google", async () => {
    vi.stubEnv("PERSONAL_SPACES", "");
    expect(new URL((await connect(SEED_TEAM_ID)).location).origin).toBe("https://accounts.google.com");
  });

  it("switched on, a personal space goes to Google", async () => {
    expect(new URL((await connect(personalSpaceId("u1"))).location).origin).toBe("https://accounts.google.com");
  });
});
