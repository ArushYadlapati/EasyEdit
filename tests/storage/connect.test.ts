import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { driveConnection } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { shareFolderWith } from "@/lib/drive/reader";
import { driveFileUrl } from "@/lib/media/read-tokens";
import { ServiceError } from "@/lib/service-error";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import type { StorageConfig } from "@/lib/storage/config";
import { makeConnectHandlers } from "@/lib/storage/connect-handlers";
import { connectionAccess, listConnections, saveConnection } from "@/lib/storage/connections";
import { ConnectionBrokenError, DRIVE_FILE_SCOPE } from "@/lib/storage/google-oauth";
import { open, seal } from "@/lib/storage/secret-box";
import type { SetUpStorage } from "@/lib/storage/setup";
import { forgetAllSources } from "@/lib/storage/token-cache";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { makeFakeDrive } from "../helpers/fake-drive";

const BASE = "https://app.test";
const cfg: StorageConfig = {
  clientId: "client-1",
  clientSecret: "shh",
  tokenKey: randomBytes(32),
  redirectUri: `${BASE}/api/storage/callback`,
  projectId: "easyedit-test",
};
const COOKIE = "ee_storage_oauth";
const REFUSED = `${BASE}/dashboard?storage=refused`;
const STORAGE_PAGE = `${BASE}/s/seattle-solvers/settings/storage`;

// Google's token address, answering a code. What it grants and who signs in can be changed per test.
function fakeGoogle() {
  const grant = { scope: `openid https://www.googleapis.com/auth/userinfo.email ${DRIVE_FILE_SCOPE}`, sub: "g-sub-1", email: "ada@gmail.com", refreshToken: "1//refresh-plain-1" };
  const exchanges: URLSearchParams[] = [];
  const idToken = () =>
    `h.${Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: cfg.clientId, sub: grant.sub, email: grant.email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.s`;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url !== "https://oauth2.googleapis.com/token") throw new Error(`unexpected call to ${request.url}`);
    const form = new URLSearchParams(await request.text());
    exchanges.push(form);
    if (form.get("grant_type") !== "authorization_code") return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
    return Response.json({ access_token: "ya29.access", refresh_token: grant.refreshToken, expires_in: 3600, scope: grant.scope, id_token: idToken(), token_type: "Bearer" });
  }) as typeof fetch;
  return { grant, exchanges, fetch: fetchFn };
}

