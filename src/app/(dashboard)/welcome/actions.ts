"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { markOnboarded } from "@/lib/onboarding/state";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { ensurePersonalSpace, lastSpace, listMySpaces } from "@/lib/spaces/service";

// Finish, Skip on the last step and Skip setup all come here: the person is done, and goes to the team they came to
// join (when `team` names one of theirs) or to their personal space.
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
  return redirect(spacePath(slugFor(named ?? (await lastSpace(db, me.id)))));
}
