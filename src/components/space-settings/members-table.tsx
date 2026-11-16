import Link from "next/link";
import type { ReactNode } from "react";
import { MEMBERS_HEADING_ID } from "@/app/(dashboard)/admin/ids";
import { LocalDate } from "@/app/(dashboard)/admin/local-date";
import { roleChoice } from "@/app/(dashboard)/admin/roles";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import type { Role } from "@/lib/allowlist/service";
import type { MemberActions } from "@/lib/spaces/member-actions";
import { InviteButton } from "./invite-dialog";
import { LeaveTeam, MemberRoleSelect, RemoveMember } from "./member-controls";
import { PendingInvites, type PendingInviteRow } from "./pending-invites";

export type { PendingInviteRow };

// One person in the team, as the server page hands it over. joinedAt is an ISO string so it can cross into the client
// date component.
export type MemberRow = { userId: string; name: string; email: string; role: Role; joinedAt: string; storageOwner: boolean };

export type MembersTableProps = {
  teamName: string;
  members: MemberRow[];
  me: string; // the viewer's user id
  viewerRole: Role; // in this team
  managedElsewhere: boolean; // Seattle Solvers: its members follow the allowlist, changed on the Admin page
  adminPageLink: boolean; // the viewer may open the Admin page
  pendingInvites: PendingInviteRow[]; // waiting invites, for admins only (empty for everyone else)
  actions: MemberActions;
};

const HEAD = "px-3 py-2 font-medium whitespace-nowrap";
const CELL = "px-3 py-2.5 align-middle";
const BADGE = "shrink-0 rounded bg-ed-raised px-1.5 text-[11px] leading-4 text-ed-muted";

// A team's Members tab: how many, and a table of everyone (name, email, role, when they joined). The team's admins add
// people by invite link, change roles and remove others; anyone may leave from their own row. The storage owner's Google Drive holds
// the team's videos, so they stay, as an admin. Seattle Solvers' list is read-only here.
export function MembersTable({ teamName, members, me, viewerRole, managedElsewhere, adminPageLink, pendingInvites, actions }: MembersTableProps): ReactNode {
  const canManage = viewerRole === "admin" && !managedElsewhere;
  return (
    <section aria-labelledby={MEMBERS_HEADING_ID} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {/* Focusable from script only, so focus has somewhere to land when a removed member's row goes away. */}
          <h2 id={MEMBERS_HEADING_ID} tabIndex={-1} className="text-sm font-semibold outline-none">
            Members
          </h2>
          <p className="text-xs text-ed-muted">
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>
        </div>
        {canManage && <InviteButton invite={actions.invite} />}
      </div>
      {managedElsewhere && (
        <p className="text-[13px] text-ed-muted">
          Seattle Solvers&apos; members are managed on the{" "}
          {adminPageLink ? (
            <Link href="/admin" className={cx("rounded-sm text-ed-text underline", FOCUS_RING)}>
              Admin page
            </Link>
          ) : (
            "Admin page"
          )}
          .
        </p>
      )}
      <div className="overflow-x-auto rounded-md border border-ed-line bg-ed-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-ed-line text-xs text-ed-muted">
              <th scope="col" className={HEAD}>
                Name
              </th>
              <th scope="col" className={HEAD}>
                Email
              </th>
              <th scope="col" className={HEAD}>
                Role
              </th>
              <th scope="col" className={cx(HEAD, "hidden sm:table-cell")}>
                Joined
              </th>
              <th scope="col" className={HEAD}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isMe = member.userId === me;
              return (
                <tr key={member.userId} className="border-b border-ed-line last:border-b-0">
                  {/* max-w-0 with a share of the width lets these columns take the spare room and cut long names and
                      emails short, instead of pushing the table wider than a phone. */}
                  <td className={cx(CELL, "w-1/2 max-w-0")}>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span title={member.name} className="min-w-0 truncate text-ed-text">
                        {member.name}
                      </span>
                      {isMe && <span className={BADGE}>You</span>}
                      {member.storageOwner && (
                        <span className={BADGE} title="This team's videos are stored in their Google Drive.">
                          Storage
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cx(CELL, "w-1/2 max-w-0")}>
                    <span title={member.email} className="block truncate text-ed-muted">
                      {member.email}
                    </span>
                  </td>
                  <td className={cx(CELL, "whitespace-nowrap")}>
                    {canManage ? (
                      <MemberRoleSelect userId={member.userId} email={member.email} role={member.role} locked={member.storageOwner} setRole={actions.setRole} />
                    ) : (
                      <span className="text-ed-text">{roleChoice(member.role)?.label ?? member.role}</span>
                    )}
                  </td>
                  <td className={cx(CELL, "hidden whitespace-nowrap text-ed-muted sm:table-cell")}>
                    <LocalDate iso={member.joinedAt} />
                  </td>
                  <td className={CELL}>
                    <div className="flex justify-end">
                      {managedElsewhere || member.storageOwner ? null : isMe ? (
                        <LeaveTeam teamName={teamName} leave={actions.leave} />
                      ) : canManage ? (
                        <RemoveMember userId={member.userId} name={member.name} email={member.email} teamName={teamName} remove={actions.remove} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canManage && <PendingInvites invites={pendingInvites} cancel={actions.cancelInvite} />}
    </section>
  );
}
