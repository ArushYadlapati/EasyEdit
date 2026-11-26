import type { AgentKind } from "@/lib/connector/agents";
import { parseAgentActor } from "@/lib/projects/display-actor";
import type { Peer } from "@/lib/editor/presence";
import { peerLook } from "./peer-look";

// The colour that says who made a change: Selection Blue for you, a teammate's own colour while they are here, an AI
// agent's own colour always. Written out in full, because Tailwind only generates classes it finds spelled out.
export type ActorLook = { bg: string; text: string };

const CLAUDE: ActorLook = { bg: "bg-ed-agent-claude", text: "text-ed-agent-claude" };

// The agents with a colour of their own. Claude Code is Claude. The others (VS Code, Gemini CLI, the OpenAI API, any
// other MCP client) have none yet, so they read in the panel's own text colour rather than borrow one.
const AGENT_LOOKS: Partial<Record<AgentKind, ActorLook>> = {
  claude: CLAUDE,
  "claude-code": CLAUDE,
  chatgpt: { bg: "bg-ed-agent-chatgpt", text: "text-ed-agent-chatgpt" },
  codex: { bg: "bg-ed-agent-codex", text: "text-ed-agent-codex" },
  cursor: { bg: "bg-ed-agent-cursor", text: "text-ed-agent-cursor" },
};

const YOU: ActorLook = { bg: "bg-ed-accent", text: "text-ed-accent" };

// An agent's look from its actor id ("claude:<user>", "agent:<kind>:<user>"), or null for a person or an agent with
// no colour.
export function agentLook(actor: string): ActorLook | null {
  const agent = parseAgentActor(actor);
  return agent?.kind ? (AGENT_LOOKS[agent.kind] ?? null) : null;
}

// Whoever made a change: an agent by its colour, you in blue, a teammate in their colour while they have the project
// open. null: a teammate who is not here now, whose colour is not theirs to keep.
export function actorLook(actor: string, meId: string, peers: readonly Peer[]): ActorLook | null {
  const agent = agentLook(actor);
  if (agent || parseAgentActor(actor)) return agent;
  if (actor === meId) return YOU;
  const peer = peers.find((p) => p.userId === actor);
  if (!peer) return null;
  const look = peerLook(peer.colour);
  return { bg: look.bg, text: look.text };
}
