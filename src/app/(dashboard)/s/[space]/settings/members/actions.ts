"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { makeMemberActions, type ActionResult } from "@/lib/spaces/member-actions";

// The whole layout: the space switcher and every page that shows the team change with its members.
const actions = makeMemberActions({ db: getDb, requireUser: () => requireUser(), revalidate: () => revalidatePath("/", "layout"), redirect });

// The Members page binds the space as the first argument of each.
export async function addMemberAction(spaceId: string, formData: FormData): Promise<ActionResult> {
  return actions.add(spaceId, formData);
}

export async function setMemberRoleAction(spaceId: string, formData: FormData): Promise<ActionResult> {
  return actions.setRole(spaceId, formData);
}

export async function removeMemberAction(spaceId: string, formData: FormData): Promise<ActionResult> {
  return actions.remove(spaceId, formData);
}

export async function leaveTeamAction(spaceId: string): Promise<ActionResult> {
  return actions.leave(spaceId);
}
