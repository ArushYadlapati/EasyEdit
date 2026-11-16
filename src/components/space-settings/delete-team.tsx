"use client";

import { useId, useState, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import type { ActionResult } from "@/lib/spaces/member-actions";

// The foot of an admin's Members tab: Delete team. The dialog asks for the team's name, and its button stays off until
// it is typed exactly. Once the team is gone the action takes the person to the dashboard.
export function DeleteTeam({ teamName, deleteTeam }: { teamName: string; deleteTeam: (formData: FormData) => Promise<ActionResult> }): ReactNode {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const { pending, submit } = useAction(deleteTeam);
  const fieldId = useId();

  function close() {
    setAsking(false);
    setTyped("");
  }

  return (
    <section aria-labelledby="delete-team-heading" className="flex flex-col gap-2 border-t border-ed-line pt-4">
      <h3 id="delete-team-heading" className="text-sm font-semibold">
        Delete team
      </h3>
      <p className="text-[13px] text-ed-muted">
        This removes {teamName} and everyone&apos;s access to it. Delete its projects first. Its videos stay in the team&apos;s Google Drive folder.
      </p>
      <div>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setFailed(null);
            setAsking(true);
          }}
        >
          Delete team
        </Button>
      </div>
      <ConfirmDialog
        title={`Delete ${teamName}?`}
        question="Everyone loses access to the team, and pending invites stop working. You can't undo this. Delete the team's projects first. Its videos stay in the Google Drive folder."
        confirmLabel="Delete team"
        open={asking}
        pending={pending}
        error={failed}
        confirmDisabled={typed.trim() !== teamName}
        onConfirm={() => {
          const formData = new FormData();
          formData.set("confirmName", typed);
          submit(formData, { onStart: () => setFailed(null), onFailure: setFailed });
        }}
        onClose={close}
      >
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-xs text-ed-muted">
            Type {teamName} to confirm
          </label>
          <TextInput id={fieldId} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
        </div>
      </ConfirmDialog>
    </section>
  );
}
