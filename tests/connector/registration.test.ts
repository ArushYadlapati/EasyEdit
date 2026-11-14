import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { resolveConnectorCaller } from "@/lib/connector/caller";
import { BASE_URL, CLAUDE_CALLBACK, MCP_URL, claimsOf, clientDocument, startConnectorApp, type ConnectorApp } from "../helpers/connector";

let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));

let app: ConnectorApp;
beforeAll(async () => {
  app = await startConnectorApp();
  testDb = app.db;
});
afterAll(() => app.stop());

const clientRows = async () =>
  rowsOf<{ n: number }>(await app.db.execute(sql`select count(*)::int as n from oauth_client`))[0].n;

// Each registration from its own address, so the per-address limit is not what answers.
let registrations = 0;
function registerRaw(body: unknown, ip = `192.0.2.${++registrations}`) {
  return app.send(new Request(`${BASE_URL}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  }));
}

// What Claude Code, Cursor and VS Code send when they register themselves.
const LOOPBACK = "http://localhost:43117/callback";
const CURSOR_CALLBACK = "cursor://anysphere.cursor-mcp/oauth/callback";
const claudeCode = {
  client_name: "Claude Code (easyedit)", redirect_uris: [LOOPBACK], grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"], token_endpoint_auth_method: "none",
};
const cursor = { ...claudeCode, client_name: "Cursor", redirect_uris: [CURSOR_CALLBACK] };
const vscode = {
  client_name: "Visual Studio Code", client_uri: "https://code.visualstudio.com/",
  grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"], response_types: ["code"],
  redirect_uris: [
    "https://insiders.vscode.dev/redirect", "https://vscode.dev/redirect", "http://localhost", "http://127.0.0.1",
    "http://localhost:33418", "http://127.0.0.1:33418",
  ],
  token_endpoint_auth_method: "none",
};

type Registered = { client_id: string; client_secret?: string };
const clientRow = async (clientId: string) =>
  rowsOf<{ grant_types: string[]; skip_consent: boolean | null; user_id: string | null; client_credentials_scopes: string[] }>(
    await app.db.execute(sql`select grant_types, skip_consent, user_id, client_credentials_scopes from oauth_client where client_id = ${clientId}`),
  )[0];

describe("agents registering themselves", () => {
  it("are offered the registration address", async () => {
    const meta = await (await app.send(new Request(`${BASE_URL}/.well-known/oauth-authorization-server/api/auth`))).json();
    expect(meta.registration_endpoint).toBe(`${BASE_URL}/api/auth/oauth2/register`);
  });

  it("registers Claude Code, Cursor and VS Code as they ask, with only the code and refresh grants", async () => {
    for (const body of [claudeCode, cursor, vscode]) {
      const res = await registerRaw(body);
      expect(res.status, body.client_name).toBe(201);
      const { client_id } = (await res.json()) as Registered;
      const row = await clientRow(client_id);
      expect(row.grant_types, body.client_name).toEqual(["authorization_code", "refresh_token"]);
      expect(row.skip_consent, body.client_name).toBeNull();
      expect(row.user_id, body.client_name).toBeNull();
      expect(row.client_credentials_scopes, body.client_name).toEqual([]);
    }
  });

  it("refuses a registration that lists any address no known agent uses, or none, and keeps nothing", async () => {
    const before = await clientRows();
    for (const redirect_uris of [
      ["https://evil.example/callback"], [LOOPBACK, "https://evil.example/callback"], [CLAUDE_CALLBACK, `${CLAUDE_CALLBACK}/`],
      ["https://127.0.0.1/cb"], ["http://127.0.0.1.evil.com/cb"], ["javascript:alert(1)"], ["myapp://callback"], [], [7], "http://localhost/cb",
    ]) {
      const res = await registerRaw({ ...claudeCode, redirect_uris });
      expect(res.status, JSON.stringify(redirect_uris)).toBe(400);
      expect(((await res.json()) as { error: string }).error, JSON.stringify(redirect_uris)).toBe("invalid_redirect_uri");
    }
    const res = await registerRaw({ ...claudeCode, redirect_uris: undefined });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_redirect_uri");
    expect(await clientRows()).toBe(before);
  });

  it("refuses a registration that asks to skip the consent page or to be told of logouts, and keeps nothing", async () => {
    const before = await clientRows();
    for (const extra of [
      { skip_consent: true }, { skip_consent: false }, { skip_consent: "true" }, { backchannel_logout_uri: "https://example.com/logout" },
      { backchannel_logout_session_required: true },
    ]) {
      const res = await registerRaw({ ...claudeCode, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(((await res.json()) as { error: string }).error, JSON.stringify(extra)).toBe("invalid_client_metadata");
    }
    expect(await clientRows()).toBe(before);
  });

  it("never grants a registration the client-credentials grant, which needs no member", async () => {
    const res = await registerRaw({ ...claudeCode, grant_types: ["authorization_code", "refresh_token", "client_credentials"] });
    if (res.status === 201) {
      const { client_id } = (await res.json()) as Registered;
      expect((await clientRow(client_id)).grant_types).not.toContain("client_credentials");
    } else {
      expect(res.status).toBe(400);
    }
    const only = await registerRaw({ ...claudeCode, grant_types: ["client_credentials"], response_types: undefined });
    expect(only.status).toBe(400);
  });

  it("still limits registrations per address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await registerRaw({ ...claudeCode, client_name: `Burst ${i}` }, "192.0.2.250")).status);
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("asks the member every time, sends the code only to the agent's own address, and names the agent in the op log", async () => {
    const { userId, cookie } = await app.signIn("hedy@gmail.com");
    const { client_id: clientId } = (await (await registerRaw(cursor)).json()) as Registered;
    const elsewhere = await app.authorize({ clientId, cookie, redirectUri: "https://evil.example/callback" });
    expect(elsewhere.searchParams.get("error")).toBe("invalid_redirect");

    const { verifier, challenge } = app.pkce();
    const asked = await app.authorize({ clientId, cookie, challenge, redirectUri: CURSOR_CALLBACK, prompt: "none" });
    expect(asked.pathname).toBe("/consent");
    const back = await app.decide({ cookie, consentUrl: asked, accept: true });
    expect(back.href.startsWith(`${CURSOR_CALLBACK}?`)).toBe(true);
    const tokens = (await (await app.token({
      grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: CURSOR_CALLBACK,
      client_id: clientId, code_verifier: verifier, resource: MCP_URL,
    })).json()) as { access_token: string };
    expect(await resolveConnectorCaller(app.db, claimsOf(tokens.access_token))).toMatchObject({ ok: true, agent: "cursor" });
    expect((await app.authorize({ clientId, cookie, redirectUri: CURSOR_CALLBACK })).pathname).toBe("/consent");

    const made = await app.callTool(tokens.access_token, "create_project", { name: "From Cursor", format: "short_9x16" });
    expect(made.isError, made.text).toBe(false);
    const [row] = rowsOf<{ created_by: string }>(await app.db.execute(sql`select created_by from projects where name = 'From Cursor'`));
    expect(row.created_by).toBe(`agent:cursor:${userId}`);
    const listed = await app.callTool(tokens.access_token, "list_projects");
    expect(listed.text).toContain("Cursor (for Hedy)");
  });
});

describe("what the sign-in server refuses", () => {

  it("2. never sends a member to another address, even for an app row that lists one", async () => {
    await app.db.execute(sql`
      insert into oauth_client (id, client_id, redirect_uris, token_endpoint_auth_method, grant_types, response_types, created_at)
      values ('evil', 'evil', array['https://evil.example/callback'], 'none', array['authorization_code'], array['code'], now())`);
    const { cookie } = await app.signIn("ada@gmail.com");
    const to = await app.authorize({ clientId: "evil", cookie, redirectUri: "https://evil.example/callback" });
    expect(`${to.origin}${to.pathname}`).toBe(`${BASE_URL}/api/auth/error`);
    expect(to.searchParams.get("error")).toBe("invalid_redirect");
  });

  it("3. never sends a member to another address, even for a document on claude.ai that lists one", async () => {
    const url = "https://claude.ai/oauth/elsewhere.json";
    app.serveDocument(url, clientDocument(url, { redirectUris: ["https://evil.example/callback"] }));
    const { cookie } = await app.signIn("barbara@gmail.com");
    const to = await app.authorize({ clientId: url, cookie, redirectUri: "https://evil.example/callback" }).catch(() => null);
    expect(to?.pathname).not.toBe("/consent");
    expect(to?.origin).not.toBe("https://evil.example");
  });

  it("4. fetches no metadata document from another host", async () => {
    const elsewhere = app.serveDocument("https://evil.example/client.json");
    const { cookie } = await app.signIn("grace@gmail.com");
    const to = await app.authorize({ clientId: elsewhere, cookie }).catch(() => null);
    expect(to?.pathname).not.toBe("/consent");
    expect(to?.origin).not.toBe("https://claude.ai");
    expect(app.documents.asked).not.toContain(elsewhere);
    expect(rowsOf(await app.db.execute(sql`select 1 from oauth_client where client_id = ${elsewhere}`))).toHaveLength(0);
  });

  it("5. a signed-in member cannot create an app through the API", async () => {
    const { cookie } = await app.signIn("linus@gmail.com");
    const before = await clientRows();
    for (const path of ["/api/auth/oauth2/create-client", "/api/auth/oauth2/register"]) {
      const res = await app.send(new Request(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: BASE_URL },
        body: JSON.stringify({ redirect_uris: [CLAUDE_CALLBACK], client_name: "Mine" }),
      }));
      expect([401, 403], path).toContain(res.status);
    }
    expect(await clientRows()).toBe(before);
  });

  it("6. the session-token endpoint is off", async () => {
    const { cookie } = await app.signIn("margaret@gmail.com");
    expect((await app.send(new Request(`${BASE_URL}/api/auth/token`, { headers: { cookie } }))).status).toBe(404);
  });

  it("7. offers only the authorization-code and refresh grants", async () => {
    const meta = await (await app.send(new Request(`${BASE_URL}/.well-known/oauth-authorization-server/api/auth`))).json();
    expect([...meta.grant_types_supported].sort()).toEqual(["authorization_code", "refresh_token"]);
  });

  it("8. limits token requests per address, and the count survives a new server instance", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      app.forgetServerInstance();
      const res = await app.send(new Request(`${BASE_URL}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.77" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: "nope", redirect_uri: CLAUDE_CALLBACK, client_id: "nope" }),
      }));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
    // The in-memory store outlives a new auth instance inside one process, so check that the count is kept in the database.
    const kept = rowsOf<{ n: number }>(await app.db.execute(sql`select max(count)::int as n from rate_limit where key like ${"203.0.113.77|%"}`));
    expect(kept[0].n).toBe(20);
  });
});