async function setup(opts: { config?: StorageConfig | null } = {}) {
  const db = await makeTestDb();
  await joinSpace(db, { id: "u1" }, "admin");
  await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
  await joinSpace(db, { id: "u2" }, "admin");
  const google = fakeGoogle();
  const signedIn: { user: CurrentUser } = { user: testUser({ id: "u1" }) };
  const clock = { now: new Date("2026-11-14T12:00:00Z") };
  const setUp = vi.fn<SetUpStorage>(async () => {});
  const handlers = makeConnectHandlers({
    db: () => db,
    auth: async () => signedIn.user,
    config: () => (opts.config === undefined ? cfg : opts.config),
    fetch: google.fetch,
    now: () => clock.now,
    setUp,
  });
  return { db, google, signedIn, clock, setUp, handlers };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const cookiesOf = (res: Response) => res.headers.getSetCookie();
const valueOf = (setCookie: string) => setCookie.split(";")[0].slice(COOKIE.length + 1);

// Presses "Connect Google Drive": the redirect to Google, its state, and the cookie the browser keeps.
async function start(ctx: Ctx, query = `space=${SEED_TEAM_ID}`, base = BASE) {
  const res = await ctx.handlers.connect(new Request(`${base}/api/storage/connect?${query}`));
  expect(res.status).toBe(302);
  const google = new URL(res.headers.get("location")!);
  const [setCookie] = cookiesOf(res);
  return { res, google, state: google.searchParams.get("state")!, setCookie, cookie: `${COOKIE}=${valueOf(setCookie)}` };
}

// Google sends the browser back.
const back = (ctx: Ctx, query: string, cookie?: string) =>
  ctx.handlers.callback(new Request(`${BASE}/api/storage/callback?${query}`, { headers: cookie ? { cookie } : {} }));

const rows = (db: DB) => db.select().from(driveConnection);

// A page, never JSON: a redirect with nothing in its body.
async function expectPage(res: Response, location: string) {
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(location);
  expect(res.headers.get("content-type") ?? "").not.toMatch(/json/);
  expect(await res.text()).toBe("");
}

function expectCleared(res: Response) {
  const cleared = cookiesOf(res).find((line) => line.startsWith(`${COOKIE}=`));
  expect(cleared).toBeDefined();
  expect(cleared).toMatch(/^ee_storage_oauth=;/);
  expect(cleared).toMatch(/Max-Age=0/);
  expect(cleared).toMatch(/Path=\/api\/storage/);
}

describe("connect", () => {
  it("sends an admin to Google asking only for drive.file, with PKCE and a sealed cookie", async () => {
    const ctx = await setup();
    const { google, state, setCookie } = await start(ctx, `space=${SEED_TEAM_ID}&hint=ada%40gmail.com`);
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(google.searchParams.get("scope")).toBe(`openid email ${DRIVE_FILE_SCOPE}`);
    expect(google.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(google.searchParams.get("login_hint")).toBe("ada@gmail.com");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(Buffer.from(state, "base64url").length).toBe(32);

    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\/api\/storage(;|$)/);
    expect(setCookie).toMatch(/Max-Age=3600/); // outlives exp, so a late return can still find its space
    expect(setCookie).toMatch(/Secure/);
    const value = valueOf(setCookie);
    expect(value).not.toContain(state); // sealed: it can't be read
    const kept = JSON.parse(open(value, cfg.tokenKey)) as Record<string, unknown>;
    expect(kept).toMatchObject({ state, userId: "u1", spaceId: SEED_TEAM_ID, exp: ctx.clock.now.getTime() + 600_000 });
    expect(google.searchParams.get("code_challenge")).toBe(createHash("sha256").update(String(kept.verifier)).digest("base64url"));
  });

  it("leaves Secure off on plain http", async () => {
    const ctx = await setup();
    const { setCookie } = await start(ctx, `space=${SEED_TEAM_ID}`, "http://localhost:3000");
    expect(setCookie).not.toMatch(/Secure/);
  });

  it("sends a space the person isn't admin of to the same fixed page as an unknown one", async () => {
    const ctx = await setup();
    await joinSpace(ctx.db, { id: "u1" }, "editor");
    for (const q of [`space=${SEED_TEAM_ID}`, "space=team_nope", "space=" + personalSpaceId("u2"), ""]) {
      const res = await ctx.handlers.connect(new Request(`${BASE}/api/storage/connect?${q}`));
      await expectPage(res, REFUSED);
      expect(cookiesOf(res)).toEqual([]);
    }
  });

  it("when storage isn't configured: an admin goes to the space's storage page, anyone else to the fixed page", async () => {
    const ctx = await setup({ config: null });
    const connect = (q: string) => ctx.handlers.connect(new Request(`${BASE}/api/storage/connect?${q}`));
    await expectPage(await connect(`space=${SEED_TEAM_ID}`), "/s/seattle-solvers/settings/storage?storage=not-configured");
    await expectPage(await connect(`space=${personalSpaceId("u1")}`), "/s/personal/settings/storage?storage=not-configured");
    await expectPage(await connect("space=team_nope"), "/dashboard?storage=refused");
    await expectPage(await connect(`space=${personalSpaceId("u2")}`), "/dashboard?storage=refused");
    await joinSpace(ctx.db, { id: "u1" }, "editor");
    await expectPage(await connect(`space=${SEED_TEAM_ID}`), "/dashboard?storage=refused");
    const cb = await back(ctx, "code=c&state=s");
    await expectPage(cb, "/dashboard?storage=refused");
    expectCleared(cb);
  });

  it("a signed-out or refused person lands on the fixed page, not the auth answer's JSON", async () => {
    const db = await makeTestDb();
    const handlers = makeConnectHandlers({ db: () => db, auth: async () => Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }), config: () => cfg, setUp: async () => {} });
    await expectPage(await handlers.connect(new Request(`${BASE}/api/storage/connect?space=${SEED_TEAM_ID}`)), REFUSED);
    const cb = await handlers.callback(new Request(`${BASE}/api/storage/callback?code=c&state=s`));
    await expectPage(cb, REFUSED);
    expectCleared(cb);
  });

  it("keeps a return path only when it is one of the app's /s/ pages", async () => {
    const ctx = await setup();
    const kept = async (ret: string) => (JSON.parse(open(valueOf((await start(ctx, `space=${SEED_TEAM_ID}&return=${encodeURIComponent(ret)}`)).setCookie), cfg.tokenKey)) as { return?: string }).return;
    expect(await kept("/s/seattle-solvers/editor/p1")).toBe("/s/seattle-solvers/editor/p1");
    for (const bad of ["https://evil.test/s/x", "//evil.test/s/x", "/\\evil.test/s/x", "/s/../api/x", "/dashboard", "s/x", "/s"]) {
      expect(await kept(bad)).toBeUndefined();
    }
  });
});

