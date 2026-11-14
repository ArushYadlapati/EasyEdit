import { AGENT_KINDS, agentName, isAgentKind, type AgentKind } from "@/lib/connector/agents";

const CLAUDE_PREFIX = "claude:";
const AGENT_PREFIX = "agent:";

// What the change list calls an agent whose kind is unknown, or one that is none of the agents EasyEdit knows.
export const UNKNOWN_AGENT_LABEL = "AI agent";

// An actor is a user id, `claude:<userId>` when Claude made the change for that user, or `agent:<kind>:<userId>` when
// another AI agent did. Claude keeps its own form: older op logs and projects already hold it.
export function claudeActorId(userId: string): string {
  return `${CLAUDE_PREFIX}${userId}`;
}

export function agentActorId(kind: AgentKind, userId: string): string {
  return kind === "claude" ? claudeActorId(userId) : `${AGENT_PREFIX}${kind}:${userId}`;
}

// The agent and member behind an agent's actor id, or null for a person. A kind this version does not know is null.
export function parseAgentActor(actor: string): { kind: AgentKind | null; userId: string } | null {
  if (actor.startsWith(CLAUDE_PREFIX)) return { kind: "claude", userId: actor.slice(CLAUDE_PREFIX.length) };
  if (!actor.startsWith(AGENT_PREFIX)) return null;
  const rest = actor.slice(AGENT_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon < 0) return { kind: null, userId: rest };
  const kind = rest.slice(0, colon);
  return { kind: isAgentKind(kind) ? kind : null, userId: rest.slice(colon + 1) };
}

// Every actor id an agent of this member can write under: one per agent kind EasyEdit knows.
export function agentActorIdsOf(userId: string): string[] {
  return AGENT_KINDS.map((kind) => agentActorId(kind, userId));
}

export function isAgentActor(actor: string): boolean {
  return parseAgentActor(actor) !== null;
}

// The agent's name in the change list. "Another agent" is a choice on the AI agents page, not a name.
export function agentLabel(kind: AgentKind | null): string {
  return kind === null || kind === "other" ? UNKNOWN_AGENT_LABEL : agentName(kind);
}

export function actorUserId(actor: string): string {
  return parseAgentActor(actor)?.userId ?? actor;
}

export function displayActor(actor: string, names: Map<string, string>): string {
  const agent = parseAgentActor(actor);
  const name = names.get(agent?.userId ?? actor);
  if (agent === null) return name ?? "Someone";
  const label = agentLabel(agent.kind);
  return name === undefined ? label : `${label} (for ${name})`;
}
