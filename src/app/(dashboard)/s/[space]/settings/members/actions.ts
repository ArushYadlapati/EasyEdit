"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { inviteUrl } from "@/lib/spaces/invite-link";
import { makeMemberActions, type ActionResult, type InviteResult, type RenameResult } from "@/lib/spaces/member-actions";

// The whole layout: the space switcher and every page that shows the team change with its members.
const actions = makeMemberActions({ db: getDb, requireUser: () => requireUser(), revalidate: () => revalidatePath("/", "layout"), redirect, inviteLink: inviteUrl });

// The Members page binds the space as the first argument of each.
export async function inviteMemberAction(spaceId: string, formData: FormData): Promise<InviteResult> {
  return actions.invite(spaceId, formData);
}

export async function cancelInviteAction(spaceId: string, formData: FormData): Promise<ActionResult> {
  return actions.cancelInvite(spaceId, formData);
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

export async function deleteTeamAction(spaceId: string, formData: FormData): Promise<ActionResult> {
  return actions.deleteTeam(spaceId, formData);
}

export async function renameTeamAction(spaceId: string, formData: FormData): Promise<RenameResult> {
  return actions.rename(spaceId, formData);
}