describe("the callback refuses anything it didn't start", () => {
  async function expectRefused(ctx: Ctx, res: Response) {
    await expectPage(res, REFUSED);
    expectCleared(res);
    expect(await rows(ctx.db)).toEqual([]);
    expect(ctx.setUp).not.toHaveBeenCalled();
    expect(ctx.google.exchanges).toEqual([]);
  }

  it("no cookie", async () => {
    const ctx = await setup();
    const { state } = await start(ctx);
    await expectRefused(ctx, await back(ctx, `code=c&state=${state}`));
  });

  it("a cookie that wasn't sealed here, or was changed", async () => {
    const ctx = await setup();
    const { state, cookie } = await start(ctx);
    const forged = seal(JSON.stringify({ state, verifier: "v", userId: "u1", spaceId: SEED_TEAM_ID, exp: Date.now() * 2 }), randomBytes(32));
    await expectRefused(ctx, await back(ctx, `code=c&state=${state}`, `${COOKIE}=${forged}`));
    await expectRefused(ctx, await back(ctx, `code=c&state=${state}`, `${cookie.slice(0, -2)}AA`));
    await expectRefused(ctx, await back(ctx, `code=c&state=${state}`, `${COOKIE}=${seal("not json", cfg.tokenKey)}`));
  });

  it("state mismatch", async () => {
    const ctx = await setup();
    const { cookie } = await start(ctx);
    const other = await start(ctx);
    await expectRefused(ctx, await back(ctx, `code=c&state=${other.state}`, cookie));
    await expectRefused(ctx, await back(ctx, "code=c", cookie));
  });

  it("expired, for the same person still admin: back to the space's storage page, nothing stored", async () => {
    const ctx = await setup();
    const { state, cookie } = await start(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 600_001);
    const res = await back(ctx, `code=c&state=${state}`, cookie);
    await expectPage(res, `${STORAGE_PAGE}?storage=expired`);
    expectCleared(res);
    expect(ctx.google.exchanges).toEqual([]);
    expect(await rows(ctx.db)).toEqual([]);
    expect(ctx.setUp).not.toHaveBeenCalled();
  });

  it("expired, for another person or one no longer admin: the fixed page", async () => {
    const ctx = await setup();
    const { state, cookie } = await start(ctx);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 600_001);
    ctx.signedIn.user = testUser({ id: "u2" });
    await expectRefused(ctx, await back(ctx, `code=c&state=${state}`, cookie));
    ctx.signedIn.user = testUser({ id: "u1" });
    await joinSpace(ctx.db, { id: "u1" }, "editor");
    await expectRefused(ctx, await back(ctx, `code=c&state=${state}`, cookie));
  });

  it("different signed-in user", async () => {
    const ctx = await setup();
    const { state, cookie } = await start(ctx);
    ctx.signedIn.user = testUser({ id: "u2" }); // also an admin of the space
    await expectRefused(ctx, await back(ctx, `code=c&state=${state}`, cookie));
  });

  it("not admin of the space any more", async () => {
    const ctx = await setup();
    const { state, cookie } = await start(ctx);
    await joinSpace(ctx.db, { id: "u1" }, "editor");
    await expectRefused(ctx, await back(ctx, `code=c&state=${state}`, cookie));
  });

  it("missing drive.file scope: nothing stored, back to storage with needs-drive", async () => {
    const ctx = await setup();
    ctx.google.grant.scope = "openid https://www.googleapis.com/auth/userinfo.email";
    const { state, cookie } = await start(ctx);
    const res = await back(ctx, `code=c&state=${state}`, cookie);
    await expectPage(res, `${STORAGE_PAGE}?storage=needs-drive`);
    expectCleared(res);
    expect(ctx.google.exchanges).toHaveLength(1);
    expect(await rows(ctx.db)).toEqual([]);
    expect(ctx.setUp).not.toHaveBeenCalled();
  });

  it("access_denied: nothing stored, back to storage with cancelled", async () => {
    const ctx = await setup();
    const { state, cookie } = await start(ctx);
    const res = await back(ctx, `error=access_denied&state=${state}`, cookie);
    await expectPage(res, `${STORAGE_PAGE}?storage=cancelled`);
    expectCleared(res);
    expect(ctx.google.exchanges).toEqual([]);
    expect(await rows(ctx.db)).toEqual([]);
    expect(ctx.setUp).not.toHaveBeenCalled();
  });

  it("Google refusing the code: nothing stored, back to storage with failed", async () => {
    const ctx = await setup();
    const { state, cookie } = await start(ctx);
    ctx.google.grant.refreshToken = ""; // no refresh token in the answer
    const res = await back(ctx, `code=c&state=${state}`, cookie);
    await expectPage(res, `${STORAGE_PAGE}?storage=failed`);
    expectCleared(res);
    expect(await rows(ctx.db)).toEqual([]);
    expect(ctx.setUp).not.toHaveBeenCalled();
  });
});

