"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { AGENTS, isAgentKind } from "@/lib/connector/agents";
import { revokeClientGrant } from "@/lib/connector/grants";
import { createAgentToken, revokeAgentToken } from "@/lib/connector/tokens";
import { ServiceError } from "@/lib/service-error";
import { DEFAULT_TOKEN_LIFETIME, isTokenLifetime } from "./token-lifetimes";
import type { AgentResult, CreateTokenResult } from "./types";

// Each action acts for the signed-in member only, on their own connections and tokens, whatever their role: a
// viewer's agents can still be connected and disconnected, they just cannot change projects.

const PAGE = "/agents";

// Ends one agent's sign-in: its tokens and the member's consent for it. Already gone is fine.
export async function disconnectAgentAction(clientId: string): Promise<AgentResult> {
  const me = await requireUser();
  if (typeof clientId !== "string" || clientId === "") return { error: "Pick an agent to disconnect." };
  await revokeClientGrant(getDb(), me.id, clientId);
  revalidatePath(PAGE);
  return {};
}

// Makes an access token. The token is in the result only; it is never logged or put in an address. It lasts one of the
// page's choices, 90 days when none is sent.
export async function createTokenAction(input: { name: string; agent: string; expiresInDays?: number | null }): Promise<CreateTokenResult> {
  const me = await requireUser();
  const agent: unknown = input?.agent;
  if (!isAgentKind(agent)) return { error: "Pick which AI agent the token is for." };
  if (!AGENTS[agent].methods.includes("token")) {
    return { error: `${AGENTS[agent].name} connects by signing in, not with a token.` };
  }
  const lifetime: unknown = input.expiresInDays === undefined ? DEFAULT_TOKEN_LIFETIME : input.expiresInDays;
  if (!isTokenLifetime(lifetime)) return { error: "Choose how long the token lasts." };
  try {
    const { token } = await createAgentToken(getDb(), {
      userId: me.id,
      name: typeof input.name === "string" ? input.name : "",
      agent,
      expiresInDays: lifetime,
    });
    revalidatePath(PAGE);
    return { token };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

// Deletes one of the member's own tokens. One already revoked (in another tab, say) is gone either way.
export async function revokeTokenAction(id: string): Promise<AgentResult> {
  const me = await requireUser();
  if (typeof id !== "string" || id === "") return { error: "Pick a token to revoke." };
  await revokeAgentToken(getDb(), me.id, id);
  revalidatePath(PAGE);
  return {};
}
