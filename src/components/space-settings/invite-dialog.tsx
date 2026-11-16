"use client";

import { UserPlus } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ROLE_CHOICES, roleChoice } from "@/app/(dashboard)/admin/roles";
import { useAction } from "@/app/(app)/action-ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import type { Role } from "@/lib/allowlist/service";
import type { InviteResult } from "@/lib/spaces/member-actions";
import { CopyLinkButton } from "./copy-link-button";

type InviteAction = (formData: FormData) => Promise<InviteResult>;

const DEFAULT_ROLE: Role = "editor";

// The Invite button on a team's Members page, for its admins, and the dialog it opens. Each opening starts from an
// empty form with no old message or link: the dialog's contents are mounted afresh each time, and the dialog stays in
// place while closed so it can hand focus back to the button.
export function InviteButton({ invite }: { invite: InviteAction }): ReactNode {
  const [open, setOpen] = useState(false);
  const [openings, setOpenings] = useState(0);

  function show() {
    setOpenings(openings + 1);
    setOpen(true);
  }

  return (
    <>
      <Button variant="primary" onClick={show}>
        <UserPlus aria-hidden />
        Invite
      </Button>
      <InviteDialog key={openings} open={open} invite={invite} onClose={() => setOpen(false)} />
    </>
  );
}

// Asks for an email and a role. Once the invite is made the dialog shows its link to copy and send; the table refreshes
// from the server. A refusal shows in the dialog.
function InviteDialog({ open, invite, onClose }: { open: boolean; invite: InviteAction; onClose(): void }): ReactNode {
  const formId = useId();
  const hintId = useId();
  // Only drives the hint: the role that is sent is read from the form.
  const [role, setRole] = useState<string>(DEFAULT_ROLE);
  const [link, setLink] = useState<string | null>(null);
  const { error, pending, submit } = useAction(invite);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    submit(new FormData(event.currentTarget), { onSuccess: (result) => setLink(result.link ?? null) });
  }

  if (link !== null) {
    return (
      <Dialog
        title="Invite someone"
        open={open}
        onClose={onClose}
        footer={
          <>
            <CopyLinkButton link={link} />
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>Send them this link. It works for 7 days.</p>
          <TextInput readOnly value={link} aria-label="Invite link" onFocus={(event) => event.currentTarget.select()} />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Invite someone"
      open={open}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mr-auto min-w-0 text-xs text-ed-danger">
              {error}
            </p>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending}>
            Create invite
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={send} className="flex flex-col gap-4">
        <Field label="Email" hint="They'll join once they accept. You'll get a link to send them.">
          <TextInput type="email" name="email" required data-autofocus autoComplete="off" spellCheck={false} />
        </Field>
        {/* The hint is drawn here rather than by Field, so the select can point screen readers at it. */}
        <div className="flex flex-col gap-1">
          <Field label="Role">
            <Select name="role" value={role} aria-describedby={hintId} onChange={(event) => setRole(event.target.value)}>
              {ROLE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </Field>
          <p id={hintId} className="text-[11px] leading-4 text-ed-muted">
            {roleChoice(role)?.hint}
          </p>
        </div>
      </form>
    </Dialog>
  );
}
