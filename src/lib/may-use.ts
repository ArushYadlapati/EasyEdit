import type { DB } from "@/db";
import { getRole, type Role } from "@/lib/allowlist/service";
import { openSignUp } from "@/lib/signup";
import { hasPendingInvite } from "@/lib/spaces/invites";
import { inAnyTeam } from "@/lib/spaces/service";

// The one rule for who may use EasyEdit: sign-up is open, or the email is on the allowlist, or the person is on a
// team, or an invite is waiting for them. The team and invite queries run only when the allowlist says no.
// A caller that already looked up the allowlist role passes it, so the request runs getRole once.
export async function mayUseEasyEdit(db: DB, user: { id: string; email: string }, knownRole?: Role | null): Promise<boolean> {
  if (openSignUp()) return true;
  if ((knownRole === undefined ? await getRole(db, user.email) : knownRole) !== null) return true;
  return (await inAnyTeam(db, user.id)) || (await hasPendingInvite(db, user.email));
}
