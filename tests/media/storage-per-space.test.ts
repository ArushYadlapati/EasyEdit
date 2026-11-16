import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { driveConnection } from "@/db/schema";
import { resolveCurrentUser } from "@/lib/access-rules";
import { addEntry, SEED_ADMIN_EMAIL } from "@/lib/allowlist/service";
import { UNAUTHENTICATED_BODY } from "@/lib/api-errors";
import type { Actor } from "@/lib/actor";
import { SCOPE_READ } from "@/lib/drive/token";
import { createMediaApi } from "@/lib/media/api";
import { makeMediaHandlers, makeReadTokenHandler } from "@/lib/media/handlers";
import { MEDIA_MESSAGES } from "@/lib/media/messages";
import { createReadTokens } from "@/lib/media/read-tokens";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { saveConnection } from "@/lib/storage/connections";
import { DRIVE_FILE_SCOPE } from "@/lib/storage/google-oauth";
import { forgetAllSources } from "@/lib/storage/token-cache";
import { IMAGE, VIDEO, handlerDeps, handlersFetch, insertAsset, mediaContext, personalWithStorage, sendAll, teamWithStorage, type MediaContext } from "./context";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const BROKEN = { code: "STORAGE_BROKEN", message: "EasyEdit can't reach this space's Google Drive any more. An admin can reconnect it in storage settings." };
const UNAVAILABLE = { code: "STORAGE_UNAVAILABLE", message: "Google Drive didn't answer. Try again." };

// One request through the routes, as `actor`'s browser sends it, and what came back.
async function call(ctx: MediaContext, actor: Actor, method: string, path: string, body?: unknown) {
  const response = await handlersFetch(ctx, actor)(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : (JSON.parse(text) as Record<string, unknown>) };
}

const tokenFor = (ctx: MediaContext, actor: Actor, spaceId: string) => call(ctx, actor, "POST", `/api/drive/read-token?space=${encodeURIComponent(spaceId)}`);
const holderOf = (ctx: MediaContext, answer: { body: Record<string, unknown> | null }) => ctx.fake.whoHas(String(answer.body?.accessToken));
// How many times Google's token endpoint was asked (a refresh, or the service account's own token).
const tokenCalls = (ctx: MediaContext) => ctx.fake.calls.filter((c) => c.path === "/token").length;

