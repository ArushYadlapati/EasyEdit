import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { BASE_URL, CLAUDE_CALLBACK, MCP_URL, startConnectorApp, type ConnectorApp } from "../helpers/connector";
import { addPasskey, createSoftAuthenticator, sessionCookieOf, signInWithPasskey, type SoftAuthenticator } from "../helpers/passkey-authenticator";

let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));

let app: ConnectorApp;
beforeAll(async () => {
  app = await startConnectorApp();
  testDb = app.db;
});
afterAll(() => app.stop());

let addresses = 0;
const ip = () => `192.0.2.${++addresses}`;

// A request to authorize as a browser sends it, for Claude's client, with the caller's own state and challenge.
async function authorizeRaw(input: { clientId: string; cookie?: string; state: string; challenge: string; maxAge?: string }): Promise<URL> {
  const query = new URLSearchParams({
    response_type: "code", client_id: input.clientId, redirect_uri: CLAUDE_CALLBACK, scope: "offline_access",
    state: input.state, code_challenge: input.challenge, code_challenge_method: "S256", resource: MCP_URL,
  });
  if (input.maxAge !== undefined) query.set("max_age", input.maxAge);
  const headers: Record<string, string> = { "x-forwarded-for": ip() };
  if (input.cookie) headers.cookie = input.cookie;
  const res = await app.send(new Request(`${BASE_URL}/api/auth/oauth2/authorize?${query}`, { headers }));
  return new URL(res.headers.get("location") ?? "", BASE_URL);
}

const consents = async (userId: string) =>
  rowsOf(await app.db.execute(sql`select 1 from oauth_consent where user_id = ${userId}`)).length;

// A signed login link that no longer asks for consent, made by one member for another (review finding C1, steps 1 and 2).
async function linkWithoutConsent(clientId: string): Promise<URL> {
  const mallory = await app.signIn(`mallory${++addresses}@gmail.com`, "viewer");
  const asked = await authorizeRaw({ clientId, cookie: mallory.cookie, state: "ATTACKER", challenge: app.pkce().challenge, maxAge: "0" });
  expect(asked.pathname).toBe("/login");
  expect(asked.searchParams.get("prompt")).toContain("consent");
  const link = await app.decide({ cookie: mallory.cookie, consentUrl: asked, accept: true });
  expect(link.pathname).toBe("/login");
  expect(link.searchParams.get("sig")).not.toBeNull();
  return link;
}

// A member who signed in with Google once and added a passkey, as from the Passkeys dialog.
async function withPasskey(cookie: string): Promise<SoftAuthenticator> {
  const authenticator = createSoftAuthenticator();
  const res = await addPasskey(app.send, { cookie, authenticator, ip: ip() });
  expect(res.status, await res.clone().text()).toBe(200);
  return authenticator;
}

// The member presses "Sign in with a passkey" on the login link. The browser's fetch gets JSON back, and Better Auth's
// client follows the redirect it names.
async function passkeySignIn(authenticator: SoftAuthenticator, loginUrl: URL): Promise<{ location: URL; cookie: string }> {
  const res = await signInWithPasskey(app.send, { authenticator, ip: ip(), oauthQuery: loginUrl.search.slice(1) });
  const body = (await res.json()) as { redirect?: boolean; url?: string };
  if (body.redirect !== true || typeof body.url !== "string") throw new Error(`no redirect after passkey sign-in: ${res.status} ${JSON.stringify(body)}`);
  const cookie = sessionCookieOf(res);
  if (cookie === null) throw new Error("passkey sign-in set no session cookie");
  return { location: new URL(body.url, BASE_URL), cookie };
}

describe("signing in with a passkey while connecting Claude", () => {
  it("a login link made by another member ends on the consent page for a member who already has a grant", async () => {
    const bob = await app.connect("bob@gmail.com");
    const authenticator = await withPasskey(bob.cookie);
    const link = await linkWithoutConsent(bob.clientId);
    // The link no longer asks for consent: without the rule, the sign-in would send a code straight to Claude.
    expect(link.searchParams.get("prompt") ?? "").not.toContain("consent");

    const { location } = await passkeySignIn(authenticator, link);

    expect(location.pathname).toBe("/consent");
    expect(location.searchParams.get("code")).toBeNull();
    expect(`${location.origin}${location.pathname}`).not.toBe(CLAUDE_CALLBACK);
  });

  it("a passkey sign-in while connecting Claude carries on to the consent page", async () => {
    const ada = await app.connect("ada@gmail.com");
    const authenticator = await withPasskey(ada.cookie);
    const asked = await authorizeRaw({ clientId: ada.clientId, state: "s-ada", challenge: app.pkce().challenge });
    expect(asked.pathname).toBe("/login");

    const { location } = await passkeySignIn(authenticator, asked);

    expect(location.pathname).toBe("/consent");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("a member with no grant goes from a passkey sign-in to the consent page, and Allow then gives Claude a code once", async () => {
    const linus = await app.signIn("linus@gmail.com");
    const authenticator = await withPasskey(linus.cookie);
    const clientId = app.newClient();
    const asked = await authorizeRaw({ clientId, state: "s-linus", challenge: app.pkce().challenge });
    expect(asked.pathname).toBe("/login");

    const { location, cookie } = await passkeySignIn(authenticator, asked);
    expect(location.pathname).toBe("/consent");
    expect(await consents(linus.userId)).toBe(0);

    const back = await app.decide({ cookie, consentUrl: location, accept: true });
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get("code")).toEqual(expect.any(String));
    expect(back.searchParams.get("state")).toBe("s-linus");
    expect(await consents(linus.userId)).toBe(1);
  });
});
