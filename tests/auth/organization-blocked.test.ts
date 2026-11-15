import { makeSignature } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { SEED_ADMIN_EMAIL, seedAdmin } from "@/lib/allowlist/service";
import { makeTestDb } from "../helpers/db";

let testDb: DB;
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => testDb,
}));

const SECRET = "test-secret-".repeat(4);
const BASE_URL = "https://studio.test";

const globalForAuth = globalThis as typeof globalThis & { __easyEditAuth?: unknown };

async function realAuth() {
  const { getAuth } = await import("@/lib/auth");
  const auth = getAuth();
  return { auth, ctx: await auth.$context };
}

// The Cookie header a browser sends after sign-in: the session token signed with the auth secret.
async function signIn(ctx: Awaited<ReturnType<typeof realAuth>>["ctx"], email: string, accountId: string) {
  const created = await ctx.internalAdapter.createOAuthUser(
    { email, name: "Kid", emailVerified: true },
    { providerId: "google", accountId },
  );
  const session = await ctx.internalAdapter.createSession(created.user.id);
  const signed = `${session.token}.${await makeSignature(session.token, SECRET)}`;
  return { user: created.user, cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}` };
}

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", BASE_URL);
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
  delete globalForAuth.__easyEditAuth;
  testDb = await makeTestDb();
  await seedAdmin(testDb);
});

afterEach(() => {
  delete globalForAuth.__easyEditAuth;
  vi.unstubAllEnvs();
});

describe("the organization plugin", () => {
  it("organization endpoints are closed in stage 1", async () => {
    const { auth, ctx } = await realAuth();
    const { cookie } = await signIn(ctx, SEED_ADMIN_EMAIL, "g-1");
    for (const path of ["/api/auth/organization/create", "/api/auth/organization/list", "/api/auth/organization/invite-member", "/api/auth/organization/leave"]) {
      const get = path.endsWith("list");
      const res = await auth.handler(new Request(`${BASE_URL}${path}`, {
        method: get ? "GET" : "POST",
        headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
        body: get ? undefined : "{}",
      }));
      expect(res.status, path).toBe(404);
    }
  });
});
