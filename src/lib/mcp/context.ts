import { getDb } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { agentActorFor } from "@/lib/actor";
import type { AgentKind } from "@/lib/connector/agents";
import { appBaseUrl } from "@/lib/connector/config";
import { LIMITS } from "@/lib/limits";
import type { ToolContext } from "./types";

// Everything a tool needs to act for the member whose AI agent is calling. The op log names that agent.
export function toolContextFor(user: CurrentUser, agent: AgentKind = "claude"): ToolContext {
  return { db: getDb(), user, actor: agentActorFor(user, agent), baseUrl: appBaseUrl(), limits: LIMITS, now: () => new Date() };
}
