import { meetsRole, type CurrentUser } from "@/lib/access-rules";
import type { Role } from "@/lib/allowlist/service";
import { FORBIDDEN_BODY } from "@/lib/api-errors";
import type { AgentKind } from "@/lib/connector/agents";
import { agentActorId } from "@/lib/projects/display-actor";
import { ServiceError } from "@/lib/service-error";

// Who is calling the service. Every caller, HTTP or not, passes one so the service can check the role itself.
export type Actor = { userId: string; email: string; role: Role };

export function actorFrom(user: CurrentUser): Actor {
  return { userId: user.id, email: user.email, role: user.role };
}

// An AI agent acting for a member: the member's email and role, with the actor id the op log records.
export function agentActorFor(user: CurrentUser, kind: AgentKind): Actor {
  return { userId: agentActorId(kind, user.id), email: user.email, role: user.role };
}

export function claudeActorFor(user: CurrentUser): Actor {
  return agentActorFor(user, "claude");
}

export function requireRole(actor: Actor, min: Role): void {
  if (!meetsRole(actor.role, min)) throw new ServiceError("FORBIDDEN", 403, FORBIDDEN_BODY.message);
}
