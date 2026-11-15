import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { agentToken } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { makeAdminActions } from "@/lib/allowlist/admin-actions";
import { createAgentToken, revokeAgentToken, TOKEN_PREFIX } from "@/lib/connector/tokens";
import { agentActorId, claudeActorId } from "@/lib/projects/display-actor";
import { createProject } from "@/lib/projects/service";
import { testActor } from "../helpers/actor";
import { BASE_URL, MCP_URL, startConnectorApp, type ConnectorApp } from "../helpers/connector";

// The admin page's own actions, acting as an admin: the allowlist write and the team membership change together.
function adminActions(db: DB) {
  const admin: CurrentUser = { id: "admin", email: "admin@seattlesolvers.com", name: "Admin", image: null, allowlistRole: "admin" };
  return makeAdminActions({ db: () => db, requireUser: async () => admin, revalidate: () => {} });
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));

let app: ConnectorApp;
beforeAll(async () => {
  app = await startConnectorApp();
  testDb = app.db;
});
afterAll(() => app.stop());

const LIST = { name: "list_projects", arguments: {} };
const INVALID = 'Bearer error="invalid_token"';

// A member signed in to the website who makes an access token for an agent on the AI agents page.
async function memberWithToken(email: string, opts: { role?: "viewer" | "editor" | "admin"; expiresInDays?: number } = {}) {
  const { userId } = await app.signIn(email, opts.role ?? "editor");
  const { token, summary } = await createAgentToken(app.db, { userId, name: "Responses API", agent: "openai-api", expiresInDays: opts.expiresInDays });
  return { userId, token, tokenId: summary.id };
}

describe("POST /api/mcp with an access token", () => {
  it("initializes and lists tools, and calls one as the member", async () => {
    const m = await memberWithToken("ada@gmail.com");
    const client = await app.mcpClient(m.token);
    try {
      expect(client.getServerVersion()?.name).toBe("easyedit");
      expect((await client.listTools()).tools.map((t) => t.name)).toContain("list_projects");
    } finally {
      await client.close();
    }
    const r = await app.callTool(m.token, "list_projects");
    expect(r.isError).toBe(false);
    expect(r.text.split("\n")[0]).toBe("Signed in as Ada (editor). You can read and change projects.");
  });

  it("records the change as the token's agent acting for the member", async () => {
    const m = await memberWithToken("grace@gmail.com");
    const project = await createProject(app.db, testActor({ userId: m.userId, email: "grace@gmail.com", role: "editor" }), { name: "Recap", format: "short_9x16" });
    const r = await app.callTool(m.token, "add_text", { project_id: project.id, expected_version: 0, items: [{ text: "GO SOLVERS" }] });
    expect(r.isError, r.text).toBe(false);

    const log = rowsOf<{ actor: string }>(await app.db.execute(sql`select actor from project_ops where project_id = ${project.id}`));
    expect(log).toEqual([{ actor: agentActorId("openai-api", m.userId) }]);
    expect(log[0].actor).not.toBe(claudeActorId(m.userId));
    expect(log[0].actor).not.toBe(m.userId);
  });

  it("notes when the token was used", async () => {
    const m = await memberWithToken("annie@gmail.com");
    expect((await app.rpc(m.token, "tools/list")).status).toBe(200);
    const [row] = await app.db.select({ at: agentToken.lastUsedAt }).from(agentToken).where(eq(agentToken.id, m.tokenId));
    expect(row.at).toBeInstanceOf(Date);
  });

  it("takes the role the member has now", async () => {
    const m = await memberWithToken("dorothy@gmail.com");
    await adminActions(app.db).setRole(form({ email: "dorothy@gmail.com", role: "viewer" }));
    expect((await app.callTool(m.token, "list_projects")).text).toContain("(viewer). You can read projects but not change them.");
  });

  it("answers an unknown, revoked or expired token with 401 and an invalid_token challenge", async () => {
    const revoked = await memberWithToken("linus@gmail.com");
    expect(await revokeAgentToken(app.db, revoked.userId, revoked.tokenId)).toBe(true);
    const expired = await memberWithToken("joan@gmail.com", { expiresInDays: 1 });
    await app.db.update(agentToken).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(agentToken.id, expired.tokenId));

    for (const [what, token] of [
      ["unknown", `${TOKEN_PREFIX}${"x".repeat(43)}`],
      ["revoked", revoked.token],
      ["expired", expired.token],
    ] as const) {
      const res = await app.rpc(token, "tools/call", LIST);
      expect(res.status, what).toBe(401);
      expect(res.headers.get("www-authenticate"), what).toContain(INVALID);
      expect(res.headers.get("www-authenticate"), what).toContain(`resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/api/mcp"`);
      expect(await res.json(), what).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32001 } });
    }
  });

  it("answers a bearer that only starts like an access token with 401, without looking it up", async () => {
    const select = vi.spyOn(app.db, "select");
    try {
      for (const token of [`${TOKEN_PREFIX}x`, `${TOKEN_PREFIX}${"x".repeat(44)}`, `${TOKEN_PREFIX}${"x".repeat(42)}=`]) {
        const res = await app.rpc(token, "tools/call", LIST);
        expect(res.status, token).toBe(401);
        expect(res.headers.get("www-authenticate"), token).toContain("Bearer");
      }
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
  });

  it("refuses a member who is off the allowlist with 403 and no sign-in challenge", async () => {
    const m = await memberWithToken("katherine@gmail.com");
    // As if the token outlived the member's place on the allowlist.
    await app.db.execute(sql`delete from allowlist where email = 'katherine@gmail.com'`);
    const res = await app.rpc(m.token, "tools/call", LIST);
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(await res.json()).toMatchObject({ error: { message: "This Google account isn't on the Seattle Solvers allowlist. Ask an admin to add you." } });
  });

  it("stops working when an admin removes the member", async () => {
    const m = await memberWithToken("hedy@gmail.com");
    expect((await app.rpc(m.token, "tools/list")).status).toBe(200);
    await adminActions(app.db).removeMember(form({ email: "hedy@gmail.com" }));
    // Removal deletes the token, so it is unknown now.
    expect((await app.rpc(m.token, "tools/list")).status).toBe(401);
  });

  it("accepts the scheme in any case, and never the session cookie in place of a token", async () => {
    const m = await memberWithToken("barbara@gmail.com");
    const raw = (authorization: string) => app.send(new Request(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }));
    expect((await raw(`bearer ${m.token}`)).status).toBe(200);
    expect((await raw(`Basic ${m.token}`)).status).toBe(401);
    const { cookie } = await app.signIn("barbara@gmail.com");
    expect((await app.rpc(null, "tools/list", {}, { cookie })).status).toBe(401);
  });

  it("leaves OAuth tokens working as before", async () => {
    const c = await app.connect("frances@gmail.com");
    expect((await app.rpc(c.accessToken, "tools/list")).status).toBe(200);
    expect((await app.callTool(c.accessToken, "list_projects")).isError).toBe(false);
  });
});
