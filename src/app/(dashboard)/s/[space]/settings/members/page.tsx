import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { MembersTable } from "@/components/space-settings/members-table";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { actorIn } from "@/lib/spaces/access";
import type { MemberActions } from "@/lib/spaces/member-actions";
import { listTeamMembers } from "@/lib/spaces/members";
import { findMySpace } from "@/lib/spaces/service";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { addMemberAction, leaveTeamAction, removeMemberAction, setMemberRoleAction } from "./actions";

// The server actions with this team already bound as their first argument.
const actionsFor = (spaceId: string): MemberActions => ({
  add: addMemberAction.bind(null, spaceId),
  setRole: setMemberRoleAction.bind(null, spaceId),
  remove: removeMemberAction.bind(null, spaceId),
  leave: leaveTeamAction.bind(null, spaceId),
});

// A team's members, for anyone in it; its admins get the controls. A personal space has no members page, and a space
// the person isn't in is a plain 404. The page checks for itself: a layout is not run again on a client navigation.
export default async function MembersPage({ params }: PageProps<"/s/[space]/settings/members">): Promise<ReactNode> {
  const user = await requireUser();
  const db = getDb();
  const space = await findMySpace(db, user.id, (await params).space);
  if (!space || space.kind !== "team") notFound();
  const actor = await actorIn(db, user, space.id);
  if (!actor) notFound();
  const members = await listTeamMembers(db, actor);

  return (
    <MembersTable
      teamName={space.name}
      members={members.map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        storageOwner: m.storageOwner,
      }))}
      me={user.id}
      viewerRole={actor.role}
      managedElsewhere={space.id === SEED_TEAM_ID}
      adminPageLink={user.allowlistRole === "admin"}
      actions={actionsFor(space.id)}
    />
  );
}
