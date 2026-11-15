import { makeSignature } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { member, user as userTable } from "@/db/schema";
import { addEntry, SEED_ADMIN_EMAIL, seedAdmin } from "@/lib/allowlist/service";
import { listMySpaces, findMySpace } from "@/lib/spaces/service";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { makeTestDb } from "../helpers/db";

let testDb: DB;
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => testDb,
}));

const SECRET = "test-secret-".repeat(4);
const BASE_URL = "http://localhost:3000";
const globalForAuth = globalThis as typeof globalThis & { __easyEditAuth?: unknown };

async function realAuth() {
  const { getAuth } = await import("@/lib/auth");
  return (await getAuth().$context);
}
type Ctx = Awaited<ReturnType<typeof realAuth>>;

async function signIn(ctx: Ctx, email: string, accountId: string, emailVerified = true) {
  const created = await ctx.internalAdapter.createOAuthUser({ email, name: "Newcomer", emailVerified }, { providerId: "google", accountId });
  const session = await ctx.internalAdapter.createSession(created.user.id);
  const signed = `${session.token}.${await makeSignature(session.token, SECRET)}`;
  return { user: created.user, cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}` };
}
const request = (cookie: string) => new Request(`${BASE_URL}/api/projects`, { headers: { cookie } });

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

describe("openSignUp", () => {
  it("is on only for the exact word true", async () => {
    const { openSignUp } = await import("@/lib/signup");
    expect(openSignUp({ OPEN_SIGNUP: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    for (const v of [undefined, "", "false", "1", "TRUE", "yes"]) expect(openSignUp({ OPEN_SIGNUP: v } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("OPEN_SIGNUP off", () => {
  it("refuses a Google user who is not on the allowlist", async () => {
    const ctx = await realAuth();
    const err = await signIn(ctx, "rando@gmail.com", "g-1").catch((e: unknown) => e);
    expect(err).toMatchObject({ body: { code: "NOT_ALLOWLISTED" } });
    expect(await testDb.select().from(userTable)).toHaveLength(0);
  });
});

describe("OPEN_SIGNUP on", () => {
  beforeEach(() => {
    vi.stubEnv("OPEN_SIGNUP", "true");
  });

  it("refuses an unverified email, listed or not", async () => {
    const ctx = await realAuth();
    for (const email of ["rando@gmail.com", SEED_ADMIN_EMAIL]) {
      const err = await signIn(ctx, email, `g-${email}`, false).catch((e: unknown) => e);
      expect(err).toMatchObject({ body: { code: "NOT_ALLOWLISTED" } });
    }
    expect(await testDb.select().from(userTable)).toHaveLength(0);
  });

  it("gives a stranger an account and a personal space, and no Seattle Solvers", async () => {
    const ctx = await realAuth();
    const { requireUserApi } = await import("@/lib/access");
    const { user, cookie } = await signIn(ctx, "Rando@Gmail.com", "g-2");
    expect(user.email).toBe("rando@gmail.com");

    expect(await listMySpaces(testDb, user.id)).toMatchObject([{ id: personalSpaceId(user.id), kind: "personal", role: "admin" }]);
    expect(await findMySpace(testDb, user.id, "personal")).not.toBeNull();
    expect(await findMySpace(testDb, user.id, "seattle-solvers")).toBeNull();
    expect((await testDb.select().from(member)).filter((m) => m.userId === user.id && m.organizationId === SEED_TEAM_ID)).toEqual([]);

    expect(await requireUserApi(request(cookie), "viewer")).toMatchObject({ id: user.id, allowlistRole: null });
    expect(await requireUserApi(request(cookie), "editor")).toMatchObject({ status: 403 });
    expect(await requireUserApi(request(cookie), "admin")).toMatchObject({ status: 403 });
  });

  it("lets an agent work for them, listing only their personal space", async () => {
    const ctx = await realAuth();
    const { requireUserApi } = await import("@/lib/access");
    const { toolContextFor } = await import("@/lib/mcp/context");
    const { listProjectsTool } = await import("@/lib/mcp/tools/list-projects");
    const { user, cookie } = await signIn(ctx, "rando@gmail.com", "g-3");
    const me = await requireUserApi(request(cookie), "viewer");
    if (me instanceof Response) throw new Error("not signed in");

    const tools = await toolContextFor(me);
    expect(tools).not.toBeNull();
    expect(tools!.spaces.map((s) => s.id)).toEqual([personalSpaceId(user.id)]);
    const listed = await listProjectsTool(tools!, {});
    expect(listed.isError).toBe(false);
    expect(listed.text).toContain('"Personal" (personal, admin)');
    expect(listed.text).not.toContain("Seattle Solvers");
  });

  it("still puts an allowlisted person in Seattle Solvers with their role, and keeps admin for admins", async () => {
    const ctx = await realAuth();
    const { requireUserApi } = await import("@/lib/access");
    await addEntry(testDb, { email: "kid@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    const kid = await signIn(ctx, "kid@gmail.com", "g-4");
    expect(await listMySpaces(testDb, kid.user.id)).toMatchObject([{ kind: "personal" }, { id: SEED_TEAM_ID, role: "editor" }]);
    expect(await requireUserApi(request(kid.cookie), "editor")).toMatchObject({ allowlistRole: "editor" });
    expect(await requireUserApi(request(kid.cookie), "admin")).toMatchObject({ status: 403 });
    const root = await signIn(ctx, SEED_ADMIN_EMAIL, "g-5");
    expect(await requireUserApi(request(root.cookie), "admin")).toMatchObject({ allowlistRole: "admin" });
  });

  it("a flag turned off again shuts a stranger's old session out", async () => {
    const ctx = await realAuth();
    const { requireUserApi } = await import("@/lib/access");
    const { cookie } = await signIn(ctx, "rando@gmail.com", "g-6");
    vi.stubEnv("OPEN_SIGNUP", "");
    expect(await requireUserApi(request(cookie), "viewer")).toMatchObject({ status: 401 });
  });
});
