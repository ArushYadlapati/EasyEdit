import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeSignature } from "better-auth/crypto";
import { rowsOf, type DB } from "@/db";
import { cleanClientName, isConnectorRequest, readConsentRequest, type SearchParams } from "@/lib/connector/consent";
import { BASE_URL, CLAUDE_CALLBACK, MCP_URL, SECRET, clientDocument, startConnectorApp, type ConnectorApp } from "../helpers/connector";

let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));

let app: ConnectorApp;
beforeAll(async () => {
  app = await startConnectorApp();
  testDb = app.db;
});
afterAll(() => app.stop());

// What the consent page receives from Next for an address.
function pageParams(url: URL): SearchParams {
  const out: SearchParams = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

// What Claude sees on its own callback: claude.ai's metadata document, and the code going back to claude.ai.
const CLAUDE_VIEW = {
  clientName: "Claude", verifiedHost: "claude.ai", agent: "claude", nameVerified: true, agentName: "Claude",
  destination: { kind: "web", host: "claude.ai" },
};

// A request signed the way the sign-in server signs one, for requests it would never send.
async function signedByHand(params: Record<string, string>): Promise<SearchParams> {
  const query = new URLSearchParams({ ...params, exp: String(Math.floor(Date.now() / 1000) + 600) });
  const sorted = [...query.entries()].sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
  return { ...Object.fromEntries(query), sig: await makeSignature(new URLSearchParams(sorted).toString(), SECRET) };
}

describe("the consent page", () => {
  it("asks a first-time member, and Allow sends them to Claude with a code", async () => {
    const { cookie } = await app.signIn("ada@gmail.com");
    const asked = await app.authorize({ clientId: app.newClient(), cookie, state: "st-9" });
    expect(asked.pathname).toBe("/consent");
    expect(isConnectorRequest(pageParams(asked))).toBe(true);
    expect(await readConsentRequest(app.db, SECRET, pageParams(asked))).toEqual({ ok: true, view: CLAUDE_VIEW });

    const back = await app.decide({ cookie, consentUrl: asked, accept: true });
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get("code")).toEqual(expect.any(String));
    expect(back.searchParams.get("state")).toBe("st-9");
  });

  it("asks again a member who allowed the same app before, also when the request says prompt=none", async () => {
    const { cookie } = await app.signIn("grace@gmail.com");
    const clientId = app.newClient();
    await app.decide({ cookie, consentUrl: await app.authorize({ clientId, cookie }), accept: true });
    expect((await app.authorize({ clientId, cookie })).pathname).toBe("/consent");
    expect((await app.authorize({ clientId, cookie, prompt: "none" })).pathname).toBe("/consent");
  });

  it("asks again when the request is a form post that says prompt=none", async () => {
    const { cookie } = await app.signIn("barbara@gmail.com");
    const clientId = app.newClient();
    await app.decide({ cookie, consentUrl: await app.authorize({ clientId, cookie }), accept: true });
    const res = await app.send(new Request(`${BASE_URL}/api/auth/oauth2/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie, "x-forwarded-for": "203.0.113.31" },
      body: new URLSearchParams({
        response_type: "code", client_id: clientId, redirect_uri: CLAUDE_CALLBACK, scope: "offline_access", state: "s-1",
        code_challenge: app.pkce().challenge, code_challenge_method: "S256", resource: MCP_URL, prompt: "none",
      }),
    }));
    expect(new URL(res.headers.get("location") ?? "", BASE_URL).pathname).toBe("/consent");
  });

  it("Don't allow sends the member back to Claude with access_denied, no code and no grant", async () => {
    const { userId, cookie } = await app.signIn("linus@gmail.com");
    const back = await app.decide({ cookie, consentUrl: await app.authorize({ clientId: app.newClient(), cookie }), accept: false });
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    expect(rowsOf(await app.db.execute(sql`select 1 from oauth_consent where user_id = ${userId}`))).toHaveLength(0);
  });

  it("refuses a link that was changed, and one for an app that does not exist", async () => {
    const { cookie } = await app.signIn("margaret@gmail.com");
    const asked = await app.authorize({ clientId: app.newClient(), cookie });
    const changed = new URL(asked);
    changed.searchParams.set("client_id", app.newClient({ name: "Other" }));
    expect(await readConsentRequest(app.db, SECRET, pageParams(changed))).toEqual({ ok: false });
    expect(await readConsentRequest(app.db, SECRET, { client_id: "nope" })).toEqual({ ok: false });
    expect(await readConsentRequest(app.db, "another-secret-".repeat(3), pageParams(asked))).toEqual({ ok: false });
    expect(isConnectorRequest({ error: "NOT_ALLOWLISTED" })).toBe(false);
  });

  it("names claude.ai for an app known by its metadata document, and cuts a long name", async () => {
    const { cookie } = await app.signIn("katherine@gmail.com");
    const known = await app.authorize({ clientId: app.newClient(), cookie });
    expect(await readConsentRequest(app.db, SECRET, pageParams(known))).toEqual({ ok: true, view: CLAUDE_VIEW });

    const long = await app.authorize({ clientId: app.newClient({ name: "Claude ".repeat(12) }), cookie });
    const read = await readConsentRequest(app.db, SECRET, pageParams(long));
    expect(read).toMatchObject({ ok: true, view: { verifiedHost: "claude.ai" } });
    expect(read.ok && read.view.clientName?.length).toBe(60);
  });

  it("does not vouch for an app that registered itself before open registration was switched off", async () => {
    await app.db.execute(sql`
      insert into oauth_client (id, client_id, name, redirect_uris, token_endpoint_auth_method, grant_types, response_types, created_at)
      values ('old', 'old', 'Helper', array[${CLAUDE_CALLBACK}], 'none', array['authorization_code'], array['code'], now())`);
    const { cookie } = await app.signIn("dorothy@gmail.com");
    // Such a row was never linked to the endpoint, so this asks without naming it.
    const asked = await app.authorize({ clientId: "old", cookie, resource: null });
    expect(asked.pathname).toBe("/consent");
    // It asks to send the code to Claude's callback, which only Claude uses, so the page names Claude; no host vouches.
    expect(await readConsentRequest(app.db, SECRET, pageParams(asked))).toEqual({
      ok: true,
      view: {
        clientName: "Helper", verifiedHost: null, agent: "claude", nameVerified: true, agentName: "Claude",
        destination: { kind: "web", host: "claude.ai" },
      },
    });
  });

  it("names an agent only from where the code goes, and takes no app's word for its own name", async () => {
    const loopback = "http://127.0.0.1:43117/callback";
    const cursorCallback = "cursor://anysphere.cursor-mcp/oauth/callback";
    const chatgptCallback = "https://chatgpt.com/connector_platform_oauth_redirect";
    await app.db.execute(sql`
      insert into oauth_client (id, client_id, name, redirect_uris, token_endpoint_auth_method, grant_types, response_types, created_at)
      values
        ('cur', 'cur', 'Cursor', array[${cursorCallback}], 'none', array['authorization_code'], array['code'], now()),
        ('gpt', 'gpt', 'ChatGPT', array[${chatgptCallback}], 'none', array['authorization_code'], array['code'], now()),
        ('cc', 'cc', 'Claude Code', array[${loopback}], 'none', array['authorization_code'], array['code'], now()),
        ('insp', 'insp', 'MCP Inspector', array[${loopback}], 'none', array['authorization_code'], array['code'], now()),
        ('anon', 'anon', null, array[${loopback}], 'none', array['authorization_code'], array['code'], now())`);
    const { cookie } = await app.signIn("hedy@gmail.com");
    const view = async (clientId: string, redirectUri: string) => {
      const asked = await app.authorize({ clientId, cookie, redirectUri, resource: null });
      expect(asked.pathname, clientId).toBe("/consent");
      const read = await readConsentRequest(app.db, SECRET, pageParams(asked));
      return read.ok ? read.view : null;
    };
    // Cursor's own app scheme and ChatGPT's callback: the code can only reach that agent.
    expect(await view("cur", cursorCallback)).toEqual({
      clientName: "Cursor", verifiedHost: null, agent: "cursor", nameVerified: true, agentName: "Cursor",
      destination: { kind: "app", name: "Cursor" },
    });
    expect(await view("gpt", chatgptCallback)).toEqual({
      clientName: "ChatGPT", verifiedHost: null, agent: "chatgpt", nameVerified: true, agentName: "ChatGPT",
      destination: { kind: "web", host: "chatgpt.com" },
    });
    // Any program can register as "Claude Code" with a loopback address. The editor still lists it under the name it
    // gave, so the change-list kind follows that guess.
    expect(await view("cc", loopback)).toEqual({
      clientName: "Claude Code", verifiedHost: null, agent: "claude-code", nameVerified: false,
      agentName: "an app that calls itself “Claude Code”", destination: { kind: "this-computer", port: 43117 },
    });
    expect(await view("insp", loopback)).toEqual({
      clientName: "MCP Inspector", verifiedHost: null, agent: "other", nameVerified: false,
      agentName: "an app that calls itself “MCP Inspector”", destination: { kind: "this-computer", port: 43117 },
    });
    expect(await view("anon", loopback)).toEqual({
      clientName: null, verifiedHost: null, agent: "other", nameVerified: false, agentName: "an unnamed app",
      destination: { kind: "this-computer", port: 43117 },
    });
  });

  it("names Claude Code from its metadata document on claude.ai, and knows the code stays on this computer", async () => {
    const loopback = "http://localhost:5555/callback";
    const clientId = app.serveDocument(
      "https://claude.ai/oauth/claude-code-client-metadata",
      clientDocument("https://claude.ai/oauth/claude-code-client-metadata", { name: "Claude Code", redirectUris: [loopback] }),
    );
    const { cookie } = await app.signIn("frances@gmail.com");
    const asked = await app.authorize({ clientId, cookie, redirectUri: loopback });
    expect(asked.pathname).toBe("/consent");
    expect(await readConsentRequest(app.db, SECRET, pageParams(asked))).toEqual({
      ok: true,
      view: {
        clientName: "Claude Code", verifiedHost: "claude.ai", agent: "claude-code", nameVerified: true,
        agentName: "Claude Code", destination: { kind: "this-computer", port: 5555 },
      },
    });
  });

  it("strips invisible and control characters from an app's own name", async () => {
    const loopback = "http://127.0.0.1:43117/callback";
    const sneaky = "\u202Bevil\u202C \u2067Claude\u2069\u200B Code\u0007\u00A0\n\u200E\u200F\u061C\u2066\u202E\uFEFF\u200C\u200D";
    await app.db.execute(sql`
      insert into oauth_client (id, client_id, name, redirect_uris, token_endpoint_auth_method, grant_types, response_types, created_at)
      values ('bidi', 'bidi', ${sneaky}, array[${loopback}], 'none', array['authorization_code'], array['code'], now())`);
    const { cookie } = await app.signIn("annie@gmail.com");
    const asked = await app.authorize({ clientId: "bidi", cookie, redirectUri: loopback, resource: null });
    expect(await readConsentRequest(app.db, SECRET, pageParams(asked))).toMatchObject({
      ok: true, view: { clientName: "evil Claude Code", nameVerified: false, agentName: "an app that calls itself “evil Claude Code”" },
    });
  });

  it("refuses a request with no redirect address, or one that goes nowhere EasyEdit knows", async () => {
    await app.db.execute(sql`
      insert into oauth_client (id, client_id, name, redirect_uris, token_endpoint_auth_method, grant_types, response_types, created_at)
      values ('nowhere', 'nowhere', 'Helper', array[${CLAUDE_CALLBACK}], 'none', array['authorization_code'], array['code'], now())`);
    const base = { response_type: "code", client_id: "nowhere", scope: "offline_access", state: "s-1" };
    // Signed by hand like the sign-in server, so only the address can be what is refused.
    expect(await readConsentRequest(app.db, SECRET, await signedByHand({ ...base, redirect_uri: CLAUDE_CALLBACK }))).toMatchObject({ ok: true });
    expect(await readConsentRequest(app.db, SECRET, await signedByHand({ ...base, redirect_uri: "http://127.0.0.1/cb" }))).toMatchObject({
      ok: true, view: { destination: { kind: "this-computer", port: 80 } },
    });
    expect(await readConsentRequest(app.db, SECRET, await signedByHand(base))).toEqual({ ok: false });
    for (const redirect_uri of ["", "not an address", "https://evil.example/callback", "http://example.com/cb", "myapp://callback"]) {
      expect(await readConsentRequest(app.db, SECRET, await signedByHand({ ...base, redirect_uri })), redirect_uri).toEqual({ ok: false });
    }
    const twice = await signedByHand({ ...base, redirect_uri: CLAUDE_CALLBACK });
    expect(await readConsentRequest(app.db, SECRET, { ...twice, redirect_uri: [CLAUDE_CALLBACK, CLAUDE_CALLBACK] })).toEqual({ ok: false });
  });
});

describe("an app's own name", () => {
  it("loses bidi controls, zero-width and control characters, keeps one space between words, and is cut to 60", () => {
    expect(cleanClientName("\u202ECode Claude\u202C")).toBe("Code Claude");
    expect(cleanClientName("Claude\u2066 \u2069Code")).toBe("Claude Code");
    expect(cleanClientName("Cl\u200Bau\u200Cde\u200D \uFEFFCode\u200E\u200F\u061C")).toBe("Claude Code");
    expect(cleanClientName("  Claude\t\n\r  Code\u0007\u009B  ")).toBe("Claude Code");
    expect(cleanClientName("\u202E\u200B \n")).toBeNull();
    expect(cleanClientName(null)).toBeNull();
    expect(cleanClientName("é".repeat(70))).toBe("é".repeat(60));
    expect(cleanClientName(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });
});
