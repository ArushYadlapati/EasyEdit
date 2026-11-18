import { describe, expect, it, vi } from "vitest";
import { socialConnection } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import type { SocialConfig } from "@/lib/social/config";
import { makeSocialConnectHandlers } from "@/lib/social/connect-handlers";
import { YOUTUBE_READ_SCOPE, YOUTUBE_UPLOAD_SCOPE } from "@/lib/social/youtube-api";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { open, seal } from "@/lib/storage/secret-box";
import { joinSpace, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { fakeYoutube, SOCIAL_BASE as BASE, socialTestConfig } from "../helpers/social";

const COOKIE = "ee_social_oauth";
const REFUSED = `${BASE}/dashboard?youtube=refused`;
const PAGE = `${BASE}/s/seattle-solvers/settings/socials`;

async function setup(opts: { config?: SocialConfig | null } = {}) {
  const db = await makeTestDb();
  const cfg = socialTestConfig();
  await joinSpace(db, { id: "u1" }, "admin");
  await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
  await joinSpace(db, { id: "u2" }, "editor");
  const google = fakeYoutube(cfg);
  const signedIn: { user: CurrentUser | null } = { user: testUser({ id: "u1" }) };
  const clock = { now: new Date("2026-11-17T12:00:00Z") };
  const handlers = makeSocialConnectHandlers({
    db: () => db,
    auth: async () => signedIn.user ?? Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }),
    config: () => (opts.config === undefined ? cfg : opts.config),
    fetch: google.fetch,
    now: () => clock.now,
  });
  // Presses Connect and returns what Google would send back: the state and the cookie the browser now holds.
  const start = async (space: string = SEED_TEAM_ID) => {
    const res = await handlers.connect(new Request(`${BASE}/api/social/youtube/connect?space=${space}`, { headers: { "x-forwarded-proto": "https" } }));
    const line = res.headers.getSetCookie().find((entry) => entry.startsWith(`${COOKIE}=`)) ?? "";
    const location = res.headers.get("location") ?? "";
    return { res, line, cookie: line.split(";")[0], location, state: location.startsWith("https://accounts.google.com") ? new URL(location).searchParams.get("state") : null };
  };
  const back = (query: string, cookie: string) => handlers.callback(new Request(`${BASE}/api/social/youtube/callback?${query}`, { headers: { cookie } }));
  const rows = () => db.select().from(socialConnection);
  return { db, cfg, google, signedIn, clock, handlers, start, back, rows };
}

describe("connect", () => {
  it("sends a space's admin to Google for the two YouTube scopes, with a sealed cookie only these routes get", async () => {
    const { cfg, start } = await setup();
    const { res, line, location } = await start();
    expect(res.status).toBe(302);
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "yt-client",
      redirect_uri: `${BASE}/api/social/youtube/callback`,
      response_type: "code",
      scope: `openid email ${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_READ_SCOPE}`,
      access_type: "offline",
      prompt: "consent select_account",
      code_challenge_method: "S256",
    });
    expect(line).toMatch(/; Path=\/api\/social\/youtube; Max-Age=3600; HttpOnly; SameSite=Lax; Secure$/);
    const started = JSON.parse(open(line.split(";")[0].slice(COOKIE.length + 1), cfg.tokenKey)) as Record<string, unknown>;
    expect(started).toMatchObject({ userId: "u1", spaceId: SEED_TEAM_ID, state: url.searchParams.get("state") });
    expect(line).not.toContain(String(started.verifier));
  });

  it("lands anyone who does not run the space on the fixed refused page, with no cookie", async () => {
    const { signedIn, start } = await setup();
    for (const [user, space] of [["u2", SEED_TEAM_ID], ["u1", "team_nowhere"], ["u1", ""]] as const) {
      signedIn.user = testUser({ id: user });
      const { res, line } = await start(space);
      expect(res.headers.get("location"), `${user} ${space}`).toBe(REFUSED);
      expect(line).toBe("");
    }
    signedIn.user = null;
    const { res } = await start();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(REFUSED);
  });

  it("is not started by a link on another site", async () => {
    const { handlers } = await setup();
    const from = (site: string) => handlers.connect(new Request(`${BASE}/api/social/youtube/connect?space=${SEED_TEAM_ID}`, { headers: { "sec-fetch-site": site } }));
    const cross = await from("cross-site");
    expect(cross.headers.get("location")).toBe(REFUSED);
    expect(cross.headers.getSetCookie()).toEqual([]);
    for (const site of ["same-origin", "none"]) expect((await from(site)).headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
  });

  it("never goes to Google on a server that isn't set up", async () => {
    const { start } = await setup({ config: null });
    const { res, line } = await start();
    expect(res.headers.get("location")).toBe("/s/seattle-solvers/settings/socials?youtube=not-configured");
    expect(line).toBe("");
  });
});

