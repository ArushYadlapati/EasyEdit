"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export type ConfirmDialogProps = {
  title: string;
  question: string;
  confirmLabel: string;
  open: boolean;
  pending: boolean; // the confirmed action is running, so it cannot be sent twice
  error: string | null; // why the action was refused, shown in the dialog, which stays open
  onConfirm(): void;
  onClose(): void;
};

// Asks before something that cannot be taken back from the page, such as a delete. Focus starts on Cancel, so
// Enter on opening does nothing harmful; the caller sends the action and closes the dialog once it went through.
export function ConfirmDialog({ title, question, confirmLabel, open, pending, error, onConfirm, onClose }: ConfirmDialogProps): ReactNode {
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
          <Button data-autofocus onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{question}</p>
    </Dialog>
  );
}
