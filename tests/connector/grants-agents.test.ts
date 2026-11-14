import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { oauthAccessToken } from "@/db/schema";
import { removeEntry } from "@/lib/allowlist/service";
import { resolveConnectorCaller } from "@/lib/connector/caller";
import { connectedEmails, revokeAccess, revokeClientGrant } from "@/lib/connector/grants";
import { createAgentToken, listAgentTokens, resolveAgentToken } from "@/lib/connector/tokens";
import { CLAUDE_CALLBACK, MCP_URL, claimsOf, startConnectorApp, type ConnectorApp } from "../helpers/connector";

let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));

let app: ConnectorApp;
beforeAll(async () => {
  app = await startConnectorApp();
  testDb = app.db;
});
afterAll(() => app.stop());

const count = async (table: "oauth_access_token" | "oauth_refresh_token" | "oauth_consent" | "agent_token", userId: string, clientId?: string) =>
  rowsOf<{ n: number }>(await app.db.execute(sql`
    select count(*)::int as n from ${sql.identifier(table)}
    where user_id = ${userId} ${clientId === undefined ? sql`` : sql`and client_id = ${clientId}`}`))[0].n;
const tokenFor = (userId: string, name = "Agents SDK") => createAgentToken(app.db, { userId, name, agent: "openai-api" });
const who = (c: { accessToken: string }) => resolveConnectorCaller(app.db, claimsOf(c.accessToken));
const refresh = (c: { refreshToken?: string; clientId: string }) =>
  app.token({ grant_type: "refresh_token", refresh_token: c.refreshToken!, client_id: c.clientId });

// A sign-in code the agent was sent and has not yet exchanged for a token.
async function issueCode(c: { cookie: string; clientId: string }) {
  const { verifier, challenge } = app.pkce();
  const asked = await app.authorize({ clientId: c.clientId, cookie: c.cookie, challenge });
  const back = asked.pathname === "/consent" ? await app.decide({ cookie: c.cookie, consentUrl: asked, accept: true }) : asked;
  return { clientId: c.clientId, code: back.searchParams.get("code")!, verifier };
}
const exchange = (issued: { clientId: string; code: string; verifier: string }) => app.token({
  grant_type: "authorization_code", code: issued.code, redirect_uri: CLAUDE_CALLBACK, client_id: issued.clientId,
  code_verifier: issued.verifier, resource: MCP_URL,
});

describe("ending a member's access", () => {
  it("revokeAccess deletes the member's access tokens too, and only theirs", async () => {
    const ada = await app.signIn("ada@gmail.com");
    const grace = await app.signIn("grace@gmail.com");
    const adas = await tokenFor(ada.userId);
    await tokenFor(ada.userId, "Second");
    const graces = await tokenFor(grace.userId);

    await revokeAccess(app.db, { userId: ada.userId }, { sessions: false });

    expect(await count("agent_token", ada.userId)).toBe(0);
    expect(await resolveAgentToken(app.db, adas.token)).toBeNull();
    expect(await resolveAgentToken(app.db, graces.token)).toMatchObject({ userId: grace.userId });
  });

  it("revoking by email works the same way", async () => {
    const linus = await app.signIn("linus@gmail.com");
    const { token } = await tokenFor(linus.userId);
    await revokeAccess(app.db, { email: "  Linus@Gmail.com " }, { sessions: true });
    expect(await resolveAgentToken(app.db, token)).toBeNull();
  });

  it("removing a member from the allowlist deletes their access tokens", async () => {
    const margaret = await app.signIn("margaret@gmail.com");
    const { token } = await tokenFor(margaret.userId);
    await removeEntry(app.db, "margaret@gmail.com");
    expect(await count("agent_token", margaret.userId)).toBe(0);
    expect(await resolveAgentToken(app.db, token)).toBeNull();
  });
});

