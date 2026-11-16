import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { ServiceError } from "@/lib/service-error";
import { acceptInvite, declineInvite } from "./invites";
import { spacePath } from "./paths";

export type InviteActionResult = { error?: string };

export type InviteActionDeps = {
  db: () => DB;
  requireUser: () => Promise<CurrentUser>;
  revalidate: () => void; // the space switcher and every page that shows the person's teams
  redirect: (path: string) => never;
};

// The invite page's two buttons. The service checks the email, status and expiry in the statement that makes the
// change; its refusals come back as the action's error.
export function makeInviteActions(deps: InviteActionDeps) {
  async function run<T>(call: (db: DB, who: CurrentUser) => Promise<T>): Promise<{ result: T } | { error: string }> {
    const who = await deps.requireUser();
    try {
      return { result: await call(deps.db(), who) };
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      deps.revalidate();
      return { error: error.message };
    }
  }

  return {
    async accept(inviteId: string): Promise<InviteActionResult> {
      const outcome = await run((db, who) => acceptInvite(db, who, inviteId));
      if ("error" in outcome) return outcome;
      deps.revalidate();
      return deps.redirect(spacePath(outcome.result.teamSlug));
    },
    async decline(inviteId: string): Promise<InviteActionResult> {
      const outcome = await run((db, who) => declineInvite(db, who, inviteId));
      if ("error" in outcome) return outcome;
      deps.revalidate();
      return deps.redirect("/dashboard");
    },
  };
}
