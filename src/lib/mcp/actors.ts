import { agentActorFor, type Actor } from "@/lib/actor";
import { spaceOfProject } from "@/lib/spaces/service";
import type { SpaceToolContext, ToolContext } from "./types";

// The agent acting for the person in one of their spaces, with their role there. Null for any other space.
export function actorInSpace(ctx: ToolContext, spaceId: string): Actor | null {
  const space = ctx.spaces.find((s) => s.id === spaceId);
  return space ? agentActorFor(ctx.user, ctx.agent, { spaceId, role: space.role }) : null;
}

// The agent's actor in the space a live project belongs to. Null when the project is missing, deleted, or in a space
// the person is not in: all three answer the same not-found.
export async function actorForProject(ctx: ToolContext, projectId: string): Promise<Actor | null> {
  const spaceId = await spaceOfProject(ctx.db, projectId);
  return spaceId === null ? null : actorInSpace(ctx, spaceId);
}

// The context for working on one project, or null as above.
export async function projectContext(ctx: ToolContext, projectId: string): Promise<SpaceToolContext | null> {
  const actor = await actorForProject(ctx, projectId);
  return actor === null ? null : { ...ctx, actor };
}
