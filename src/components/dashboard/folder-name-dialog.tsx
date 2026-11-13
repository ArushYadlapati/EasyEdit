"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { TextInput } from "@/components/ui/text-input";
import { LIMITS } from "@/lib/limits";
import type { FormState } from "@/lib/projects/dashboard-actions";

export type FolderNameDialogProps = {
  open: boolean;
  title: string;
  submitLabel: string;
  initial: string; // the name the field starts with
  folderId?: string; // the folder being renamed, sent as id; none for a new folder
  action(formData: FormData): Promise<FormState>;
  onClose(): void;
};

// Asks for a folder's name, for New folder and Rename folder. It sends the name (and the folder's id when one is
// given) and closes once that went through; a refusal, such as a name already taken, shows in the dialog. Each
// opening starts from the initial name with no old message: the form below is mounted afresh each time the dialog
// opens, and the dialog stays in place while closed so it can hand focus back.
export function FolderNameDialog(props: FolderNameDialogProps): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <FolderName key={openings} {...props} />;
}

function FolderName({ open, title, submitLabel, initial, folderId, action, onClose }: FolderNameDialogProps): ReactNode {
  const formId = useId();
  const [name, setName] = useState(initial);
  const { error, pending, submit } = useAction(action);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData();
    if (folderId !== undefined) formData.set("id", folderId);
    formData.set("name", name);
    submit(formData, { onSuccess: onClose });
  }

  return (
    <Dialog
      title={title}
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
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={send}>
        <Field label="Name">
          <TextInput data-autofocus maxLength={LIMITS.folderNameChars} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
