"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { hasOnboarded } from "@/lib/onboarding/state";
import { makeInviteActions, type InviteActionResult } from "@/lib/spaces/invite-actions";

const actions = makeInviteActions({ db: getDb, requireUser: () => requireUser(), revalidate: () => revalidatePath("/", "layout"), redirect, hasOnboarded });

export async function acceptInviteAction(inviteId: string): Promise<InviteActionResult> {
  return actions.accept(inviteId);
}

export async function declineInviteAction(inviteId: string): Promise<InviteActionResult> {
  return actions.decline(inviteId);
}
