import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import { ServiceError } from "@/lib/service-error";
import { actorIn } from "./access";
import { cancelInvite as cancelInviteById, inviteToTeam } from "./invites";
import { deleteTeam as deleteTeamById, leaveTeam, removeMember, setMemberRole } from "./members";

export type ActionResult = { error?: string };
// An invite also hands back the link to send.
export type InviteResult = ActionResult & { link?: string };

export type MemberActionDeps = {
  db: () => DB;
  requireUser: () => Promise<CurrentUser>;
  revalidate: () => void; // every page that shows the person's spaces or the team's members
  redirect: (path: string) => never;
  inviteLink: (inviteId: string) => string; // the address an invitee opens (server-only, so it is passed in)
  deleteReader: (email: string) => Promise<void>; // removes a deleted team's reader account from Google Cloud
};

// What a space the caller isn't in answers, the same as one that doesn't exist (the members service's own message).
const SPACE_NOT_FOUND = "Space not found";

const field = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const plain = async (result: Promise<ActionResult & { value?: unknown }>): Promise<ActionResult> => {
  const { error } = await result;
  return error === undefined ? {} : { error };
};

// The Members screen's changes. Each finds the caller's role in the space afresh; the service checks it again in the
// statement that makes the change, and its refusals come back as the action's error.
export function makeMemberActions(deps: MemberActionDeps) {
  async function run<T>(spaceId: string, call: (db: DB, actor: Actor) => Promise<T>): Promise<ActionResult & { value?: T }> {
    const db = deps.db();
    const actor = await actorIn(db, await deps.requireUser(), spaceId);
    if (!actor) return { error: SPACE_NOT_FOUND };
    let value: T;
    try {
      value = await call(db, actor);
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      // A refusal often means the page is out of date (someone removed elsewhere, the caller no longer an admin), so
      // it is refreshed too.
      deps.revalidate();
      return { error: error.message };
    }
    deps.revalidate();
    return { value };
  }

  return {
    // The role is checked by the service; any text is passed on as it came. The link goes back to the dialog, which
    // shows it for the admin to send.
    async invite(spaceId: string, formData: FormData): Promise<InviteResult> {
      const result = await run(spaceId, (db, actor) => inviteToTeam(db, actor, { email: field(formData, "email"), role: field(formData, "role") as Role }));
      if (result.error !== undefined || result.value === undefined) return { error: result.error };
      return { link: deps.inviteLink(result.value.id) };
    },
    async cancelInvite(spaceId: string, formData: FormData): Promise<ActionResult> {
      const { error } = await run(spaceId, (db, actor) => cancelInviteById(db, actor, field(formData, "inviteId")));
      return error === undefined ? {} : { error };
    },
    setRole: (spaceId: string, formData: FormData) =>
      plain(run(spaceId, (db, actor) => setMemberRole(db, actor, { userId: field(formData, "userId"), role: field(formData, "role") as Role }))),
    remove: (spaceId: string, formData: FormData) => plain(run(spaceId, (db, actor) => removeMember(db, actor, field(formData, "userId")))),
    // Gone from the team, the person goes on to the dashboard's old address, which picks where they land (lastSpace):
    // the team they left is no longer theirs, so another team, or their own space where those are offered.
    async leave(spaceId: string): Promise<ActionResult> {
      const result = await plain(run(spaceId, (db, actor) => leaveTeam(db, actor)));
      if (result.error !== undefined) return result;
      return deps.redirect("/dashboard");
    },
    // The team is gone for everyone once this returns; its reader account is removed after, best effort (an orphaned
    // reader has no folder shared with it that anyone can reach, so a failure here never undoes the deletion).
    async deleteTeam(spaceId: string, formData: FormData): Promise<ActionResult> {
      const result = await run(spaceId, (db, actor) => deleteTeamById(db, actor, { confirmName: field(formData, "confirmName") }));
      if (result.error !== undefined || result.value === undefined) return { error: result.error };
      const email = result.value.readerEmail;
      if (email !== null) {
        try {
          await deps.deleteReader(email);
        } catch {
          console.error("A deleted team's reader account could not be removed");
        }
      }
      return deps.redirect("/dashboard");
    },
  };
}

type SpaceMemberActions = ReturnType<typeof makeMemberActions>;

type WithoutSpace<F> = F extends (spaceId: string, ...rest: infer R) => infer T ? (...rest: R) => T : never;

// What the Members screen calls: the actions with their space already bound.
export type MemberActions = { [K in keyof SpaceMemberActions]: WithoutSpace<SpaceMemberActions[K]> };
