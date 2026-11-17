"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { LIMITS } from "@/lib/limits";
import { settingsTabPath } from "@/lib/spaces/settings-tabs";
import { TemplateApiError, saveTemplate } from "@/lib/templates/client";
import { useEditorStore } from "./context";
import type { EditorStore } from "@/lib/editor/store";

const SAVE_WAIT_MS = 10_000;
export const NOT_SAVED = "Your latest changes aren't saved yet. Try again in a moment.";

// Resolves true once the project's queued edits are all saved, false when they cannot be (offline, signed out, a save
// that stays stuck past the cap), so a template is made from what the person sees.
export function whenSaved(store: EditorStore): Promise<boolean> {
  const settled = (s: ReturnType<EditorStore["getState"]>) => s.queue.length === 0;
  if (settled(store.getState())) return Promise.resolve(true);
  const stuck = (s: ReturnType<EditorStore["getState"]>) => s.status !== "saving" && s.status !== "saved";
  return new Promise((resolve) => {
    const end = (ok: boolean) => {
      unsubscribe();
      clearTimeout(timer);
      resolve(ok);
    };
    const check = (s: ReturnType<EditorStore["getState"]>) => {
      if (settled(s)) end(true);
      else if (stuck(s)) end(false);
    };
    const unsubscribe = store.subscribe(check);
    const timer = setTimeout(() => end(settled(store.getState())), SAVE_WAIT_MS);
    check(store.getState());
  });
}

type Props = { open: boolean; onClose(): void; spaceId: string; spaceSlug: string };

// Asks for a template's name, description and notes for Claude, then saves the project as a template of its space.
// Each opening starts afresh: the form is mounted anew, and the dialog stays in place while closed.
export function SaveTemplateDialog(props: Props): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <SaveTemplateForm key={openings} {...props} />;
}

function SaveTemplateForm({ open, onClose, spaceId, spaceSlug }: Props): ReactNode {
  const store = useEditorStore();
  const formId = useId();
  const [name, setName] = useState(() => store.getState().name);
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clash, setClash] = useState(false);
  const [pending, setPending] = useState(false);

  async function send(replace: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    setClash(false);
    try {
      if (!(await whenSaved(store))) {
        setError(NOT_SAVED);
        return;
      }
      const input = {
        projectId: store.getState().projectId,
        name: name.trim(),
        ...(description.trim() !== "" && { description: description.trim() }),
        ...(instructions.trim() !== "" && { instructions: instructions.trim() }),
        ...(replace && { replace: true }),
      };
      await saveTemplate(spaceId, input);
      onClose();
      store.getState().notify("info", `Saved “${input.name}” as a template.`, { label: "See templates", href: settingsTabPath(spaceSlug, "templates") });
    } catch (err) {
      if (err instanceof TemplateApiError) {
        setError(err.message);
        setClash(err.code === "CONFLICT");
      } else setError("That did not work. Try again.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(false);
  }

  return (
    <Dialog
      title="Save as template"
      open={open}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mr-auto min-w-0 text-xs text-ed-danger">
              {error}
            </p>
          )}
          {clash && (
            <Button disabled={pending} onClick={() => void send(true)}>
              Replace it
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending || name.trim() === ""}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name">
          <TextInput data-autofocus maxLength={LIMITS.projectNameChars} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Description">
          <TextInput maxLength={LIMITS.templateDescriptionChars} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Notes for Claude" hint="Claude reads these when it fills the template.">
          <TextArea rows={4} maxLength={LIMITS.templateInstructionsChars} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
