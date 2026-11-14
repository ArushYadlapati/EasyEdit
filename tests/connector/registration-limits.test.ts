import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { MAX_CLIENT_NAME_LENGTH, MAX_REDIRECT_URI_LENGTH, MAX_REDIRECT_URIS } from "@/lib/connector/auth-rules";
import { pruneUnusedClients } from "@/lib/connector/grants";
import { BASE_URL, startConnectorApp, type ConnectorApp } from "../helpers/connector";

let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));

// The real pruning, unless a test asks it to fail.
const pruning = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock("@/lib/connector/grants", async (original) => {
  const real = await original<typeof import("@/lib/connector/grants")>();
  return {
    ...real,
    pruneUnusedClients: async (...args: Parameters<typeof real.pruneUnusedClients>) => {
      pruning.calls++;
      if (pruning.fail) throw new Error("the database is unreachable");
      return real.pruneUnusedClients(...args);
    },
  };
});

let app: ConnectorApp;
beforeAll(async () => {
  app = await startConnectorApp();
  testDb = app.db;
});
afterAll(() => app.stop());

const clientCount = async () =>
  rowsOf<{ n: number }>(await app.db.execute(sql`select count(*)::int as n from oauth_client`))[0].n;

// Each registration from its own address, so the per-address limit is not what answers.
let registrations = 0;
function register(body: unknown) {
  return app.send(new Request(`${BASE_URL}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++registrations}` },
    body: JSON.stringify(body),
  }));
}

const LOOPBACK = "http://localhost:43117/callback";
const claudeCode = {
  client_name: "Claude Code (easyedit)", redirect_uris: [LOOPBACK], grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"], token_endpoint_auth_method: "none",
};
// A loopback address of exactly the given length.
const loopbackOfLength = (length: number) => {
  const start = "http://localhost:43117/";
  return start + "a".repeat(length - start.length);
};

