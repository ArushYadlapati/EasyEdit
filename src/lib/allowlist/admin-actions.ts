import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { revokeAccess } from "@/lib/connector/grants";
import { syncSeedTeamMembership } from "@/lib/spaces/service";
import { addEntry, AllowlistError, normalizeEmail, removeEntry, setRole, type Role } from "@/lib/allowlist/service";

export type ActionResult = { error?: string };

export type AdminActionDeps = {
  db: () => DB;
  requireUser: (min: Role) => Promise<CurrentUser>;
  revalidate: (path: string) => void;
};

const ROLES: readonly Role[] = ["admin", "editor", "viewer"];

const ERROR_MESSAGES: Record<AllowlistError["code"], string> = {
  LAST_ADMIN: "There must always be at least one admin.",
  INVALID_EMAIL: "That doesn't look like an email address.",
  ALREADY_MEMBER: "That email is already a member. Change their role in the table.",
};

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function roleField(formData: FormData): Role | null {
  const value = textField(formData, "role");
  return ROLES.find((r) => r === value) ?? null;
}

// Seattle Solvers' member rows mirror the allowlist: after a write, bring that person's row in step, if they have signed in.
async function syncTeamMembership(db: DB, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const rows = await db.select({ id: user.id, email: user.email }).from(user).where(eq(user.email, normalized));
  if (rows[0]) await syncSeedTeamMembership(db, rows[0]);
}

export function makeAdminActions(deps: AdminActionDeps) {
  async function run(change: (admin: CurrentUser, db: DB) => Promise<ActionResult | void>): Promise<ActionResult> {
    const admin = await deps.requireUser("admin");
    try {
      const failure = await change(admin, deps.db());
      if (failure) return failure;
    } catch (e) {
      if (e instanceof AllowlistError) return { error: ERROR_MESSAGES[e.code] };
      throw e;
    }
    deps.revalidate("/admin");
    return {};
  }

  return {
    addMember: (formData: FormData) =>
      run(async (admin, db) => {
        const role = roleField(formData);
        if (!role) return { error: "Unknown role." };
        const email = textField(formData, "email");
        await addEntry(db, { email, role, invitedBy: admin.email });
        await syncTeamMembership(db, email);
      }),
    setRole: (formData: FormData) =>
      run(async (_admin, db) => {
        const role = roleField(formData);
        if (!role) return { error: "Unknown role." };
        const email = normalizeEmail(textField(formData, "email"));
        await setRole(db, email, role);
        await syncTeamMembership(db, email);
      }),
    removeMember: (formData: FormData) =>
      run(async (_admin, db) => {
        const email = textField(formData, "email");
        await removeEntry(db, email);
        await syncTeamMembership(db, email);
      }),
    // Ends the member's Claude connection only; their website sessions stay.
    disconnectClaude: (formData: FormData) =>
      run(async (_admin, db) => {
        await revokeAccess(db, { email: normalizeEmail(textField(formData, "email")) }, { sessions: false });
      }),
  };
}
