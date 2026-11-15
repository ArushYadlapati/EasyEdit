import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTokenAction, disconnectAgentAction, revokeTokenAction } from "@/app/(dashboard)/agents/actions";
import type { DB } from "@/db";
import { oauthClient, oauthConsent, user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { listAgentConnections } from "@/lib/connector/connections";
import { listAgentTokens, resolveAgentToken } from "@/lib/connector/tokens";
import { makeSuiteDb, makeTestDb } from "../helpers/db";

const { signedIn, revalidatePath } = vi.hoisted(() => ({
  signedIn: { user: null as CurrentUser | null },
  revalidatePath: vi.fn(),
}));
let testDb: DB;
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: () => testDb }));
vi.mock("@/lib/access", () => ({ requireUser: vi.fn(async () => signedIn.user!) }));
vi.mock("next/cache", () => ({ revalidatePath }));

const ada: CurrentUser = { id: "u-ada", email: "ada@gmail.com", name: "Ada", image: null, allowlistRole: "viewer" };
const vic: CurrentUser = { id: "u-vic", email: "vic@gmail.com", name: "Vic", image: null, allowlistRole: "editor" };

beforeAll(async () => {
  await (await makeSuiteDb()).close();
}, 120_000);

beforeEach(async () => {
  revalidatePath.mockClear();
  signedIn.user = ada;
  testDb = await makeTestDb();
  await testDb.insert(user).values([
    { id: ada.id, name: ada.name, email: ada.email },
    { id: vic.id, name: vic.name, email: vic.email },
  ]);
});

describe("the AI agents page's actions", () => {
  it("make a token for the signed-in member, even a viewer, and hand it back once", async () => {
    const result = await createTokenAction({ name: "  Responses bot ", agent: "openai-api" });
    expect(result.error).toBeUndefined();
    expect(result.token).toMatch(/^ee_at_/);
    expect(revalidatePath).toHaveBeenCalledWith("/agents");
    const [summary] = await listAgentTokens(testDb, ada.id);
    expect(summary).toMatchObject({ name: "Responses bot", agent: "openai-api", preview: result.token!.slice(-4) });
    expect(await resolveAgentToken(testDb, result.token!)).toMatchObject({ userId: ada.id, agent: "openai-api" });
  });

  it("refuse an unknown agent, an agent that only signs in, and a blank name, with a reason", async () => {
    expect(await createTokenAction({ name: "x", agent: "skynet" })).toEqual({ error: "Pick which AI agent the token is for." });
    expect(await createTokenAction({ name: "x", agent: "claude" })).toEqual({ error: "Claude connects by signing in, not with a token." });
    expect(await createTokenAction({ name: "   ", agent: "cursor" })).toEqual({
      error: "Give the token a name, so you can tell it apart later.",
    });
    expect(await listAgentTokens(testDb, ada.id)).toEqual([]);
  });

  it("make tokens that end after 90 days by default, or after the length the member picks", async () => {
    const day = 24 * 60 * 60 * 1000;
    await createTokenAction({ name: "Default", agent: "cursor" });
    await createTokenAction({ name: "Year", agent: "cursor", expiresInDays: 365 });
    await createTokenAction({ name: "Forever", agent: "cursor", expiresInDays: null });
    const byName = new Map((await listAgentTokens(testDb, ada.id)).map((t) => [t.name, t]));
    const daysLeft = (name: string) => Math.round((byName.get(name)!.expiresAt!.getTime() - Date.now()) / day);
    expect(daysLeft("Default")).toBe(90);
    expect(daysLeft("Year")).toBe(365);
    expect(byName.get("Forever")!.expiresAt).toBeNull();
    // Only the page's own choices.
    expect(await createTokenAction({ name: "Odd", agent: "cursor", expiresInDays: 7 })).toEqual({ error: "Choose how long the token lasts." });
    expect(byName.size).toBe(3);
  });

  it("revoke only the member's own token", async () => {
    signedIn.user = vic;
    const vics = await createTokenAction({ name: "Vic's", agent: "codex" });
    const [vicToken] = await listAgentTokens(testDb, vic.id);
    signedIn.user = ada;
    expect(await revokeTokenAction(vicToken.id)).toEqual({});
    expect(await listAgentTokens(testDb, vic.id)).toHaveLength(1);
    expect(await resolveAgentToken(testDb, vics.token!)).not.toBeNull();

    await createTokenAction({ name: "Mine", agent: "cursor" });
    const [mine] = await listAgentTokens(testDb, ada.id);
    expect(await revokeTokenAction(mine.id)).toEqual({});
    expect(await listAgentTokens(testDb, ada.id)).toEqual([]);
    expect(revalidatePath).toHaveBeenLastCalledWith("/agents");
  });

  it("disconnect one of the member's agents and leave the rest", async () => {
    await testDb.insert(oauthClient).values([
      { id: "c1", clientId: "claude-1", name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] },
      { id: "c2", clientId: "cursor-1", name: "Cursor", redirectUris: ["cursor://anysphere.cursor-mcp/oauth/callback"] },
    ]);
    const at = new Date("2026-11-01T12:00:00Z");
    const consent = (id: string, clientId: string, userId: string) => ({ id, clientId, userId, scopes: ["openid"], createdAt: at, updatedAt: at });
    await testDb.insert(oauthConsent).values([
      consent("k1", "claude-1", ada.id),
      consent("k2", "cursor-1", ada.id),
      consent("k3", "cursor-1", vic.id),
    ]);

    expect(await disconnectAgentAction("cursor-1")).toEqual({});
    expect(revalidatePath).toHaveBeenCalledWith("/agents");
    expect((await listAgentConnections(testDb, ada.id)).map((c) => c.agent)).toEqual(["claude"]);
    expect((await listAgentConnections(testDb, vic.id)).map((c) => c.agent)).toEqual(["cursor"]);
    expect(await disconnectAgentAction("")).toEqual({ error: "Pick an agent to disconnect." });
  });
});