describe("ending one agent's access", () => {
  it("removes that client's tokens, refresh tokens, consent and codes for that member only", async () => {
    // The member has two agents connected; another member shares the first agent's client.
    const first = await app.connect("hedy@gmail.com");
    const second = await app.connect("hedy@gmail.com", "editor", { clientId: app.newClient({ name: "Cursor" }) });
    const other = await app.connect("annie@gmail.com", "editor", { clientId: first.clientId });
    const { token } = await tokenFor(first.userId);
    // A stored access token for each, as the provider keeps when a token is not for this endpoint.
    for (const [i, c] of [first, second, other].entries()) {
      await app.db.insert(oauthAccessToken).values({
        id: `stored-${i}`, token: `stored-${i}-value`, clientId: c.clientId, userId: c.userId, refreshId: null,
        expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date(), scopes: ["offline_access"],
      });
    }
    for (const c of [first, second, other]) {
      expect(await count("oauth_consent", c.userId, c.clientId)).toBe(1);
      expect(await count("oauth_access_token", c.userId, c.clientId)).toBeGreaterThan(0);
      expect(await count("oauth_refresh_token", c.userId, c.clientId)).toBeGreaterThan(0);
    }
    const firstCode = await issueCode(first);
    const secondCode = await issueCode(second);
    const othersCode = await issueCode(other);

    await revokeClientGrant(app.db, first.userId, first.clientId);
    // Twice: ending it again is harmless.
    await revokeClientGrant(app.db, first.userId, first.clientId);

    for (const table of ["oauth_consent", "oauth_access_token", "oauth_refresh_token"] as const) {
      expect(await count(table, first.userId, first.clientId), table).toBe(0);
      expect(await count(table, second.userId, second.clientId), table).toBeGreaterThan(0);
      expect(await count(table, other.userId, other.clientId), table).toBeGreaterThan(0);
    }
    expect(await who(first)).toEqual({ ok: false, reason: "revoked" });
    expect(await who(second)).toMatchObject({ ok: true });
    expect(await who(other)).toMatchObject({ ok: true });
    expect((await refresh(first)).ok).toBe(false);
    expect((await refresh(second)).status).toBe(200);
    expect((await refresh(other)).status).toBe(200);

    // The code for the ended agent is gone; the member's other agent and the other member keep theirs.
    const refused = await exchange(firstCode);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("invalid_grant");
    expect((await exchange(secondCode)).status).toBe(200);
    expect((await exchange(othersCode)).status).toBe(200);

    // Access tokens are separate: they have their own Revoke.
    expect(await resolveAgentToken(app.db, token)).toMatchObject({ userId: first.userId });
    expect(await listAgentTokens(app.db, first.userId)).toHaveLength(1);
  });

  it("leaves verification rows that are not sign-in codes alone", async () => {
    const c = await app.connect("ida@gmail.com");
    await app.db.execute(sql`
      insert into verification (id, identifier, value, expires_at)
      values ('plain-1', 'plain-1', 'not json', now() + interval '1 hour'),
             ('state-1', 'state-1', ${JSON.stringify({ type: "state", userId: c.userId, query: { client_id: c.clientId } })}, now() + interval '1 hour')`);
    await revokeClientGrant(app.db, c.userId, c.clientId);
    expect(rowsOf(await app.db.execute(sql`select id from verification where id in ('plain-1', 'state-1')`))).toHaveLength(2);
  });
});

describe("who is connected", () => {
  it("counts a member who holds only an access token, until it expires or is revoked", async () => {
    const tokenOnly = await app.signIn("joan@gmail.com");
    const expired = await app.signIn("mary@gmail.com");
    await app.signIn("frances@gmail.com");
    expect(await connectedEmails(app.db)).not.toContain("joan@gmail.com");

    const { summary } = await tokenFor(tokenOnly.userId);
    await createAgentToken(app.db, { userId: expired.userId, name: "Old", agent: "codex", expiresInDays: 1 });
    await app.db.execute(sql`update agent_token set expires_at = ${new Date(Date.now() - 1000).toISOString()} where user_id = ${expired.userId}`);

    const emails = await connectedEmails(app.db);
    expect(emails).toContain("joan@gmail.com");
    expect(emails).not.toContain("mary@gmail.com");
    expect(emails).not.toContain("frances@gmail.com");

    await app.db.execute(sql`update agent_token set expires_at = ${new Date(Date.now() + 60_000).toISOString()} where id = ${summary.id}`);
    expect(await connectedEmails(app.db)).toContain("joan@gmail.com");
    await revokeAccess(app.db, { userId: tokenOnly.userId }, { sessions: false });
    expect(await connectedEmails(app.db)).not.toContain("joan@gmail.com");
  });

  it("still counts a member connected through OAuth, once", async () => {
    const c = await app.connect("barbara@gmail.com");
    await tokenFor(c.userId);
    const emails = [...(await connectedEmails(app.db))];
    expect(emails.filter((e) => e === "barbara@gmail.com")).toHaveLength(1);
  });
});
