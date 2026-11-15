import type { DB } from "@/db";
import { getRole, normalizeEmail, ROLE_RANK, type Role } from "@/lib/allowlist/service";

// Who is signed in. `allowlistRole` is for the sign-in gate and /admin only: a project, folder or upload is checked
// against the role in its space, which the actor carries.
export type CurrentUser = { id: string; email: string; name: string; image: string | null; allowlistRole: Role };

export type SessionUser = { id: string; email: string; name: string; image?: string | null };

export function meetsRole(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function resolveCurrentUser(db: DB, sessionUser: SessionUser | null): Promise<CurrentUser | null> {
  if (!sessionUser) return null;
  const email = normalizeEmail(sessionUser.email);
  const allowlistRole = await getRole(db, email);
  if (allowlistRole === null) return null;
  return { id: sessionUser.id, email, name: sessionUser.name, image: sessionUser.image ?? null, allowlistRole };
}
