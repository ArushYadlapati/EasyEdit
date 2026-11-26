"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { markOnboarded } from "@/lib/onboarding/state";
import { STORAGE_LATER_COOKIE, STORAGE_LATER_SECONDS } from "@/lib/onboarding/storage-later";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { ensurePersonalSpace, lastSpace, listMySpaces } from "@/lib/spaces/service";

// The welcome's last step comes here: the person is done, and goes to the team they came to join (when `team` names
// one of theirs) or to their personal space. next=new-project opens New project there. storage=later (they skipped
// storage in the welcome) leaves the dashboard's storage card out for a while; see STORAGE_LATER_COOKIE.
export async function finishOnboardingAction(formData: FormData): Promise<never> {
  const me = await requireUser();
  const db = getDb();
  // Finishing never blocks: if the mark can't be written, the person still goes on (they may see this again).
  await markOnboarded(db, me.id).catch(() => console.error("onboarding: could not save the finished mark"));
  const team = formData.get("team");
  const spaces = await listMySpaces(db, me.id);
  const named = typeof team === "string" && team ? spaces.find((s) => s.kind === "team" && s.slug === team) : undefined;
  // Otherwise where /dashboard would send them (their last space; a team while Personal spaces are closed).
  await ensurePersonalSpace(db, me);
  if (formData.get("storage") === "later") {
    (await cookies()).set(STORAGE_LATER_COOKIE, "1", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: STORAGE_LATER_SECONDS });
  }
  const query = formData.get("next") === "new-project" ? { new: "project" } : undefined;
  return redirect(spacePath(slugFor(named ?? (await lastSpace(db, me.id))), query));
}
