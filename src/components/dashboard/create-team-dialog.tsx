"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { TextInput } from "@/components/ui/text-input";
import { LIMITS } from "@/lib/limits";
import type { TeamFormState } from "@/lib/spaces/team-actions";

export type CreateTeamDialogProps = {
  open: boolean;
  action(formData: FormData): Promise<TeamFormState>;
  onClose(): void;
};

// Asks for a new team's name. Once it is made, the person goes to the team's storage settings to choose where its
// videos go. The form is mounted afresh at each opening, so it starts empty with no old message.
export function CreateTeamDialog(props: CreateTeamDialogProps): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <CreateTeam key={openings} {...props} />;
}

function CreateTeam({ open, action, onClose }: CreateTeamDialogProps): ReactNode {
  const formId = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const { error, pending, submit } = useAction(async (formData) => {
    const result = await action(formData);
    if (result.slug) {
      onClose();
      router.push(`/s/${result.slug}/settings/storage?first=1`);
    }
    return result;
  });

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData();
    formData.set("name", name);
    submit(formData);
  }

  return (
    <Dialog
      title="Create a team"
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
          <Button variant="primary" type="submit" form={formId} disabled={pending || name.trim() === ""}>
            Create
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={send}>
        <Field label="Team name">
          <TextInput data-autofocus maxLength={LIMITS.teamNameChars} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
