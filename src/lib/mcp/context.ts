import { getDb } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { AgentKind } from "@/lib/connector/agents";
import { appBaseUrl } from "@/lib/connector/config";
import { openSignUp } from "@/lib/signup";
import { LIMITS } from "@/lib/limits";
import { listMySpaces } from "@/lib/spaces/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import type { ToolContext } from "./types";

export { actorForProject, actorInSpace } from "./actors";

// Everything a tool needs to act for the person whose AI agent is calling: all their spaces, loaded now. Null when the
// person is not a member of Seattle Solvers: until sign-up opens beyond the allowlist, the team is the gate. With
// sign-up open, being signed in is enough and the person sees only the spaces they belong to.
export async function toolContextFor(user: CurrentUser, agent: AgentKind = "claude"): Promise<ToolContext | null> {
  const db = getDb();
  const spaces = await listMySpaces(db, user.id);
  if (!openSignUp() && !spaces.some((space) => space.id === SEED_TEAM_ID)) return null;
  return { db, user, agent, spaces, baseUrl: appBaseUrl(), limits: LIMITS, now: () => new Date() };
}
