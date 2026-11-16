"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { markOnboarded } from "@/lib/onboarding/state";
import { slugFor, spacePath } from "@/lib/spaces/paths";
import { listMySpaces } from "@/lib/spaces/service";

// Finish, Skip on the last step and Skip setup all come here: the person is done, and goes to the team they came to
// join (when `team` names one of theirs) or to their personal space.
export async function finishOnboardingAction(formData: FormData): Promise<never> {
  const me = await requireUser();
  const db = getDb();
  await markOnboarded(db, me.id);
  const team = formData.get("team");
  const spaces = await listMySpaces(db, me.id);
  const there =
    (typeof team === "string" && team ? spaces.find((s) => s.kind === "team" && s.slug === team) : undefined) ??
    spaces.find((s) => s.kind === "personal");
  return redirect(there ? spacePath(slugFor(there)) : "/s/personal");
}
