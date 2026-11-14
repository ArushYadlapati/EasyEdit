import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rowsOf, type DB } from "@/db";
import { agentToken, user } from "@/db/schema";
import { AGENT_KINDS, type AgentKind } from "@/lib/connector/agents";
import {
  MAX_TOKEN_NAME,
  MAX_TOKENS_PER_MEMBER,
  TOKEN_PREFIX,
  createAgentToken,
  isAgentToken,
  listAgentTokens,
  resolveAgentToken,
  revokeAgentToken,
} from "@/lib/connector/tokens";
import { makeTestDb } from "../helpers/db";

afterEach(() => vi.useRealTimers());

async function member(db: DB, id: string) {
  await db.insert(user).values({ id, name: id, email: `${id}@gmail.com`, emailVerified: true });
  return id;
}

const make = (db: DB, userId: string, over: { name?: string; agent?: AgentKind; expiresInDays?: number | null } = {}) =>
  createAgentToken(db, { userId, name: over.name ?? "Agents SDK", agent: over.agent ?? "openai-api", expiresInDays: over.expiresInDays });

const setClock = (at: number) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
};

describe("making a token", () => {
  it("returns the token once and keeps only its hash", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const { token, summary } = await make(db, ada, { name: "  Nightly script  " });

    expect(token).toMatch(/^ee_at_[A-Za-z0-9_-]{43}$/);
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(isAgentToken(token)).toBe(true);
    expect(summary).toEqual({
      id: expect.any(String), name: "Nightly script", agent: "openai-api", preview: token.slice(-4),
      createdAt: expect.any(Date), lastUsedAt: null, expiresAt: null,
    });

    const [row] = await db.select().from(agentToken).where(eq(agentToken.id, summary.id));
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    // The token is in no column, whole or without its prefix.
    const stored = JSON.stringify(rowsOf(await db.execute(sql`select * from agent_token`)));
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(token.slice(TOKEN_PREFIX.length));
  });

  it("makes a different token every time", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const tokens = new Set<string>();
    for (let i = 0; i < 5; i++) tokens.add((await make(db, ada)).token);
    expect(tokens.size).toBe(5);
  });

  it("sets an end date when asked", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const before = Date.now();
    const { summary } = await make(db, ada, { expiresInDays: 30 });
    const day = 24 * 60 * 60 * 1000;
    expect(summary.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 30 * day);
    expect(summary.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 30 * day);
    expect((await make(db, ada, { expiresInDays: null })).summary.expiresAt).toBeNull();
  });

  it("refuses an empty or too long name, an unknown agent and a bad end date, saying why", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    for (const name of ["", "   "]) {
      await expect(make(db, ada, { name })).rejects.toMatchObject({ name: "ServiceError", code: "INVALID", status: 400, message: "Give the token a name, so you can tell it apart later." });
    }
    await expect(make(db, ada, { name: "x".repeat(MAX_TOKEN_NAME + 1) })).rejects.toMatchObject({ code: "INVALID", message: "Keep the token's name to 60 characters or fewer." });
    expect((await make(db, ada, { name: "x".repeat(MAX_TOKEN_NAME) })).summary.name).toHaveLength(MAX_TOKEN_NAME);
    await expect(make(db, ada, { agent: "gpt-9" as AgentKind })).rejects.toMatchObject({ code: "INVALID", message: "Pick which AI agent the token is for." });
    for (const days of [0, -1, 1.5, Number.NaN, 3651]) {
      await expect(make(db, ada, { expiresInDays: days }), String(days)).rejects.toMatchObject({ code: "INVALID", status: 400 });
    }
    expect(await listAgentTokens(db, ada)).toHaveLength(1);
  });

  it("accepts every kind of agent", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    for (const agent of AGENT_KINDS) expect((await make(db, ada, { agent })).summary.agent).toBe(agent);
  });

  it(`allows ${MAX_TOKENS_PER_MEMBER} tokens per member`, async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const grace = await member(db, "grace");
    const made = [];
    for (let i = 0; i < MAX_TOKENS_PER_MEMBER; i++) made.push((await make(db, ada, { name: `Token ${i}` })).summary);

    await expect(make(db, ada)).rejects.toMatchObject({
      code: "CONFLICT", status: 409, message: "You already have 20 access tokens. Revoke one you no longer use, then make a new one.",
    });
    expect(await listAgentTokens(db, ada)).toHaveLength(MAX_TOKENS_PER_MEMBER);
    // The limit is each member's own.
    await expect(make(db, grace)).resolves.toBeTruthy();
    // Revoking one makes room again.
    expect(await revokeAgentToken(db, ada, made[0].id)).toBe(true);
    await expect(make(db, ada)).resolves.toBeTruthy();
  });
});

