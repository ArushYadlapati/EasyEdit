"use client";

import { useState, type ReactNode } from "react";
import { LocalDate } from "@/app/(dashboard)/admin/local-date";
import { roleChoice } from "@/app/(dashboard)/admin/roles";
import { useAction } from "@/app/(app)/action-ui";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/allowlist/service";
import type { ActionResult } from "@/lib/spaces/member-actions";
import { CopyLinkButton } from "./copy-link-button";

// A waiting invite as the server page hands it over: dates as ISO strings, and the finished link to send.
export type PendingInviteRow = { id: string; email: string; role: Role; invitedBy: string; expiresAt: string; expired: boolean; link: string };

// The team's waiting invites, for its admins: who, as what, when it runs out, with the link to send again and a way to
// cancel. Nothing is drawn when there are none.
export function PendingInvites({ invites, cancel }: { invites: PendingInviteRow[]; cancel: (formData: FormData) => Promise<ActionResult> }): ReactNode {
  if (invites.length === 0) return null;
  return (
    <section aria-labelledby="pending-invites-heading" className="flex flex-col gap-2">
      <h3 id="pending-invites-heading" className="text-sm font-semibold">
        Pending invites
      </h3>
      <ul className="divide-y divide-ed-line rounded-md border border-ed-line bg-ed-panel">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-[13px]">
            <div className="min-w-0 flex-1">
              <span title={invite.email} className="block truncate text-ed-text">
                {invite.email}
              </span>
              <div className="flex flex-wrap gap-x-1.5 text-xs text-ed-muted">
                <span>{roleChoice(invite.role)?.label ?? invite.role}</span>
                <span aria-hidden>·</span>
                <span>
                  {invite.expired ? "Expired" : (
                    <>
                      Expires <LocalDate iso={invite.expiresAt} />
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CopyLinkButton link={invite.link} size="sm" />
              <CancelInvite invite={invite} cancel={cancel} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CancelInvite({ invite, cancel }: { invite: PendingInviteRow; cancel: (formData: FormData) => Promise<ActionResult> }): ReactNode {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { pending, submit } = useAction(cancel);

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setFailed(null);
          setAsking(true);
        }}
      >
        Cancel invite
      </Button>
      <ConfirmDialog
        title="Cancel invite"
        question={`Cancel the invite to ${invite.email}?`}
        confirmLabel="Cancel invite"
        open={asking}
        pending={pending}
        error={failed}
        onConfirm={() => {
          const formData = new FormData();
          formData.set("inviteId", invite.id);
          submit(formData, { onStart: () => setFailed(null), onSuccess: () => setAsking(false), onFailure: setFailed });
        }}
        onClose={() => setAsking(false)}
      />
    </>
  );
}