describe("callback", () => {
  it("exchanges the code, reads the channel and saves the space's connection", async () => {
    const { cfg, google, start, back, rows } = await setup();
    const { cookie, state } = await start();
    const res = await back(`code=the-code&state=${state}`, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${PAGE}?youtube=connected`);
    expect(res.headers.getSetCookie().find((line) => line.startsWith(`${COOKIE}=`))).toMatch(new RegExp(`^${COOKIE}=;.*Max-Age=0`));
    const [exchange] = google.exchanges;
    expect(exchange.get("code")).toBe("the-code");
    expect(exchange.get("redirect_uri")).toBe(`${BASE}/api/social/youtube/callback`);
    expect(exchange.get("code_verifier")).toBeTruthy();
    const [row] = await rows();
    expect(row).toMatchObject({ spaceId: SEED_TEAM_ID, platform: "youtube", connectedBy: "u1", googleSub: "g-yt-1", email: "team@gmail.com", channelId: "UC123", channelTitle: "Seattle Solvers", brokenAt: null });
    expect(open(row.refreshTokenEnc, cfg.tokenKey)).toBe("1//yt-refresh-1");
  });

  it("refuses a state that is not the one it started, another person's cookie, or no cookie", async () => {
    const { cfg, signedIn, start, back, rows, google } = await setup();
    const { cookie, state } = await start();
    expect((await back(`code=c&state=wrong`, cookie)).headers.get("location")).toBe(REFUSED);
    expect((await back(`code=c&state=${state}`, "")).headers.get("location")).toBe(REFUSED);
    const forged = seal(JSON.stringify({ state: "s", verifier: "v", userId: "u1", spaceId: SEED_TEAM_ID, exp: Date.now() + 60_000 }), socialTestConfig().tokenKey);
    expect((await back(`code=c&state=s`, `${COOKIE}=${forged}`)).headers.get("location")).toBe(REFUSED);
    signedIn.user = testUser({ id: "u2" });
    expect((await back(`code=c&state=${state}`, cookie)).headers.get("location")).toBe(REFUSED);
    expect(await rows()).toEqual([]);
    expect(google.exchanges).toEqual([]);
    expect(cfg.clientId).toBe("yt-client");
  });

  it("refuses someone who stopped being the space's admin while on Google's screen", async () => {
    const { db, start, back, rows } = await setup();
    const { cookie, state } = await start();
    await joinSpace(db, { id: "u1" }, "editor");
    expect((await back(`code=c&state=${state}`, cookie)).headers.get("location")).toBe(REFUSED);
    expect(await rows()).toEqual([]);
  });

  it("tells a connect that took too long, was canceled, or failed at Google, each in its own words", async () => {
    const { clock, google, start, back, rows } = await setup();
    let { cookie, state } = await start();
    expect((await back(`error=access_denied&state=${state}`, cookie)).headers.get("location")).toBe(`${PAGE}?youtube=cancelled`);
    expect((await back(`error=server_error&state=${state}`, cookie)).headers.get("location")).toBe(`${PAGE}?youtube=failed`);
    google.exchangeRefusal = "invalid_grant";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await back(`code=c&state=${state}`, cookie)).headers.get("location")).toBe(`${PAGE}?youtube=failed`);
    ({ cookie, state } = await start());
    clock.now = new Date(clock.now.getTime() + 601_000);
    expect((await back(`code=c&state=${state}`, cookie)).headers.get("location")).toBe(`${PAGE}?youtube=expired`);
    expect(await rows()).toEqual([]);
  });

  it("stores nothing when the person unticked uploading", async () => {
    const { google, start, back, rows } = await setup();
    google.grant.scope = `openid ${YOUTUBE_READ_SCOPE}`;
    const { cookie, state } = await start();
    expect((await back(`code=c&state=${state}`, cookie)).headers.get("location")).toBe(`${PAGE}?youtube=needs-upload`);
    expect(await rows()).toEqual([]);
  });

  it("does not connect a Google account that has no channel", async () => {
    const { google, start, back, rows } = await setup();
    google.channel = null;
    const { cookie, state } = await start();
    expect((await back(`code=c&state=${state}`, cookie)).headers.get("location")).toBe(`${PAGE}?youtube=no-channel`);
    expect(await rows()).toEqual([]);
  });

  it("connects without the channel's name when reading it was not allowed, or failed", async () => {
    const { google, start, back, rows } = await setup();
    google.grant.scope = `openid ${YOUTUBE_UPLOAD_SCOPE}`;
    let { cookie, state } = await start();
    expect((await back(`code=c&state=${state}`, cookie)).headers.get("location")).toBe(`${PAGE}?youtube=connected`);
    expect(google.calls.filter((call) => call.includes("/channels"))).toEqual([]);
    expect((await rows())[0]).toMatchObject({ channelId: null, channelTitle: null, email: "team@gmail.com" });

    google.grant.scope = `openid ${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_READ_SCOPE}`;
    google.channelRefusal = { status: 500, reason: "backendError" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    ({ cookie, state } = await start());
    expect((await back(`code=c&state=${state}`, cookie)).headers.get("location")).toBe(`${PAGE}?youtube=connected`);
    expect(await rows()).toHaveLength(1);
  });

  it("is a page for a signed-out visitor and on a server that isn't set up", async () => {
    const { signedIn, start, back } = await setup();
    const { cookie, state } = await start();
    signedIn.user = null;
    const res = await back(`code=c&state=${state}`, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(REFUSED);
    const bare = await setup({ config: null });
    expect((await bare.back("code=c&state=s", "")).headers.get("location")).toBe("/dashboard?youtube=refused");
  });
});
