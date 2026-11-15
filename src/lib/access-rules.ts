import type { DB } from "@/db";
import { openSignUp } from "@/lib/signup";
import { getRole, normalizeEmail, ROLE_RANK, type Role } from "@/lib/allowlist/service";

// Who is signed in. `allowlistRole` is for the sign-in gate and /admin only (null: not on the allowlist, possible only
// while sign-up is open): a project, folder or upload is checked
// against the role in its space, which the actor carries.
export type CurrentUser = { id: string; email: string; name: string; image: string | null; allowlistRole: Role | null };

export type SessionUser = { id: string; email: string; name: string; image?: string | null };

export function meetsRole(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

// Whether a signed-in person clears a minimum allowlist role. With sign-up open, someone off the allowlist is
// signed in but has no allowlist role, so only the lowest bar ("viewer": signed in) is met.
export function userMeetsRole(user: CurrentUser, min: Role): boolean {
  return user.allowlistRole === null ? min === "viewer" : meetsRole(user.allowlistRole, min);
}

export async function resolveCurrentUser(db: DB, sessionUser: SessionUser | null): Promise<CurrentUser | null> {
  if (!sessionUser) return null;
  const email = normalizeEmail(sessionUser.email);
  const allowlistRole = await getRole(db, email);
  if (allowlistRole === null && !openSignUp()) return null;
  return { id: sessionUser.id, email, name: sessionUser.name, image: sessionUser.image ?? null, allowlistRole };
}
