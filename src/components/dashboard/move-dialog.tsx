"use client";

import { useId, useState, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { Button } from "@/components/ui/button";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { PROJECT_GONE, type DashboardFolder } from "@/lib/dashboard/view";
import type { FormState } from "@/lib/projects/dashboard-actions";

export type MoveToFolderDialogProps = {
  open: boolean;
  project: { id: string; name: string; folderId: string | null };
  folders: readonly DashboardFolder[];
  action(formData: FormData): Promise<FormState>;
  onClose(): void;
  onGone?(message: string): void; // the project was deleted elsewhere, so this dialog is leaving the page with its card
};

const NO_FOLDER = ""; // the choice, and the folderId sent, for no folder

// Moves a project into a folder, or out of the one it is in: the keyboard's way to do what a drag does. Each opening
// starts from the project's current folder: the form below is mounted afresh each time the dialog opens, and the
// dialog stays in place while closed so it can hand focus back.
export function MoveToFolderDialog(props: MoveToFolderDialogProps): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <MoveToFolder key={openings} {...props} />;
}

function MoveToFolder({ open, project, folders, action, onClose, onGone }: MoveToFolderDialogProps): ReactNode {
  const name = useId();
  const current = project.folderId ?? NO_FOLDER;
  const [choice, setChoice] = useState(current);
  const { error, pending, submit } = useAction(action);
  const choices = [{ id: NO_FOLDER, name: "No folder" }, ...folders];

  function move() {
    const formData = new FormData();
    formData.set("id", project.id);
    formData.set("folderId", choice);
    submit(formData, {
      onSuccess: onClose,
      onFailure: (message) => {
        if (message === PROJECT_GONE) onGone?.(message);
      },
    });
  }

  return (
    <Dialog
      title="Move to folder"
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
          <Button variant="primary" disabled={pending || choice === current} onClick={move}>
            Move
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Folder" className="flex flex-col gap-0.5">
        {choices.map((folder) => (
          <label
            key={folder.id}
            className="flex h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-ed-text hover:bg-ed-hover"
          >
            <input
              type="radio"
              name={name}
              value={folder.id}
              checked={choice === folder.id}
              data-autofocus={folder.id === current || undefined}
              onChange={() => setChoice(folder.id)}
              className={cx("size-3.5 shrink-0 accent-ed-accent", FOCUS_RING)}
            />
            <span className="truncate">{folder.name}</span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}
