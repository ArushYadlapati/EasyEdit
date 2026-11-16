"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useAction } from "@/app/(app)/action-ui";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/text-input";
import type { RenameResult } from "@/lib/spaces/member-actions";

// An admin's Members tab, above Delete team: the team's name, editable. The address stays as it was.
export function RenameTeam({ teamName, rename }: { teamName: string; rename: (formData: FormData) => Promise<RenameResult> }): ReactNode {
  const [value, setValue] = useState(teamName);
  const [failed, setFailed] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [edited, setEdited] = useState(false);
  const [seenName, setSeenName] = useState(teamName);
  // The name changed under us (revalidated page): follow it unless the person is mid-edit.
  if (seenName !== teamName) {
    setSeenName(teamName);
    if (!edited) setValue(teamName);
  }
  const { pending, submit } = useAction(rename);
  const fieldId = useId();
  const errorId = useId();
  const trimmed = value.trim();

  function save(event: FormEvent) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("name", trimmed);
    submit(formData, { onStart: () => {
        setFailed(null);
        setSaved(false);
      },
      onSuccess: (result) => {
        // The server tidies the name (inner spaces, hidden characters), so the field shows what was saved.
        setValue(result.name ?? trimmed);
        setEdited(false);
        setSaved(true);
      },
      onFailure: setFailed,
    });
  }

  return (
    <section aria-labelledby="rename-team-heading" className="flex flex-col gap-2 border-t border-ed-line pt-4">
      <h3 id="rename-team-heading" className="text-sm font-semibold">
        Team name
      </h3>
      <form onSubmit={save} className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="sr-only">
          Team name
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            id={fieldId}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setEdited(true);
              setSaved(false);
            }}
            autoComplete="off"
            aria-describedby={failed ? errorId : undefined}
            className="min-w-0 flex-1 sm:max-w-xs"
          />
          <Button type="submit" size="sm" disabled={pending || saved || trimmed === teamName}>
            Save
          </Button>
        </div>
        {saved && (
          <p role="status" className="text-[13px] text-ed-muted">
            Saved
          </p>
        )}
        {failed && (
          <p id={errorId} role="alert" className="text-[13px] text-ed-danger">
            {failed}
          </p>
        )}
      </form>
    </section>
  );
}
