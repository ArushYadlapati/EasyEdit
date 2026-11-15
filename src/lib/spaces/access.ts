import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { actorFrom, type Actor } from "@/lib/actor";
import { roleIn, spaceOfAsset, spaceOfProject } from "./service";

// The user acting in a space, with their role there. Null when they are not a member: the caller answers 404.
export async function actorIn(db: DB, user: CurrentUser, spaceId: string): Promise<Actor | null> {
  const role = await roleIn(db, user.id, spaceId);
  return role ? actorFrom(user, { spaceId, role }) : null;
}

// The user acting in the space a live project belongs to. Null for a deleted or unknown project, or a space the
// user is not a member of.
export async function projectActor(db: DB, user: CurrentUser, projectId: string): Promise<Actor | null> {
  const spaceId = await spaceOfProject(db, projectId);
  return spaceId ? actorIn(db, user, spaceId) : null;
}

// The same for an upload that has not been removed.
export async function assetActor(db: DB, user: CurrentUser, assetId: string): Promise<Actor | null> {
  const spaceId = await spaceOfAsset(db, assetId);
  return spaceId ? actorIn(db, user, spaceId) : null;
}

// The space a request names in `?space=<id>`. Null when it names none.
export function spaceQuery(req: Request): string | null {
  return new URL(req.url).searchParams.get("space") || null;
}
