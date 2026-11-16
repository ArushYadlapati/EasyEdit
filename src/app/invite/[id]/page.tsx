import type { Metadata } from "next";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/access";
import { roleChoice } from "@/app/(dashboard)/admin/roles";
import { InviteCard, type InviteCardState } from "@/components/invite/invite-card";
import { loginErrorMessage } from "@/lib/login-error-message";
import { openSignUp } from "@/lib/signup";
import { findInvite } from "@/lib/spaces/invites";
import { findMySpace } from "@/lib/spaces/service";
import { acceptInviteAction, declineInviteAction } from "./actions";

// The messages the service gives when someone tries to use an invite that can't be used.
const UNKNOWN = "This invite link doesn't work.";
const EXPIRED = "This invite has expired. Ask a team admin for a new one.";
const USED = "This invite has already been used or cancelled.";

// A link with a private id on it: not for search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[id]">) {
  const { id } = await params;
  const { error } = await searchParams;
  const db = getDb();
  const [invite, me] = await Promise.all([findInvite(db, id), getCurrentUser()]);

  let state: InviteCardState;
  if (!invite) {
    state = { kind: "unusable", message: UNKNOWN };
  } else if (me && (await findMySpace(db, me.id, invite.teamSlug))) {
    // Already in the team, whatever became of the invite.
    state = { kind: "member", teamName: invite.teamName, teamSlug: invite.teamSlug };
  } else if (invite.status === "expired") {
    state = { kind: "unusable", message: EXPIRED };
  } else if (invite.status !== "pending") {
    state = { kind: "unusable", message: USED };
  } else {
    const offer = { inviteId: invite.id, invitedBy: invite.invitedBy, teamName: invite.teamName, roleLabel: roleChoice(invite.role)?.label ?? invite.role };
    // The invited address is only shown to someone signed in, and only when it is theirs.
    if (!me) state = { kind: "signed-out", ...offer };
    else if (me.email === invite.email) state = { kind: "join", ...offer };
    else state = { kind: "wrong-account", ...offer, signedInEmail: me.email };
  }

  return <InviteCard state={state} notice={loginErrorMessage(Array.isArray(error) ? error[0] : error, openSignUp())} accept={acceptInviteAction} decline={declineInviteAction} />;
}