describe("listing and revoking", () => {
  it("lists only the member's own tokens, newest first", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const grace = await member(db, "grace");
    const first = (await make(db, ada, { name: "First" })).summary;
    const second = (await make(db, ada, { name: "Second", agent: "cursor" })).summary;
    await make(db, grace, { name: "Grace's" });
    await db.update(agentToken).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(agentToken.id, first.id));

    const listed = await listAgentTokens(db, ada);
    expect(listed.map((t) => t.name)).toEqual(["Second", "First"]);
    expect(listed[0]).toEqual(second);
    expect(Object.keys(listed[0]).sort()).toEqual(["agent", "createdAt", "expiresAt", "id", "lastUsedAt", "name", "preview"]);
    expect(await listAgentTokens(db, "nobody")).toEqual([]);
  });

  it("revokes only the owner's token", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const grace = await member(db, "grace");
    const { token, summary } = await make(db, ada);

    expect(await revokeAgentToken(db, grace, summary.id)).toBe(false);
    expect(await listAgentTokens(db, ada)).toHaveLength(1);
    expect(await resolveAgentToken(db, token)).not.toBeNull();

    expect(await revokeAgentToken(db, ada, summary.id)).toBe(true);
    expect(await revokeAgentToken(db, ada, summary.id)).toBe(false);
    expect(await listAgentTokens(db, ada)).toEqual([]);
    expect(await resolveAgentToken(db, token)).toBeNull();
  });

  it("a deleted account takes its tokens with it", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    await make(db, ada);
    await db.delete(user).where(eq(user.id, ada));
    expect(rowsOf(await db.execute(sql`select 1 from agent_token`))).toHaveLength(0);
  });
});

describe("resolving a token", () => {
  it("names the member, the agent and the token", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const { token, summary } = await make(db, ada, { agent: "gemini-cli" });
    expect(await resolveAgentToken(db, token)).toEqual({ userId: ada, agent: "gemini-cli", tokenId: summary.id });
  });

  it("returns null for an unknown token, a changed one, or something that is not a token", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const { token } = await make(db, ada);
    const changed = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    for (const bearer of [`${TOKEN_PREFIX}${"a".repeat(43)}`, changed, token.slice(TOKEN_PREFIX.length), "", "eyJhbGciOi.x.y"]) {
      expect(await resolveAgentToken(db, bearer), bearer).toBeNull();
    }
    expect(isAgentToken("eyJhbGciOi.x.y")).toBe(false);
  });

  it("never asks the database about a value that is not shaped like a token", async () => {
    const db = { select: vi.fn(), update: vi.fn() } as unknown as DB;
    const body = "a".repeat(43);
    for (const bearer of [
      `${TOKEN_PREFIX}x`, `${TOKEN_PREFIX}${body.slice(1)}`, `${TOKEN_PREFIX}${body}a`, `${TOKEN_PREFIX}${body.slice(1)}=`,
      `${TOKEN_PREFIX}${body.slice(1)}+`, `${TOKEN_PREFIX}${body.slice(1)}/`, ` ${TOKEN_PREFIX}${body}`, `${TOKEN_PREFIX}${body}\n`,
      `EE_AT_${body}`, TOKEN_PREFIX,
    ]) {
      expect(isAgentToken(bearer), JSON.stringify(bearer)).toBe(false);
      expect(await resolveAgentToken(db, bearer), JSON.stringify(bearer)).toBeNull();
    }
    expect(db.select).not.toHaveBeenCalled();
    expect(isAgentToken(`${TOKEN_PREFIX}${body}`)).toBe(true);
    expect(isAgentToken(`${TOKEN_PREFIX}${"-_09AZaz".repeat(5)}abc`)).toBe(true);
  });

  it("returns null once the token has expired", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const start = Date.now();
    const { token, summary } = await make(db, ada, { expiresInDays: 1 });
    expect(await resolveAgentToken(db, token)).not.toBeNull();

    setClock(summary.expiresAt!.getTime() - 1000);
    expect(await resolveAgentToken(db, token)).not.toBeNull();
    setClock(summary.expiresAt!.getTime());
    expect(await resolveAgentToken(db, token)).toBeNull();
    setClock(start + 2 * 24 * 60 * 60 * 1000);
    expect(await resolveAgentToken(db, token)).toBeNull();
    // Still listed, so the member can see it ended and revoke it.
    expect(await listAgentTokens(db, ada)).toHaveLength(1);
  });

  it("records when the token was last used, at most once a minute", async () => {
    const db = await makeTestDb();
    const ada = await member(db, "ada");
    const { token, summary } = await make(db, ada);
    const lastUsed = async () => (await db.select({ at: agentToken.lastUsedAt }).from(agentToken).where(eq(agentToken.id, summary.id)))[0].at;
    const start = Math.floor(Date.now() / 1000) * 1000;

    setClock(start);
    await resolveAgentToken(db, token);
    expect((await lastUsed())?.getTime()).toBe(start);

    setClock(start + 59_000);
    await resolveAgentToken(db, token);
    expect((await lastUsed())?.getTime()).toBe(start);

    setClock(start + 60_000);
    await resolveAgentToken(db, token);
    expect((await lastUsed())?.getTime()).toBe(start + 60_000);
    expect((await listAgentTokens(db, ada))[0].lastUsedAt?.getTime()).toBe(start + 60_000);
  });
});
