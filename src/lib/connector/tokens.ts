import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq, isNull, lte, or } from "drizzle-orm";
import type { DB } from "@/db";
import { agentToken } from "@/db/schema";
import { isAgentKind, type AgentKind } from "@/lib/connector/agents";
import { ServiceError } from "@/lib/service-error";

// Personal access tokens, for AI agents that cannot sign in through a browser and send a header instead
// (the OpenAI Responses API, the Agents SDK, scripts). A token is shown once, when it is made: only its sha256 is kept,
// so a leaked database cannot be used to call the connector. Nothing here logs a token.

export const TOKEN_PREFIX = "ee_at_";
export const MAX_TOKENS_PER_MEMBER = 20;
export const MAX_TOKEN_NAME = 60;
// Ten years: past that a member wants "no end date".
const MAX_EXPIRY_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;
// A busy agent calls many times a minute; the last-used time only needs to be right to the minute.
const LAST_USED_STEP_MS = 60 * 1000;

export type AgentTokenSummary = {
  id: string;
  name: string;
  agent: AgentKind;
  preview: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
};

const summaryFields = {
  id: agentToken.id,
  name: agentToken.name,
  agent: agentToken.agent,
  preview: agentToken.preview,
  createdAt: agentToken.createdAt,
  lastUsedAt: agentToken.lastUsedAt,
  expiresAt: agentToken.expiresAt,
};

// The exact shape createAgentToken makes: the prefix, then 32 random bytes in unpadded base64url.
const TOKEN_SHAPE = new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

// Whether a bearer value is one of these tokens rather than an OAuth access token (a JWT, which never starts this way).
// Anything else never reaches the database.
export function isAgentToken(bearer: string): boolean {
  return TOKEN_SHAPE.test(bearer);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseName(name: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") throw new ServiceError("INVALID", 400, "Give the token a name, so you can tell it apart later.");
  if (trimmed.length > MAX_TOKEN_NAME) {
    throw new ServiceError("INVALID", 400, `Keep the token's name to ${MAX_TOKEN_NAME} characters or fewer.`);
  }
  return trimmed;
}

function expiryFrom(days: number | null | undefined, now: number): Date | null {
  if (days === null || days === undefined) return null;
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
    throw new ServiceError("INVALID", 400, `Choose how long the token lasts: from 1 to ${MAX_EXPIRY_DAYS} days, or no end date.`);
  }
  return new Date(now + days * DAY_MS);
}

// Makes a token for one of the member's agents. The token itself is in the result and nowhere else: show it once.
// Expired tokens count toward the limit until the member revokes them, so the list stays short.
export async function createAgentToken(
  db: DB,
  input: { userId: string; name: string; agent: AgentKind; expiresInDays?: number | null },
): Promise<{ token: string; summary: AgentTokenSummary }> {
  const name = parseName(input.name);
  if (!isAgentKind(input.agent)) throw new ServiceError("INVALID", 400, "Pick which AI agent the token is for.");
  const expiresAt = expiryFrom(input.expiresInDays, Date.now());

  // Two requests at the same moment could both pass this check; one token over the limit does no harm.
  const [{ held }] = await db.select({ held: count() }).from(agentToken).where(eq(agentToken.userId, input.userId));
  if (held >= MAX_TOKENS_PER_MEMBER) {
    throw new ServiceError(
      "CONFLICT",
      409,
      `You already have ${MAX_TOKENS_PER_MEMBER} access tokens. Revoke one you no longer use, then make a new one.`,
    );
  }

  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const [summary] = await db
    .insert(agentToken)
    .values({
      id: randomUUID(),
      userId: input.userId,
      name,
      agent: input.agent,
      tokenHash: hashToken(token),
      preview: token.slice(-4),
      expiresAt,
    })
    .returning(summaryFields);
  return { token, summary };
}

// The member's tokens, newest first. Never the tokens themselves: they are not kept.
export async function listAgentTokens(db: DB, userId: string): Promise<AgentTokenSummary[]> {
  return db
    .select(summaryFields)
    .from(agentToken)
    .where(eq(agentToken.userId, userId))
    .orderBy(desc(agentToken.createdAt), desc(agentToken.id));
}

// Deletes one of the member's own tokens. False when there is no such token, or it belongs to someone else.
export async function revokeAgentToken(db: DB, userId: string, id: string): Promise<boolean> {
  const gone = await db
    .delete(agentToken)
    .where(and(eq(agentToken.id, id), eq(agentToken.userId, userId)))
    .returning({ id: agentToken.id });
  return gone.length > 0;
}

// Who a token belongs to and which agent it was made for, or null when it is unknown or expired. It says nothing about
// whether the member may still use EasyEdit: the caller checks the allowlist, as for an OAuth token.
export async function resolveAgentToken(
  db: DB,
  token: string,
): Promise<{ userId: string; agent: AgentKind; tokenId: string } | null> {
  if (!isAgentToken(token)) return null;
  const [row] = await db
    .select({ id: agentToken.id, userId: agentToken.userId, agent: agentToken.agent, lastUsedAt: agentToken.lastUsedAt, expiresAt: agentToken.expiresAt })
    .from(agentToken)
    .where(eq(agentToken.tokenHash, hashToken(token)));
  if (row === undefined) return null;
  const now = new Date();
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return null;

  if (row.lastUsedAt === null || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_STEP_MS) {
    const due = new Date(now.getTime() - LAST_USED_STEP_MS);
    // The condition is repeated in the statement, so calls arriving together write once.
    await db
      .update(agentToken)
      .set({ lastUsedAt: now })
      .where(and(eq(agentToken.id, row.id), or(isNull(agentToken.lastUsedAt), lte(agentToken.lastUsedAt, due))));
  }
  return { userId: row.userId, agent: row.agent, tokenId: row.id };
}
