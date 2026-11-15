import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import { ServiceError } from "@/lib/service-error";
import { actorIn } from "./access";
import { addMemberByEmail, leaveTeam, removeMember, setMemberRole } from "./members";
import { PERSONAL_ALIAS } from "./types";

export type ActionResult = { error?: string };

export type MemberActionDeps = {
  db: () => DB;
  requireUser: () => Promise<CurrentUser>;
  revalidate: () => void; // every page that shows the person's spaces or the team's members
  redirect: (path: string) => never;
};

// What a space the caller isn't in answers, the same as one that doesn't exist (the members service's own message).
const SPACE_NOT_FOUND = "Space not found";

const field = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

// The Members screen's changes. Each finds the caller's role in the space afresh; the service checks it again in the
// statement that makes the change, and its refusals come back as the action's error.
export function makeMemberActions(deps: MemberActionDeps) {
  async function run(spaceId: string, call: (db: DB, actor: Actor) => Promise<unknown>): Promise<ActionResult> {
    const db = deps.db();
    const actor = await actorIn(db, await deps.requireUser(), spaceId);
    if (!actor) return { error: SPACE_NOT_FOUND };
    try {
      await call(db, actor);
    } catch (error) {
      if (error instanceof ServiceError) return { error: error.message };
      throw error;
    }
    deps.revalidate();
    return {};
  }

  return {
    // The role is checked by the service; any text is passed on as it came.
    add: (spaceId: string, formData: FormData) =>
      run(spaceId, (db, actor) => addMemberByEmail(db, actor, { email: field(formData, "email"), role: field(formData, "role") as Role })),
    setRole: (spaceId: string, formData: FormData) =>
      run(spaceId, (db, actor) => setMemberRole(db, actor, { userId: field(formData, "userId"), role: field(formData, "role") as Role })),
    remove: (spaceId: string, formData: FormData) => run(spaceId, (db, actor) => removeMember(db, actor, field(formData, "userId"))),
    // Gone from the team, the person goes to their own space.
    async leave(spaceId: string): Promise<ActionResult> {
      const result = await run(spaceId, (db, actor) => leaveTeam(db, actor));
      if (result.error !== undefined) return result;
      return deps.redirect(`/s/${PERSONAL_ALIAS}`);
    },
  };
}

type SpaceMemberActions = ReturnType<typeof makeMemberActions>;

type WithoutSpace<F> = F extends (spaceId: string, ...rest: infer R) => infer T ? (...rest: R) => T : never;

// What the Members screen calls: the actions with their space already bound.
export type MemberActions = { [K in keyof SpaceMemberActions]: WithoutSpace<SpaceMemberActions[K]> };
