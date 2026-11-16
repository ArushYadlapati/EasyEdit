import { getDb } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { AgentKind } from "@/lib/connector/agents";
import { appBaseUrl } from "@/lib/connector/config";
import { LIMITS } from "@/lib/limits";
import { listMySpaces } from "@/lib/spaces/service";
import type { ToolContext } from "./types";

export { actorForProject, actorInSpace } from "./actors";

// Everything a tool needs to act for the person whose AI agent is calling: all their spaces, loaded now. The caller
// is a CurrentUser, so resolveCurrentUser (mayUseEasyEdit) has already let them in: allowlisted, on a team, invited,
// or sign-up is open. They see only the spaces they belong to.
export async function toolContextFor(user: CurrentUser, agent: AgentKind = "claude"): Promise<ToolContext> {
  const db = getDb();
  const spaces = await listMySpaces(db, user.id);
  return { db, user, agent, spaces, baseUrl: appBaseUrl(), limits: LIMITS, now: () => new Date() };
}