describe("the callback", () => {
  it("stores one connection with the token sealed, sets up storage once, and goes to storage settings", async () => {
    const ctx = await setup();
    const { state, cookie, google } = await start(ctx);
    const res = await back(ctx, `code=the-code&state=${state}`, cookie);
    await expectPage(res, `${STORAGE_PAGE}?storage=connected`);
    expectCleared(res);

    const [exchange] = ctx.google.exchanges;
    expect(exchange.get("code")).toBe("the-code");
    expect(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url")).toBe(google.searchParams.get("code_challenge"));

    const stored = await rows(ctx.db);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: "u1", googleSub: "g-sub-1", email: "ada@gmail.com", brokenAt: null });
    expect(stored[0].scopes.split(" ")).toContain(DRIVE_FILE_SCOPE);
    expect(stored[0].refreshTokenEnc).not.toContain("refresh-plain");
    expect(open(stored[0].refreshTokenEnc, cfg.tokenKey)).toBe("1//refresh-plain-1");

    expect(ctx.setUp).toHaveBeenCalledTimes(1);
    expect(ctx.setUp).toHaveBeenCalledWith(ctx.db, { spaceId: SEED_TEAM_ID, connectionId: stored[0].id, byUserId: "u1" });
  });

  it("goes back to a personal space as /s/personal, or to the return path it was given", async () => {
    const ctx = await setup();
    const personal = await start(ctx, `space=${personalSpaceId("u1")}`);
    const res = await back(ctx, `code=c&state=${personal.state}`, personal.cookie);
    expect(res.headers.get("location")).toBe(`${BASE}/s/personal/settings/storage?storage=connected`);
    expect(ctx.setUp).toHaveBeenLastCalledWith(ctx.db, expect.objectContaining({ spaceId: personalSpaceId("u1") }));

    const withReturn = await start(ctx, `space=${SEED_TEAM_ID}&return=${encodeURIComponent("/s/seattle-solvers/editor/p1")}`);
    const res2 = await back(ctx, `code=c&state=${withReturn.state}`, withReturn.cookie);
    expect(res2.headers.get("location")).toBe(`${BASE}/s/seattle-solvers/editor/p1`);
  });

  it("a second connect with the same Google account updates the same row", async () => {
    const ctx = await setup();
    const first = await start(ctx);
    await back(ctx, `code=c&state=${first.state}`, first.cookie);
    const [before] = await rows(ctx.db);
    await ctx.db.update(driveConnection).set({ brokenAt: new Date(), brokenReason: "revoked" }).where(eq(driveConnection.id, before.id));

    ctx.google.grant.refreshToken = "1//refresh-plain-2";
    ctx.google.grant.email = "ada.new@gmail.com";
    const second = await start(ctx, `space=${personalSpaceId("u1")}`);
    await back(ctx, `code=c&state=${second.state}`, second.cookie);
    const after = await rows(ctx.db);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0]).toMatchObject({ email: "ada.new@gmail.com", brokenAt: null, brokenReason: null });
    expect(open(after[0].refreshTokenEnc, cfg.tokenKey)).toBe("1//refresh-plain-2");
    expect(ctx.setUp).toHaveBeenCalledTimes(2);
    expect(ctx.setUp).toHaveBeenLastCalledWith(ctx.db, { spaceId: personalSpaceId("u1"), connectionId: before.id, byUserId: "u1" });
  });

  it("a failed storage setup keeps the connection and goes back with failed", async () => {
    const ctx = await setup();
    ctx.setUp.mockRejectedValueOnce(new ServiceError("CONFLICT", 409, "in use"));
    const { state, cookie } = await start(ctx);
    const res = await back(ctx, `code=c&state=${state}`, cookie);
    await expectPage(res, `${STORAGE_PAGE}?storage=failed`);
    expectCleared(res);
    expect(await rows(ctx.db)).toHaveLength(1);
  });

  it("a space whose videos are already in another account goes back with in-use, not failed", async () => {
    const ctx = await setup();
    ctx.setUp.mockRejectedValueOnce(new ServiceError("STORAGE_IN_USE", 409, "in use"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state, cookie } = await start(ctx);
    const res = await back(ctx, `code=c&state=${state}`, cookie);
    quiet.mockRestore();
    await expectPage(res, `${STORAGE_PAGE}?storage=in-use`);
    expectCleared(res);
    expect(await rows(ctx.db)).toHaveLength(1);
  });

  it("an unexpected failure lands on a fixed page too, and still clears the cookie", async () => {
    const ctx = await setup();
    ctx.setUp.mockRejectedValueOnce(new Error("a bug"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state, cookie } = await start(ctx);
    const res = await back(ctx, `code=c&state=${state}`, cookie);
    quiet.mockRestore();
    await expectPage(res, `${BASE}/dashboard?storage=failed`);
    expectCleared(res);
  });
});

