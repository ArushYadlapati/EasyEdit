"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { canCreateTeam } from "@/lib/spaces/create-team-access";
import { listMySpaces } from "@/lib/spaces/service";
import { makeTeamActions, type TeamFormState } from "@/lib/spaces/team-actions";

const actions = makeTeamActions({
  db: getDb,
  requireUser: () => requireUser(),
  revalidate: (path) => revalidatePath(path, "layout"),
  canCreateTeam: async (user) => canCreateTeam(await listMySpaces(getDb(), user.id)),
});

export async function createTeamAction(formData: FormData): Promise<TeamFormState> {
  return actions.create(formData);
}
