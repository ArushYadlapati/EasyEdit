import { getDb } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { agentActorFor } from "@/lib/actor";
import type { AgentKind } from "@/lib/connector/agents";
import { appBaseUrl } from "@/lib/connector/config";
import { LIMITS } from "@/lib/limits";
import { roleIn } from "@/lib/spaces/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import type { ToolContext } from "./types";

// Everything a tool needs to act for the member whose AI agent is calling. The op log names that agent. Null when
// the member is not in the space.
export async function toolContextFor(user: CurrentUser, agent: AgentKind = "claude"): Promise<ToolContext | null> {
  const db = getDb();
  // stage-1: space comes from Task 7
  const role = await roleIn(db, user.id, SEED_TEAM_ID);
  if (role === null) return null;
  const actor = agentActorFor(user, agent, { spaceId: SEED_TEAM_ID, role });
  return { db, user, actor, baseUrl: appBaseUrl(), limits: LIMITS, now: () => new Date() };
}