describe("connections", () => {
  it("lists a person's connections without their tokens", async () => {
    const db = await makeTestDb();
    await joinSpace(db, { id: "u1" }, "admin");
    const saved = await saveConnection(db, cfg, { userId: "u1", googleSub: "s1", email: "a@gmail.com", refreshToken: "rt", scopes: [DRIVE_FILE_SCOPE] });
    expect(saved).toEqual({ id: expect.any(String), userId: "u1", googleSub: "s1", email: "a@gmail.com", broken: false });
    expect(await listConnections(db, "u1")).toEqual([saved]);
    expect(await listConnections(db, "u2")).toEqual([]);
  });

  it("gives an access source for the connection; invalid_grant marks it broken and comes out as ConnectionBrokenError", async () => {
    const db = await makeTestDb();
    await joinSpace(db, { id: "u1" }, "admin");
    const fake = makeFakeDrive();
    const { refreshToken, email } = fake.connect({ email: "ada@gmail.com" });
    const saved = await saveConnection(db, cfg, { userId: "u1", googleSub: "s1", email, refreshToken, scopes: [DRIVE_FILE_SCOPE] });

    const access = await connectionAccess(db, cfg, saved.id, fake.fetch);
    const { accessToken } = await access.token();
    expect(fake.whoHas(accessToken)).toEqual({ email, scope: DRIVE_FILE_SCOPE });
    expect(await connectionAccess(db, cfg, saved.id, fake.fetch)).toBe(access); // kept for the next request, token and all

    fake.revoke(refreshToken);
    forgetAllSources(); // a server that holds no token for the connection yet
    const again = await connectionAccess(db, cfg, saved.id, fake.fetch);
    const error = await again.token().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionBrokenError);
    const [row] = await db.select().from(driveConnection);
    expect(row.brokenAt).toBeInstanceOf(Date);
    expect(row.brokenReason).toBe("revoked");
    expect((await listConnections(db, "u1"))[0].broken).toBe(true);

    // Already marked broken: not tried again.
    const calls = fake.calls.length;
    await expect((await connectionAccess(db, cfg, saved.id, fake.fetch)).token()).rejects.toBeInstanceOf(ConnectionBrokenError);
    expect(fake.calls.length).toBe(calls);
  });

  it("a connection's token sees only what the app made with it, not a folder merely shared with that person", async () => {
    const db = await makeTestDb();
    await joinSpace(db, { id: "u1" }, "admin");
    await joinSpace(db, { id: "u2" }, "admin");
    const fake = makeFakeDrive();
    const ada = fake.connect({ email: "ada@gmail.com" });
    const bob = fake.connect({ email: "bob@gmail.com" });
    const adaConn = await saveConnection(db, cfg, { userId: "u1", googleSub: "s-ada", email: ada.email, refreshToken: ada.refreshToken, scopes: [DRIVE_FILE_SCOPE] });
    const bobConn = await saveConnection(db, cfg, { userId: "u2", googleSub: "s-bob", email: bob.email, refreshToken: bob.refreshToken, scopes: [DRIVE_FILE_SCOPE] });
    const adaAccess = await connectionAccess(db, cfg, adaConn.id, fake.fetch);
    const bobAccess = await connectionAccess(db, cfg, bobConn.id, fake.fetch);

    const made = await fake.fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
      method: "POST",
      headers: { Authorization: `Bearer ${(await adaAccess.token()).accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: "EasyEdit – Personal", mimeType: "application/vnd.google-apps.folder" }),
    });
    const { id: folderId } = (await made.json()) as { id: string };
    await shareFolderWith({ write: adaAccess, fetch: fake.fetch, sleep: async () => {} }, folderId, bob.email);

    const read = async (who: typeof adaAccess) => (await fake.fetch(driveFileUrl(folderId), { headers: { Authorization: `Bearer ${(await who.token()).accessToken}` } })).status;
    expect(await read(adaAccess)).toBe(200);
    expect(await read(bobAccess)).toBe(404);
  });
});
