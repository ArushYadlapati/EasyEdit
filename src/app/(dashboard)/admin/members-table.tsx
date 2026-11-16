import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import type { Role } from "@/lib/allowlist/service";
import { LocalDate } from "./local-date";
import { MemberActions, RoleSelect } from "./member-controls";

// One row of the members table, as the server page hands it over. createdAt is an ISO string so it can cross into
// the client date component.
export type Member = { email: string; role: Role; invitedBy: string | null; createdAt: string; claudeConnected: boolean };

const HEAD = "px-3 py-2 font-medium whitespace-nowrap";
const CELL = "px-3 py-2.5 align-middle";

// Everyone who can sign in: their role, whether Claude is connected for them, when they were added, and a menu
// with the rest. The signed-in admin's own row has no Remove, so nobody locks themselves out from here.
export function MembersTable({ members, me, signUpOpen = false }: { members: Member[]; me: string; signUpOpen?: boolean }): ReactNode {
  return (
    <div className="overflow-x-auto rounded-md border border-ed-line bg-ed-panel">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-ed-line text-xs text-ed-muted">
            <th scope="col" className={HEAD}>
              Member
            </th>
            <th scope="col" className={HEAD}>
              Role
            </th>
            <th scope="col" className={HEAD}>
              Claude
            </th>
            <th scope="col" className={cx(HEAD, "hidden sm:table-cell")}>
              Added
            </th>
            <th scope="col" className={HEAD}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.email} className="border-b border-ed-line last:border-b-0">
              {/* max-w-0 with w-full lets this column take the spare width and cut long emails short, instead of
                  pushing the table wider than a phone. */}
              <td className={cx(CELL, "w-full max-w-0")}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span title={member.email} className="min-w-0 truncate text-ed-text">
                    {member.email}
                  </span>
                  {member.email === me && (
                    <span className="shrink-0 rounded bg-ed-raised px-1.5 text-[11px] leading-4 text-ed-muted">You</span>
                  )}
                </div>
                {member.invitedBy !== null && (
                  <p title={member.invitedBy} className="truncate text-xs text-ed-muted">
                    Invited by {member.invitedBy}
                  </p>
                )}
              </td>
              <td className={CELL}>
                <RoleSelect email={member.email} role={member.role} />
              </td>
              <td className={cx(CELL, "whitespace-nowrap")}>
                <ConnectionStatus connected={member.claudeConnected} />
              </td>
              <td className={cx(CELL, "hidden whitespace-nowrap text-ed-muted sm:table-cell")}>
                <LocalDate iso={member.createdAt} />
              </td>
              <td className={CELL}>
                <div className="flex justify-end">
                  <MemberActions email={member.email} claudeConnected={member.claudeConnected} isSelf={member.email === me} signUpOpen={signUpOpen} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Plain status, no buttons: disconnecting lives in the row's menu. This and the "Claude" heading above are the only
// places the table names Claude. Widening it to other AI agents later also means the page summary (page.tsx) and the
// Disconnect Claude item and dialog (member-controls.tsx), which name Claude too.
export function ConnectionStatus({ connected }: { connected: boolean }): ReactNode {
  if (!connected) return <span className="text-ed-muted">Not connected</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-ed-text">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ed-accent" />
      Connected
    </span>
  );
}
