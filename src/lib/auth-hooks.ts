import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { getRole, normalizeEmail } from "@/lib/allowlist/service";
import { openSignUp } from "@/lib/signup";
import { hasPendingInvite } from "@/lib/spaces/invites";
import { ensurePersonalSpace, inAnyTeam, syncSeedTeamMembership } from "@/lib/spaces/service";

// `code` makes Better Auth's OAuth callback redirect to the errorCallbackURL instead of answering with JSON.
function notAllowlisted(): APIError {
  return new APIError("FORBIDDEN", { code: "NOT_ALLOWLISTED", message: "NOT_ALLOWLISTED" });
}

export function makeUserCreateBefore(db: DB) {
  return async <U extends { email: string; emailVerified?: boolean }>(newUser: U): Promise<{ data: U }> => {
    const email = normalizeEmail(newUser.email);
    // An email the provider has not verified proves nothing about who owns it, and neither does one it says nothing
    // about (Google always says). With sign-up open, a verified email is enough; otherwise it must be on the allowlist.
    if (newUser.emailVerified !== true) throw notAllowlisted();
    if (!openSignUp() && (await getRole(db, email)) === null && !(await hasPendingInvite(db, email))) throw notAllowlisted();
    return { data: { ...newUser, email } };
  };
}

export function makeSessionCreateBefore(db: DB) {
  return async (session: { userId: string }): Promise<void> => {
    const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, session.userId));
    const email = rows[0]?.email;
    if (email === undefined) throw notAllowlisted();
    // Closed sign-up lets in the allowlist, anyone on a team, and anyone with a pending invite.
    if (
      !openSignUp() &&
      (await getRole(db, email)) === null &&
      !(await inAnyTeam(db, session.userId)) &&
      !(await hasPendingInvite(db, email))
    ) {
      throw notAllowlisted();
    }
    // Repairs a missing personal space or an out-of-date team role.
    await ensurePersonalSpace(db, { id: session.userId });
    await syncSeedTeamMembership(db, { id: session.userId, email });
  };
}

export function makeUserCreateAfter(db: DB) {
  return async (created: { id: string; email: string }): Promise<void> => {
    await ensurePersonalSpace(db, created);
    await syncSeedTeamMembership(db, created);
  };
}