// A whole upload through the routes: open, every piece to Drive, complete. The asset as complete answered it.
async function upload(ctx: MediaContext, actor: Actor, spaceId: string, input = IMAGE) {
  const opened = await call(ctx, actor, "POST", `/api/media?space=${encodeURIComponent(spaceId)}`, input);
  expect(opened.status, JSON.stringify(opened.body)).toBe(201);
  const { asset, uploadUrl } = opened.body as { asset: { id: string }; uploadUrl: string };
  await sendAll(ctx.fake, uploadUrl, input.sizeBytes);
  const done = await call(ctx, actor, "POST", `/api/media/${asset.id}/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return (done.body as { asset: { id: string; originalFileId: string } }).asset;
}

describe("media follows each space's storage", () => {
  it("read tokens go only where they belong", async () => {
    const ctx = await mediaContext();
    const mine = await personalWithStorage(ctx, ctx.ada, "ada.drive@gmail.com");
    const team = await teamWithStorage(ctx, "Robotics Club", ctx.ada, [ctx.grace], "club.drive@gmail.com");
    const unknown = await tokenFor(ctx, ctx.grace, "team_no_such_space");
    expect(unknown.status).toBe(404);

    // Not a member: the answer an unknown space gets, byte for byte.
    expect(await tokenFor(ctx, ctx.grace, mine.actor.spaceId)).toEqual(unknown);
    expect(await tokenFor(ctx, ctx.vera, team.spaceId)).toEqual(unknown);

    // A team member, the admin who connected the Drive included, gets the team's connection token: it reaches only
    // what EasyEdit made in that Google account, which backs this team alone.
    for (const member of [ctx.grace, ctx.ada]) {
      const answer = await tokenFor(ctx, member, team.spaceId);
      expect(answer.status).toBe(200);
      expect(holderOf(ctx, answer)).toEqual({ email: "club.drive@gmail.com", scope: DRIVE_FILE_SCOPE });
    }
    // The personal space's owner gets their own connection's token.
    const own = await tokenFor(ctx, ctx.ada, mine.actor.spaceId);
    expect(holderOf(ctx, own)).toEqual({ email: "ada.drive@gmail.com", scope: DRIVE_FILE_SCOPE });
    // And Seattle Solvers' members, the main service account's read-only token.
    expect(holderOf(ctx, await tokenFor(ctx, ctx.grace, SEED_TEAM_ID))).toEqual({ email: ctx.fake.config.clientEmail, scope: SCOPE_READ });
  });

  // The sign-in check is the real one (resolveCurrentUser, as requireUserApi runs it), so the flag matters here: off, a
  // person who is not on the allowlist is refused; on, they are signed in but still not in Seattle Solvers.
  for (const openSignup of ["true", ""]) {
    it(`seattle solvers still works (OPEN_SIGNUP ${openSignup === "true" ? "on" : "off"})`, async () => {
      vi.stubEnv("OPEN_SIGNUP", openSignup);
      const ctx = await mediaContext();
      for (const person of [ctx.ada, ctx.vera]) await addEntry(ctx.db, { email: person.email, role: person.role, invitedBy: SEED_ADMIN_EMAIL });
      const realAuth = (actor: Actor) => async () => {
        const who = { id: actor.userId, email: actor.email, name: actor.email };
        return (await resolveCurrentUser(ctx.db, who)) ?? Response.json(UNAUTHENTICATED_BODY, { status: 401 });
      };
      const asReal = (actor: Actor) => handlersFetch(ctx, actor, realAuth(actor));
      const send = async (actor: Actor, path: string, method = "GET") => {
        const res = await asReal(actor)(path, { method });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
      };
      const asset = await upload(ctx, ctx.ada, SEED_TEAM_ID, VIDEO);
      const file = ctx.fake.files.get(asset.originalFileId)!;
      expect(file.name).toContain("IMG_4821");
      expect(file.owner).toBeUndefined(); // in the shared drive
      const listed = await send(ctx.vera, `/api/media?space=${SEED_TEAM_ID}`);
      expect(listed).toMatchObject({ status: 200, body: { assets: [{ id: asset.id, status: "ready" }], setUp: true } });
      const token = await send(ctx.vera, `/api/drive/read-token?space=${SEED_TEAM_ID}`, "POST");
      expect(holderOf(ctx, token)).toEqual({ email: ctx.fake.config.clientEmail, scope: SCOPE_READ });
      const read = await ctx.fake.fetch(`https://www.googleapis.com/drive/v3/files/${asset.originalFileId}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${String(token.body?.accessToken)}` } });
      expect(read.status).toBe(200);

      // Grace is a member of the team but not on the allowlist: only an open sign-up lets her in.
      const grace = await send(ctx.grace, `/api/media?space=${SEED_TEAM_ID}`);
      expect(grace.status).toBe(openSignup === "true" ? 200 : 401);
    });
  }

  it("a personal space with storage uploads into the owner's folder", async () => {
    const ctx = await mediaContext();
    const mine = await personalWithStorage(ctx, ctx.ada, "ada.drive@gmail.com");
    const asset = await upload(ctx, ctx.ada, mine.actor.spaceId);
    const file = ctx.fake.files.get(asset.originalFileId)!;
    expect(file).toMatchObject({ owner: "ada.drive@gmail.com" });
    expect(ctx.fake.files.get(file.parents[0])).toMatchObject({ name: "Originals", parents: [mine.rootFolderId] });
    expect(await call(ctx, ctx.ada, "GET", `/api/media?space=${mine.actor.spaceId}`)).toMatchObject({ status: 200, body: { assets: [{ id: asset.id }], setUp: true } });
    // Seattle Solvers' folder got nothing of it.
    expect([...ctx.fake.files.values()].filter((f) => f.owner === undefined && f.mimeType !== "application/vnd.google-apps.folder")).toEqual([]);
  });

  it("a team's uploads go into the folder its admin connected, and its members can read them with the reader's token", async () => {
    const ctx = await mediaContext();
    const team = await teamWithStorage(ctx, "Robotics Club", ctx.ada, [ctx.grace], "club.drive@gmail.com");
    const asset = await upload(ctx, ctx.grace, team.spaceId);
    expect(ctx.fake.files.get(asset.originalFileId)).toMatchObject({ owner: "club.drive@gmail.com" });
    const token = await tokenFor(ctx, ctx.grace, team.spaceId);
    const read = await ctx.fake.fetch(`https://www.googleapis.com/drive/v3/files/${asset.originalFileId}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${String(token.body?.accessToken)}` } });
    expect(read.status).toBe(200);
  });

  it("a broken connection refuses uploads", async () => {
    const ctx = await mediaContext();
    const mine = await personalWithStorage(ctx);
    const space = mine.actor.spaceId;
    const held = await insertAsset(ctx.db, { spaceId: space, uploadedBy: ctx.ada.userId });
    ctx.fake.revoke(mine.refreshToken);
    forgetAllSources(); // a server that holds no token for the connection yet (setting up kept one)
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    // The first request asks Google once, learns the connection is gone, and marks it.
    let before = tokenCalls(ctx);
    expect(await call(ctx, ctx.ada, "POST", `/api/media?space=${space}`, IMAGE)).toEqual({ status: 409, body: BROKEN });
    expect(tokenCalls(ctx) - before).toBe(1);
    const [row] = await ctx.db.select().from(driveConnection).where(eq(driveConnection.id, mine.connection.id));
    expect(row).toMatchObject({ brokenReason: "revoked" });
    expect(row.brokenAt).not.toBeNull();

    // From then on every route that needs the Drive answers the same, without asking Google.
    before = tokenCalls(ctx);
    const refused = [
      await call(ctx, ctx.ada, "POST", `/api/media?space=${space}`, IMAGE),
      await call(ctx, ctx.ada, "POST", `/api/media/${held}/offset`),
      await call(ctx, ctx.ada, "POST", `/api/media/${held}/complete`),
      await call(ctx, ctx.ada, "POST", `/api/media/${held}/files`, { role: "poster", sizeBytes: 50_000 }),
      await call(ctx, ctx.ada, "POST", `/api/media/${held}/files/complete`, { role: "poster" }),
      await call(ctx, ctx.ada, "DELETE", `/api/media/${held}`),
      await tokenFor(ctx, ctx.ada, space),
    ];
    for (const answer of refused) expect(answer).toEqual({ status: 409, body: BROKEN });
    expect(tokenCalls(ctx)).toBe(before);
    // The library still lists, and says uploads can't be made.
    expect(await call(ctx, ctx.ada, "GET", `/api/media?space=${space}`)).toMatchObject({ status: 200, body: { assets: [{ id: held }], setUp: false } });
    expect(log).not.toHaveBeenCalledWith("Unhandled API error", expect.anything());

    // The browser reads it as `broken`, and its read tokens don't ask again and again.
    const browser = handlersFetch(ctx, ctx.ada);
    let asked = 0;
    const counting = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/drive/read-token")) asked += 1;
      return browser(input, init);
    }) as typeof fetch;
    const api = createMediaApi(space, counting);
    expect(await api.open(IMAGE)).toEqual({ ok: false, kind: "broken", message: BROKEN.message });
    expect(await api.readToken()).toMatchObject({ ok: false, kind: "broken" });
    asked = 0;
    const tokens = createReadTokens({ api });
    for (let i = 0; i < 5; i += 1) expect(await tokens.get()).toBeNull();
    expect(asked).toBe(1);
  });

  it("a connection revoked while its token is kept: one 502, then the broken answer", async () => {
    const ctx = await mediaContext();
    const mine = await personalWithStorage(ctx);
    const space = mine.actor.spaceId;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await upload(ctx, ctx.ada, space); // a token for the connection is kept
    ctx.fake.revoke(mine.refreshToken); // which Google stops honouring as well
    let before = tokenCalls(ctx);
    expect(await call(ctx, ctx.ada, "POST", `/api/media?space=${space}`, IMAGE)).toEqual({ status: 502, body: UNAVAILABLE });
    expect(tokenCalls(ctx) - before).toBe(0);
    before = tokenCalls(ctx);
    expect(await call(ctx, ctx.ada, "POST", `/api/media?space=${space}`, IMAGE)).toEqual({ status: 409, body: BROKEN });
    expect(tokenCalls(ctx) - before).toBe(1);
  });

  it("a team whose connection broke refuses uploads and playback alike, asking for a reconnect, but still lists its media", async () => {
    const ctx = await mediaContext();
    const team = await teamWithStorage(ctx, "Robotics Club", ctx.ada, [ctx.grace], "club.drive@gmail.com");
    const asset = await upload(ctx, ctx.grace, team.spaceId);
    await ctx.db.update(driveConnection).set({ brokenAt: new Date(), brokenReason: "expired" }).where(eq(driveConnection.id, team.connection.id));
    forgetAllSources();
    const calls = ctx.fake.calls.length;
    expect(await call(ctx, ctx.grace, "POST", `/api/media?space=${team.spaceId}`, IMAGE)).toEqual({ status: 409, body: BROKEN });
    expect(await call(ctx, ctx.ada, "DELETE", `/api/media/${asset.id}`)).toEqual({ status: 409, body: BROKEN });
    expect(ctx.fake.calls.length).toBe(calls); // refused without asking Google
    expect(await call(ctx, ctx.grace, "GET", `/api/media?space=${team.spaceId}`)).toMatchObject({ status: 200, body: { assets: [{ id: asset.id }], setUp: false } });

    // With no reader account left, playback needs the connection too: every member is told to reconnect.
    for (const member of [ctx.grace, ctx.ada]) expect(await tokenFor(ctx, member, team.spaceId)).toEqual({ status: 409, body: BROKEN });
    expect(await tokenFor(ctx, ctx.vera, team.spaceId)).toMatchObject({ status: 404 });
    // No refresh of the broken connection was tried.
    const [row] = await ctx.db.select().from(driveConnection).where(eq(driveConnection.id, team.connection.id));
    expect(row.brokenReason).toBe("expired");
  });

  it("each request does not refresh at Google: a connection's tokens are kept, and a reconnect is a new one", async () => {
    const ctx = await mediaContext();
    const mine = await personalWithStorage(ctx, ctx.ada, "ada.drive@gmail.com");
    const space = mine.actor.spaceId;
    await upload(ctx, ctx.ada, space);
    const before = tokenCalls(ctx);
    await upload(ctx, ctx.ada, space);
    await tokenFor(ctx, ctx.ada, space);
    expect(tokenCalls(ctx)).toBe(before);

    // Reconnecting the same account replaces the sealed token: the kept one is not used again.
    const again = ctx.fake.connect({ email: "ada.drive@gmail.com" });
    await saveConnection(ctx.db, ctx.cfg, { userId: ctx.ada.userId, googleSub: mine.connection.googleSub, email: "ada.drive@gmail.com", refreshToken: again.refreshToken, scopes: [DRIVE_FILE_SCOPE] });
    ctx.fake.revoke(mine.refreshToken);
    expect(holderOf(ctx, await tokenFor(ctx, ctx.ada, space))).toEqual({ email: "ada.drive@gmail.com", scope: DRIVE_FILE_SCOPE });
    expect(tokenCalls(ctx)).toBe(before + 1);

    // A team's members share its connection's kept token, and nothing asks Google Cloud for a reader's.
    const team = await teamWithStorage(ctx, "Robotics Club");
    await tokenFor(ctx, ctx.grace, team.spaceId);
    const afterFirst = tokenCalls(ctx);
    await tokenFor(ctx, ctx.ada, team.spaceId);
    expect(tokenCalls(ctx)).toBe(afterFirst);
    expect(ctx.fake.impersonations).toEqual([]);
  });

  it("the list surfaces a database failure instead of calling it not set up", async () => {
    const ctx = await mediaContext();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = { ...handlerDeps(ctx, ctx.ada), drive: async () => Promise.reject(new Error("connection terminated")) };
    const list = makeMediaHandlers(deps).list;
    const answer = await list(new Request(`https://app.test/api/media?space=${SEED_TEAM_ID}`));
    expect(answer.status).toBe(500);
    // The read token is the reader's alone: the Drive client isn't asked for it.
    const readToken = makeReadTokenHandler({ ...deps, drive: async () => Promise.reject(new Error("not this one")) });
    const token = await readToken(new Request(`https://app.test/api/drive/read-token?space=${SEED_TEAM_ID}`, { method: "POST", headers: { origin: "https://app.test" } }));
    expect(token.status).toBe(200);
  });

  it("says what a broken Drive means in plain words", () => {
    expect(MEDIA_MESSAGES.brokenTitle).toBe("Google Drive needs reconnecting");
    expect(MEDIA_MESSAGES.broken).toBe(BROKEN.message);
  });
});
