import type { AgentConnection } from "@/lib/connector/connections";
import type { AgentTokenSummary } from "@/lib/connector/tokens";

export type { AgentConnection, AgentTokenSummary };

// What an action on the AI agents page sends back: nothing when it went through, or why it was refused.
export type AgentResult = { error?: string };

// A made token comes back once, here, and is never stored or shown again.
export type CreateTokenResult = { token: string; error?: undefined } | { token?: undefined; error: string };

export type AgentActions = {
  disconnect(clientId: string): Promise<AgentResult>;
  createToken(input: { name: string; agent: string; expiresInDays: number | null }): Promise<CreateTokenResult>;
  revokeToken(id: string): Promise<AgentResult>;
};
