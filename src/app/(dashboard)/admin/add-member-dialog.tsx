"use client";

import { UserPlus } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import type { Role } from "@/lib/allowlist/service";
import { addMemberAction } from "./actions";
import { ROLE_CHOICES, roleChoice } from "./roles";

const DEFAULT_ROLE: Role = "editor";

// The Add member button at the top of the members page, and the dialog it opens. Each opening starts from an
// empty form with no old message: the form below is mounted afresh each time the button opens it, and the
// dialog stays in place while closed so it can hand focus back to the button.
export function AddMemberButton(): ReactNode {
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
      <AddMemberDialog key={openings} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Asks for an email and a role, and closes once the member is added; the table refreshes from the server. A
// refusal, such as an email that is already a member, shows in the dialog. The hint under Role says what the
// chosen role can do.
function AddMemberDialog({ open, onClose }: { open: boolean; onClose(): void }): ReactNode {
  const formId = useId();
  const hintId = useId();
  // Only drives the hint: the role that is sent is read from the form.
  const [role, setRole] = useState<string>(DEFAULT_ROLE);
  const { error, pending, submit } = useAction(addMemberAction);

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
            Add member
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={send} className="flex flex-col gap-4">
        <Field label="Email">
          <TextInput type="email" name="email" required data-autofocus autoComplete="off" spellCheck={false} />
        </Field>
        {/* The hint is drawn here rather than by Field, so the select can point screen readers at it: it is the only
            text that says what each role can do. */}
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
