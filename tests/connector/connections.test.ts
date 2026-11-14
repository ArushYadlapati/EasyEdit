import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { oauthClient, oauthConsent, user } from "@/db/schema";
import { listAgentConnections } from "@/lib/connector/connections";
import { makeSuiteDb, makeTestDb } from "../helpers/db";

const CLAUDE_DOC = "https://claude.ai/oauth/claude-client.json";
const CURSOR_ID = "cursor-client-1";

async function seed(db: DB) {
  await db.insert(user).values([
    { id: "u-ada", name: "Ada", email: "ada@gmail.com" },
    { id: "u-vic", name: "Vic", email: "vic@gmail.com" },
  ]);
  await db.insert(oauthClient).values([
    { id: "c1", clientId: CLAUDE_DOC, name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] },
    { id: "c2", clientId: CURSOR_ID, name: "Cursor Desktop", redirectUris: ["cursor://anysphere.cursor-mcp/oauth/callback"] },
    { id: "c3", clientId: "mystery", name: "  ", redirectUris: ["http://127.0.0.1:4567/callback"] },
  ]);
}

const consent = (id: string, clientId: string, userId: string, at: string) => ({
  id, clientId, userId, scopes: ["openid"], createdAt: new Date(at), updatedAt: new Date(at),
});

// Migrates the template once, with time to spare on a busy machine; each test then clones it.
beforeAll(async () => {
  await (await makeSuiteDb()).close();
}, 120_000);

describe("listAgentConnections", () => {
  it("lists one row per client the member allowed, newest first, with the agent guessed", async () => {
    const db = await makeTestDb();
    await seed(db);
    await db.insert(oauthConsent).values([
      consent("k1", CLAUDE_DOC, "u-ada", "2026-11-01T10:00:00Z"),
      consent("k2", CURSOR_ID, "u-ada", "2026-11-05T10:00:00Z"),
      consent("k3", "mystery", "u-vic", "2026-11-06T10:00:00Z"),
    ]);

    expect(await listAgentConnections(db, "u-ada")).toEqual([
      { clientId: CURSOR_ID, clientName: "Cursor Desktop", agent: "cursor", connectedAt: new Date("2026-11-05T10:00:00Z") },
      { clientId: CLAUDE_DOC, clientName: "Claude", agent: "claude", connectedAt: new Date("2026-11-01T10:00:00Z") },
    ]);
  });

  it("leaves out another member's consent, and a blank client name is no name", async () => {
    const db = await makeTestDb();
    await seed(db);
    await db.insert(oauthConsent).values([consent("k3", "mystery", "u-vic", "2026-11-06T10:00:00Z")]);

    expect(await listAgentConnections(db, "u-ada")).toEqual([]);
    expect(await listAgentConnections(db, "u-vic")).toEqual([
      { clientId: "mystery", clientName: null, agent: "other", connectedAt: new Date("2026-11-06T10:00:00Z") },
    ]);
  });

  it("shows a client once even when it holds two consents", async () => {
    const db = await makeTestDb();
    await seed(db);
    await db.insert(oauthConsent).values([
      consent("k1", CLAUDE_DOC, "u-ada", "2026-11-01T10:00:00Z"),
      consent("k4", CLAUDE_DOC, "u-ada", "2026-11-08T10:00:00Z"),
    ]);

    const rows = await listAgentConnections(db, "u-ada");
    expect(rows).toHaveLength(1);
    expect(rows[0].connectedAt).toEqual(new Date("2026-11-08T10:00:00Z"));
  });
});
