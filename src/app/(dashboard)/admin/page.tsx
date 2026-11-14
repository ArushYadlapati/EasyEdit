import type { ReactNode } from "react";
import { getDb } from "@/db";
import { requireUser } from "@/lib/access";
import { listEntries } from "@/lib/allowlist/service";
import { connectedEmails } from "@/lib/connector/grants";
import { AddMemberButton } from "./add-member-dialog";
import { MEMBERS_HEADING_ID } from "./ids";
import { MembersTable, type Member } from "./members-table";

// The members page, read on the server. It sits in the dashboard's frame, so it scrolls itself under the header.
export default async function AdminPage(): Promise<ReactNode> {
  // The page checks for itself: a layout renders alongside its page and is not run again on a client navigation.
  const me = await requireUser("admin");
  const db = getDb();
  const [entries, connected] = await Promise.all([listEntries(db), connectedEmails(db)]);
  const members: Member[] = entries.map((entry) => ({
    email: entry.email,
    role: entry.role,
    invitedBy: entry.invitedBy,
    createdAt: entry.createdAt.toISOString(),
    claudeConnected: connected.has(entry.email),
  }));
  const connectedCount = members.filter((member) => member.claudeConnected).length;

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            {/* Focusable from script only, so focus has somewhere to land when a removed member's row goes away. */}
            <h1 id={MEMBERS_HEADING_ID} tabIndex={-1} className="text-base font-semibold outline-none">
              Members
            </h1>
            {/* Names Claude too: keep it in step with the table's Claude column when that widens to other agents. */}
            <p className="text-xs text-ed-muted">
              {members.length} {members.length === 1 ? "member" : "members"} · {connectedCount} connected to Claude
            </p>
          </div>
          <AddMemberButton />
        </div>
        <MembersTable members={members} me={me.email} />
      </div>
    </main>
  );
}
