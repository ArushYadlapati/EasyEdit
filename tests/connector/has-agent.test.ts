import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { agentToken, oauthClient, oauthConsent, user } from "@/db/schema";
import { hasConnectedAgent } from "@/lib/connector/has-agent";
import { makeSuiteDb, makeTestDb } from "../helpers/db";

async function seed(db: DB) {
  await db.insert(user).values([
    { id: "u-ada", name: "Ada", email: "ada@gmail.com" },
    { id: "u-vic", name: "Vic", email: "vic@gmail.com" },
  ]);
  await db.insert(oauthClient).values([{ id: "c1", clientId: "claude-doc", name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] }]);
}

const token = (id: string, userId: string, lastUsedAt: Date | null) => ({
  id, userId, name: id, agent: "codex" as const, tokenHash: `hash-${id}`, preview: "ab12", lastUsedAt,
});

beforeAll(async () => {
  await (await makeSuiteDb()).close();
}, 120_000);

describe("hasConnectedAgent", () => {
  it("is false with nothing connected, and for a token nothing has used", async () => {
    const db = await makeTestDb();
    await seed(db);
    expect(await hasConnectedAgent(db, "u-ada")).toBe(false);
    await db.insert(agentToken).values([token("t1", "u-ada", null)]);
    expect(await hasConnectedAgent(db, "u-ada")).toBe(false);
  });

  it("is true once the person signed in to an agent, and only for them", async () => {
    const db = await makeTestDb();
    await seed(db);
    const at = new Date("2026-11-01T10:00:00Z");
    await db.insert(oauthConsent).values([{ id: "k1", clientId: "claude-doc", userId: "u-ada", scopes: ["openid"], createdAt: at, updatedAt: at }]);
    expect(await hasConnectedAgent(db, "u-ada")).toBe(true);
    expect(await hasConnectedAgent(db, "u-vic")).toBe(false);
  });

  it("is true once one of their tokens has been used", async () => {
    const db = await makeTestDb();
    await seed(db);
    await db.insert(agentToken).values([token("t2", "u-vic", new Date("2026-11-10T10:00:00Z"))]);
    expect(await hasConnectedAgent(db, "u-vic")).toBe(true);
    expect(await hasConnectedAgent(db, "u-ada")).toBe(false);
  });
});
