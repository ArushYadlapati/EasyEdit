"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { templateFormatLine } from "@/components/dashboard/template-picker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { LIMITS } from "@/lib/limits";
import { TemplateApiError, deleteTemplate, getTemplate, updateTemplate } from "@/lib/templates/client";
import type { TemplateSummary } from "@/lib/templates/types";

const FAILED = "That did not work. Try again.";
const message = (error: unknown) => (error instanceof TemplateApiError ? error.message : FAILED);

// A space's templates: starters first, then the ones saved here. Editors and admins can edit and delete saved ones.
export function TemplatesPage({ spaceId, canEdit, templates }: { spaceId: string; canEdit: boolean; templates: readonly TemplateSummary[] }): ReactNode {
  const router = useRouter();
  const [editing, setEditing] = useState<TemplateSummary | null>(null);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const ordered = [...templates.filter((t) => t.builtIn), ...templates.filter((t) => !t.builtIn)];
  const saved = templates.some((t) => !t.builtIn);

  async function remove() {
    if (!deleting || pending) return;
    setPending(true);
    setDeleteError(null);
    try {
      await deleteTemplate(spaceId, deleting.id);
      setDeleting(null);
      router.refresh();
    } catch (error) {
      setDeleteError(message(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="text-[13px] leading-5 text-ed-muted">
        Templates are projects with slots to fill. Start a project from one in New project, or ask Claude to fill one.
      </p>
      <ul className="flex flex-col gap-2">
        {ordered.map((template) => (
          <li key={template.id} className="flex flex-col gap-1 rounded-md border border-ed-line bg-ed-raised px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-[13px] font-medium text-ed-text">{template.name}</span>
              {template.builtIn && <span className="shrink-0 rounded-sm border border-ed-line px-1 text-[10px] leading-4 text-ed-muted">Starter</span>}
              {canEdit && !template.builtIn && (
                <span className="ml-auto flex shrink-0 gap-1">
                  <Button onClick={() => setEditing(template)}>Edit</Button>
                  <Button
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(template);
                    }}
                  >
                    Delete
                  </Button>
                </span>
              )}
            </div>
            <p className="text-xs text-ed-muted tabular-nums">{templateFormatLine(template)}</p>
            {template.slots.length > 0 && <p className="text-xs text-ed-muted">{`Slots: ${template.slots.map((s) => s.name).join(", ")}`}</p>}
            {template.description && <p className="text-xs text-ed-text">{template.description}</p>}
          </li>
        ))}
      </ul>
      {!saved && (
        <p className="text-[13px] leading-5 text-ed-muted">
          You have not saved a template yet. Open a project, mark clips as slots in the inspector, then choose Save as template.
        </p>
      )}
      {editing && (
        <EditTemplate
          key={editing.id}
          spaceId={spaceId}
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        title={`Delete ${deleting?.name ?? ""}?`}
        question="Projects made from it stay as they are."
        confirmLabel="Delete"
        open={deleting !== null}
        pending={pending}
        error={deleteError}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function EditTemplate({ spaceId, template, onClose, onSaved }: { spaceId: string; template: TemplateSummary; onClose(): void; onSaved(): void }): ReactNode {
  const formId = useId();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [instructions, setInstructions] = useState<string | null>(null); // null while they load, and if they did not
  const [edited, setEdited] = useState(false); // the notes are sent only once the person changed them
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    getTemplate(spaceId, template.id).then(
      (full) => live && setInstructions(full.instructions),
      () => {
        if (!live) return;
        setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [spaceId, template.id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (instructions === null && !loadFailed)) return;
    setPending(true);
    setError(null);
    try {
      await updateTemplate(spaceId, template.id, {
        name,
        description,
        ...(edited && instructions !== null ? { instructions } : {}),
      });
      onSaved();
    } catch (e) {
      setError(message(e));
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Edit template"
      open
      onClose={onClose}
      footer={
        <>
          {(error ?? (loadFailed ? "Couldn't load the notes for Claude. Try again." : null)) && (
            <p role="alert" className="mr-auto min-w-0 text-xs text-ed-danger">
              {error ?? "Couldn't load the notes for Claude. Try again."}
            </p>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending || (instructions === null && !loadFailed)}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
        <Field label="Name">
          <TextInput data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Description">
          <TextArea rows={3} maxLength={LIMITS.templateDescriptionChars} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Notes for Claude" hint="Claude reads these when it fills the template.">
          <TextArea
            rows={5}
            maxLength={LIMITS.templateInstructionsChars}
            disabled={instructions === null}
            value={instructions ?? ""}
            onChange={(event) => {
              setInstructions(event.target.value);
              setEdited(true);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}