describe("how much an agent may store when it registers", () => {
  it("refuses an oversized name, too many or too long redirect URIs, and an oversized body, and keeps nothing", async () => {
    const before = await clientCount();
    const cases: [string, unknown][] = [
      ["name", { ...claudeCode, client_name: "n".repeat(MAX_CLIENT_NAME_LENGTH + 1) }],
      ["uri count", { ...claudeCode, redirect_uris: Array.from({ length: MAX_REDIRECT_URIS + 1 }, (_, i) => `http://localhost:${40000 + i}/cb`) }],
      ["uri length", { ...claudeCode, redirect_uris: [loopbackOfLength(MAX_REDIRECT_URI_LENGTH + 1)] }],
      ["body", { ...claudeCode, padding: "p".repeat(16 * 1024) }],
      ["body in a field that is dropped", { ...claudeCode, logo_uri: `https://example.com/${"l".repeat(16 * 1024)}` }],
      // What the review sent: a 3 MB name and 2,000 loopback addresses of 1 KB each.
      ["review", { ...claudeCode, client_name: "n".repeat(3 * 1024 * 1024), redirect_uris: Array.from({ length: 2000 }, () => loopbackOfLength(1024)) }],
    ];
    for (const [what, body] of cases) {
      const res = await register(body);
      expect(res.status, what).toBe(400);
      expect(((await res.json()) as { error: string }).error, what).toBe("invalid_client_metadata");
    }
    expect(await clientCount()).toBe(before);
  });

  it("accepts a registration exactly at each limit", async () => {
    const res = await register({
      ...claudeCode,
      client_name: "n".repeat(MAX_CLIENT_NAME_LENGTH),
      redirect_uris: [loopbackOfLength(MAX_REDIRECT_URI_LENGTH), ...Array.from({ length: MAX_REDIRECT_URIS - 1 }, (_, i) => `http://localhost:${41000 + i}/cb`)],
    });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("drops the fields EasyEdit never uses, and registers the agent without them", async () => {
    const res = await register({
      ...claudeCode,
      client_uri: "https://code.visualstudio.com/", logo_uri: "https://example.com/logo.png",
      // Refused by the provider itself if it got this far: not on a trusted origin.
      jwks_uri: "https://example.com/jwks.json",
      post_logout_redirect_uris: ["http://localhost:43117/logged-out"],
      policy_uri: "https://example.com/privacy", tos_uri: "https://example.com/terms", contacts: ["ops@example.com"],
      software_id: "abc", software_version: "1.2.3", software_statement: "eyJ.x.y",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const registered = (await res.json()) as Record<string, unknown>;
    expect(registered.client_name).toBe("Claude Code (easyedit)");
    for (const field of ["client_uri", "logo_uri", "jwks_uri", "post_logout_redirect_uris", "policy_uri", "tos_uri", "contacts", "software_id", "software_version", "software_statement"]) {
      expect(registered[field], field).toBeUndefined();
    }

    const [row] = rowsOf<Record<string, unknown>>(await app.db.execute(sql`
      select name, redirect_uris, uri, icon, jwks, jwks_uri, post_logout_redirect_uris, policy, tos, contacts, software_id,
        software_version, software_statement
      from oauth_client where client_id = ${registered.client_id as string}`));
    expect(row).toEqual({
      name: "Claude Code (easyedit)", redirect_uris: [LOOPBACK], uri: null, icon: null, jwks: null, jwks_uri: null,
      post_logout_redirect_uris: null, policy: null, tos: null, contacts: null, software_id: null, software_version: null,
      software_statement: null,
    });
  });
});

describe("clearing out apps nobody uses", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

  async function addClient(clientId: string, createdAt: string | null) {
    await app.db.execute(sql`
      insert into oauth_client (id, client_id, redirect_uris, token_endpoint_auth_method, grant_types, response_types, created_at)
      values (${clientId}, ${clientId}, array[${LOOPBACK}], 'none', array['authorization_code'], array['code'], ${createdAt}::timestamp)`);
  }
  const present = async (ids: string[]) =>
    rowsOf<{ client_id: string }>(await app.db.execute(sql`select client_id from oauth_client where client_id like 'prune-%' order by client_id`))
      .map((r) => r.client_id).filter((id) => ids.includes(id));

  it("deletes old apps with no consent, token or pending code, and keeps the rest", async () => {
    await addClient("prune-old-unused", ago(8));
    await addClient("prune-undated-unused", null);
    await addClient("prune-old-consented", ago(30));
    await addClient("prune-old-token", ago(30));
    await addClient("prune-old-pending-code", ago(30));
    await addClient("prune-new-unused", ago(1));
    await app.db.execute(sql`
      insert into oauth_consent (id, client_id, scopes, created_at, updated_at)
      values ('prune-consent', 'prune-old-consented', array['offline_access'], now(), now())`);
    await app.db.execute(sql`
      insert into oauth_access_token (id, token, client_id, scopes, expires_at, created_at)
      values ('prune-token', 'prune-token', 'prune-old-token', array['offline_access'], now(), now())`);
    const code = JSON.stringify({ type: "authorization_code", query: { client_id: "prune-old-pending-code", response_type: "code" }, userId: "u", sessionId: "s" });
    await app.db.execute(sql`
      insert into verification (id, identifier, value, expires_at) values ('prune-code', 'prune-code', ${code}, now())`);
    // A verification row that is not a code, and not JSON, is no trouble.
    await app.db.execute(sql`insert into verification (id, identifier, value, expires_at) values ('prune-other', 'x', 'not json', now())`);

    const all = ["prune-old-unused", "prune-undated-unused", "prune-old-consented", "prune-old-token", "prune-old-pending-code", "prune-new-unused"];
    expect(await present(all)).toHaveLength(all.length);
    await pruneUnusedClients(app.db);
    expect(await present(all)).toEqual(["prune-new-unused", "prune-old-consented", "prune-old-pending-code", "prune-old-token"]);
  });

  it("happens when an agent registers", async () => {
    await addClient("prune-left-behind", ago(10));
    const res = await register(claudeCode);
    expect(res.status).toBe(201);
    expect(await present(["prune-left-behind"])).toEqual([]);
  });

  it("never stops a registration when it fails", async () => {
    const before = pruning.calls;
    pruning.fail = true;
    try {
      const errors = vi.spyOn(console, "error");
      const res = await register(claudeCode);
      expect(res.status, await res.clone().text()).toBe(201);
      expect(pruning.calls).toBe(before + 1);
      // Silently: nothing in the connector logs except the tool wrapper (tests/mcp/purity.test.ts).
      expect(errors).not.toHaveBeenCalledWith(expect.stringContaining("Pruning"), expect.anything());
      errors.mockRestore();
    } finally {
      pruning.fail = false;
    }
  });
});
