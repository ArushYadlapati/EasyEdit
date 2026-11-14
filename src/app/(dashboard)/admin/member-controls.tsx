"use client";

import { ChevronDown, Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { Menu, type MenuItem } from "@/components/ui/menu";
import type { Role } from "@/lib/allowlist/service";
import { disconnectClaudeAction, removeMemberAction, setRoleAction } from "./actions";
import { MEMBERS_HEADING_ID } from "./ids";
import { ROLE_CHOICES } from "./roles";

const withEmail = (email: string, more: Record<string, string> = {}) => {
  const formData = new FormData();
  formData.set("email", email);
  for (const [key, value] of Object.entries(more)) formData.set(key, value);
  return formData;
};

// A member's role, changed in place. A native select, so the option list, typing to jump and screen readers work as
// usual, but with no box until it is hovered or focused, so a column of them reads as text. The picked role shows at
// once and goes back to the saved one if the change is refused.
export function RoleSelect({ email, role }: { email: string; role: Role }): ReactNode {
  const { error, pending, submit } = useAction(setRoleAction);
  const [value, setValue] = useState<Role>(role);
  // A new role from the server, after a change here or elsewhere, replaces what is shown.
  const [syncedRole, setSyncedRole] = useState<Role>(role);
  if (role !== syncedRole) {
    setSyncedRole(role);
    setValue(role);
  }

  function change(next: Role) {
    if (pending) return; // one change at a time; the select stays as it was
    setValue(next);
    submit(withEmail(email, { role: next }), { onFailure: () => setValue(role) });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="relative inline-flex">
        <select
          aria-label={`Role for ${email}`}
          value={value}
          // Held, not disabled, while saving: a disabled select drops keyboard focus, and the arrow keys change a
          // closed select at once on Windows, so the person would be thrown back to the top of the page.
          aria-disabled={pending || undefined}
          // The options are ROLE_CHOICES, so the value is always one of their roles.
          onChange={(event) => change(event.target.value as Role)}
          className={cx(
            "peer h-7 appearance-none rounded-md border border-transparent bg-transparent pr-7 pl-2 text-[13px] leading-5 text-ed-text",
            "not-aria-disabled:hover:bg-ed-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
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
          className="pointer-events-none absolute top-1.5 right-1.5 text-ed-muted peer-aria-disabled:opacity-40"
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

type Ask = "disconnect" | "remove";

// What each dialog says. Kept true to what the actions do: removing deletes the membership, signs the person out
// everywhere and ends their Claude connection, and sign-in checks membership, so they stay out until added again.
// Disconnecting ends only the Claude connection; the website sign-in stays.
function copy(ask: Ask, email: string, claudeConnected: boolean) {
  if (ask === "disconnect") {
    return {
      title: "Disconnect Claude",
      question: `Disconnect Claude for ${email}? Claude stops working with EasyEdit for them until they connect it again. They stay signed in to EasyEdit.`,
      confirmLabel: "Disconnect",
    };
  }
  return {
    title: "Remove member",
    question: `Remove ${email}? They're signed out of EasyEdit right away and can't sign back in unless you add them again.${
      claudeConnected ? " Their Claude connection ends too." : ""
    }`,
    confirmLabel: "Remove",
  };
}

// A member's ⋯ menu: Disconnect Claude when they have connected it, and Remove member for anyone but the signed-in
// admin, who can't remove themselves. Each asks first in a dialog that shows a refusal and stays open, and closes once
// the action went through. With nothing to offer, there is no menu.
export function MemberActions({
  email,
  claudeConnected,
  isSelf,
}: {
  email: string;
  claudeConnected: boolean;
  isSelf: boolean;
}): ReactNode {
  const [asking, setAsking] = useState<Ask | null>(null);
  // Tagged with its dialog, so a refusal that comes back after the person moved on is not shown in the other one.
  const [failed, setFailed] = useState<{ ask: Ask; message: string } | null>(null);
  const actions = { disconnect: useAction(disconnectClaudeAction), remove: useAction(removeMemberAction) };

  const items: MenuItem[] = [];
  if (claudeConnected) items.push({ id: "disconnect", label: "Disconnect Claude" });
  if (!isSelf) items.push({ id: "remove", label: "Remove member", danger: true, separatorBefore: claudeConnected });
  const empty = items.length === 0;

  // After an action goes through, the menu that would take focus back can vanish: a removed member's row is gone,
  // and disconnecting your own Claude leaves your row with nothing to offer. Focus then goes to the page heading
  // rather than the top of the document.
  const succeeded = useRef(false);
  useEffect(() => {
    if (empty && succeeded.current) focusHeadingIfLost();
  }, [empty]);
  useEffect(
    () => () => {
      if (succeeded.current) setTimeout(focusHeadingIfLost);
    },
    [],
  );

  if (empty) return null;

  function choose(id: string) {
    if (id !== "disconnect" && id !== "remove") return;
    setFailed(null); // a reopened dialog starts without the last refusal
    setAsking(id);
  }

  function confirm(ask: Ask) {
    actions[ask].submit(withEmail(email), {
      onStart: () => setFailed(null),
      // Only closes the dialog it was sent from, in case the person cancelled and opened the other one meanwhile.
      onSuccess: () => {
        succeeded.current = true;
        setAsking((now) => (now === ask ? null : now));
      },
      onFailure: (message) => setFailed({ ask, message }),
    });
  }

  // Closed, the dialog draws nothing, so its words only matter while it is open.
  const shown = asking ?? "remove";
  return (
    <>
      <Menu label={`Actions for ${email}`} icon={<Ellipsis />} items={items} onSelect={choose} />
      <ConfirmDialog
        {...copy(shown, email, claudeConnected)}
        open={asking !== null}
        pending={actions[shown].pending}
        error={failed !== null && failed.ask === asking ? failed.message : null}
        onConfirm={() => confirm(shown)}
        onClose={() => setAsking(null)}
      />
    </>
  );
}

function focusHeadingIfLost() {
  const active = document.activeElement;
  if (active !== null && active !== document.body && active.isConnected) return;
  document.getElementById(MEMBERS_HEADING_ID)?.focus();
}
