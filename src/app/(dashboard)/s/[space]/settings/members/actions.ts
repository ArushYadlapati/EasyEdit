"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { mainServiceAccount } from "@/lib/drive";
import { deleteReader } from "@/lib/drive/reader";
import { storageConfig } from "@/lib/storage/config";
import { inviteUrl } from "@/lib/spaces/invite-link";
import { makeMemberActions, type ActionResult, type InviteResult } from "@/lib/spaces/member-actions";

// Removes a team's reader account with the app's service account. Skipped when storage isn't set up on this server
// (there can be no reader then); a failure comes out as an error, which the action logs and carries on from.
async function removeReader(email: string): Promise<void> {
  const projectId = storageConfig()?.projectId;
  const caller = mainServiceAccount();
  if (!projectId || !caller) return;
  await deleteReader({ caller, projectId, email });
}

// The whole layout: the space switcher and every page that shows the team change with its members.
const actions = makeMemberActions({ db: getDb, requireUser: () => requireUser(), revalidate: () => revalidatePath("/", "layout"), redirect, inviteLink: inviteUrl, deleteReader: removeReader });

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
