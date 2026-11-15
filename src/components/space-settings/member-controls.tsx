"use client";

import { ChevronDown, Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MEMBERS_HEADING_ID } from "@/app/(dashboard)/admin/ids";
import { ROLE_CHOICES } from "@/app/(dashboard)/admin/roles";
import { useAction } from "@/app/(app)/action-ui";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { Menu } from "@/components/ui/menu";
import type { Role } from "@/lib/allowlist/service";
import type { ActionResult } from "@/lib/spaces/member-actions";

type FormAction = (formData: FormData) => Promise<ActionResult>;

const withUser = (userId: string, more: Record<string, string> = {}) => {
  const formData = new FormData();
  formData.set("userId", userId);
  for (const [key, value] of Object.entries(more)) formData.set(key, value);
  return formData;
};

// A team member's role, changed in place, as on the Admin page: a native select with no box until hovered or focused,
// so a column of them reads as text. The picked role shows at once and goes back to the saved one if the change is
// refused. `locked`: the storage owner, who stays an admin, so the select is fixed.
export function MemberRoleSelect({ userId, email, role, locked, setRole }: {
  userId: string;
  email: string;
  role: Role;
  locked: boolean;
  setRole: FormAction;
}): ReactNode {
  const { error, pending, submit } = useAction(setRole);
  const [value, setValue] = useState<Role>(role);
  // A new role from the server, after a change here or elsewhere, replaces what is shown.
  const [syncedRole, setSyncedRole] = useState<Role>(role);
  if (role !== syncedRole) {
    setSyncedRole(role);
    setValue(role);
  }

  function change(next: Role) {
    if (pending || locked) return; // one change at a time; the select stays as it was
    setValue(next);
    submit(withUser(userId, { role: next }), { onFailure: () => setValue(role) });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="relative inline-flex">
        <select
          aria-label={`Role for ${email}`}
          value={value}
          disabled={locked}
          title={locked ? "This team's videos are stored in their Google Drive, so they stay an admin." : undefined}
          // Held, not disabled, while saving: a disabled select drops keyboard focus.
          aria-disabled={pending || undefined}
          // The options are ROLE_CHOICES, so the value is always one of their roles.
          onChange={(event) => change(event.target.value as Role)}
          className={cx(
            "peer h-7 appearance-none rounded-md border border-transparent bg-transparent pr-7 pl-2 text-[13px] leading-5 text-ed-text",
            "not-aria-disabled:not-disabled:hover:bg-ed-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
            "disabled:cursor-default disabled:text-ed-muted",
            FOCUS_RING_INSET,
            FADE,
          )}
        >
          {ROLE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          size={16}
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1.5 right-1.5 text-ed-muted peer-disabled:hidden peer-aria-disabled:opacity-40"
        />
      </span>
      {error && (
        <p role="alert" className="text-xs text-ed-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// Another member's ⋯ menu, for the team's admins: Remove from team, which asks first in a dialog that shows a refusal
// and stays open, and closes once they are gone. Their row then goes away, so focus moves to the Members heading.
export function RemoveMember({ userId, name, email, teamName, remove }: {
  userId: string;
  name: string;
  email: string;
  teamName: string;
  remove: FormAction;
}): ReactNode {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { pending, submit } = useAction(remove);
  const succeeded = useRef(false);
  useEffect(
    () => () => {
      if (succeeded.current) setTimeout(focusHeadingIfLost);
    },
    [],
  );

  return (
    <>
      <Menu
        label={`Actions for ${email}`}
        icon={<Ellipsis />}
        items={[{ id: "remove", label: "Remove from team", danger: true }]}
        onSelect={() => {
          setFailed(null); // a reopened dialog starts without the last refusal
          setAsking(true);
        }}
      />
      <ConfirmDialog
        title="Remove from team"
        question={`Remove ${name || email} from ${teamName}? They'll lose access to its projects.`}
        confirmLabel="Remove"
        open={asking}
        pending={pending}
        error={failed}
        onConfirm={() =>
          submit(withUser(userId), {
            onStart: () => setFailed(null),
            onSuccess: () => {
              succeeded.current = true;
              setAsking(false);
            },
            onFailure: setFailed,
          })
        }
        onClose={() => setAsking(false)}
      />
    </>
  );
}

// Leave team, on the person's own row. It asks first; once they have left, the action takes them to their own space.
export function LeaveTeam({ teamName, leave }: { teamName: string; leave: () => Promise<ActionResult> }): ReactNode {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { pending, submit } = useAction(() => leave());

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setFailed(null);
          setAsking(true);
        }}
      >
        Leave team
      </Button>
      <ConfirmDialog
        title={`Leave ${teamName}?`}
        question="You'll lose access to its projects."
        confirmLabel="Leave team"
        open={asking}
        pending={pending}
        error={failed}
        onConfirm={() => submit(new FormData(), { onStart: () => setFailed(null), onFailure: setFailed })}
        onClose={() => setAsking(false)}
      />
    </>
  );
}

function focusHeadingIfLost() {
  const active = document.activeElement;
  if (active !== null && active !== document.body && active.isConnected) return;
  document.getElementById(MEMBERS_HEADING_ID)?.focus();
}
