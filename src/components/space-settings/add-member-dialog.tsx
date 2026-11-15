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
import type { ActionResult } from "@/lib/spaces/member-actions";

type AddAction = (formData: FormData) => Promise<ActionResult>;

const DEFAULT_ROLE: Role = "editor";

// The Add member button on a team's Members page, for its admins, and the dialog it opens. Each opening starts from an
// empty form with no old message: the form is mounted afresh each time, and the dialog stays in place while closed so
// it can hand focus back to the button.
export function AddMemberButton({ add }: { add: AddAction }): ReactNode {
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
        Add member
      </Button>
      <AddMemberDialog key={openings} open={open} add={add} onClose={() => setOpen(false)} />
    </>
  );
}

// Asks for the email of someone who already has an account, and a role. It closes once they are added, and the table
// refreshes from the server. A refusal, such as an email no account uses, shows in the dialog.
function AddMemberDialog({ open, add, onClose }: { open: boolean; add: AddAction; onClose(): void }): ReactNode {
  const formId = useId();
  const hintId = useId();
  // Only drives the hint: the role that is sent is read from the form.
  const [role, setRole] = useState<string>(DEFAULT_ROLE);
  const { error, pending, submit } = useAction(add);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    submit(new FormData(event.currentTarget), { onSuccess: onClose });
  }

  return (
    <Dialog
      title="Add member"
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
            Add
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={send} className="flex flex-col gap-4">
        <Field label="Email" hint="They need to have signed in to EasyEdit at least once.">
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
