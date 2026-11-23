"use client";

import { ArrowLeftRight } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { startTransition, useActionState, useId, useState, type FormEvent, type ReactNode } from "react";
import { BlankFrame } from "@/components/dashboard/blank-frame";
import { FormatCards } from "@/components/dashboard/format-cards";
import { readDialogUnits, writeDialogUnits } from "@/components/dashboard/units-storage";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { TemplatePicker, templateFormatLine } from "@/components/dashboard/template-picker";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import type { DashboardFolder } from "@/lib/dashboard/view";
import { convertDraft, draftFor, draftPixels, pixelLine, sizeCaption, swapDraft, type SizeDraft } from "@/lib/dashboard/size-draft";
import type { Units } from "@/lib/editor/settings";
import { UNIT_SUFFIX } from "@/lib/editor/units";
import type { TemplateSummary } from "@/lib/templates/types";
import { LIMITS } from "@/lib/limits";
import type { FormState } from "@/lib/projects/dashboard-actions";
import { DEFAULT_FPS, FORMAT_PRESETS, FRAME_RATES, FRAME_SIZE_MESSAGE, formatFor, isFrameSize, type FormatId, type FrameRate, type FrameSize } from "@/lib/timeline";

export type NewProjectDialogProps = {
  open: boolean;
  onClose(): void;
  folders: readonly DashboardFolder[];
  templates?: readonly TemplateSummary[]; // what a project can start from, besides blank
  folderId: string | null; // the folder in view, where the new project goes unless another is picked
  action(prev: FormState, formData: FormData): Promise<FormState>;
};

const NO_TEMPLATES: readonly TemplateSummary[] = [];
const DEFAULT_FORMAT = "short_9x16";
const DEFAULT_SIZE: FrameSize = FORMAT_PRESETS[DEFAULT_FORMAT];
const DEFAULT_NAME = "Untitled project";

const UNIT_OPTIONS: { value: Units; label: string }[] = [
  { value: "px", label: "Pixels" },
  { value: "cm", label: "Centimeters" },
  { value: "in", label: "Inches" },
];

const CAPTION = "text-xs font-medium text-ed-muted";
const SMALL = "text-[11px] leading-4";

// The browser's local storage, looked up on each use, since reaching it can throw where storage is blocked.
const localStore = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

// A size inside the limits, or null.
function fitting(draft: SizeDraft): FrameSize | null {
  const pixels = draftPixels(draft);
  return pixels && isFrameSize(pixels.width, pixels.height) ? pixels : null;
}

// The New project dialog: a name, a format, a size in the dialog's units, a folder, and a blank frame of that
// size that follows every keystroke. Every opening starts from the defaults: the form below is mounted afresh
// each time the dialog opens, and the dialog stays in place while closed so it can hand focus back.
export function NewProjectDialog(props: NewProjectDialogProps): ReactNode {
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpenings(openings + 1);
  }
  return <NewProject key={openings} {...props} />;
}

function NewProject({ open, onClose, folders, templates = NO_TEMPLATES, folderId, action }: NewProjectDialogProps): ReactNode {
  const formId = useId();
  const [state, dispatch, pending] = useActionState(async (prev: FormState, formData: FormData): Promise<FormState> => {
    try {
      return await action(prev, formData);
    } catch (error) {
      unstable_rethrow(error); // a create that went through redirects to the editor, which Next sends as a rejection
      return { error: "Something went wrong. Try again." };
    }
  }, {});
  const [name, setName] = useState(DEFAULT_NAME);
  const [format, setFormat] = useState<FormatId>(DEFAULT_FORMAT);
  const [draft, setDraft] = useState(() => draftFor(DEFAULT_SIZE, readDialogUnits(localStore)));
  const [shown, setShown] = useState(DEFAULT_SIZE); // the last size inside the limits, drawn as the frame
  const [templateId, setTemplateId] = useState<string | null>(null); // null is Blank; the format fields keep their values meanwhile
  const [folder, setFolder] = useState(folderId ?? "");
  const [fps, setFps] = useState<FrameRate>(DEFAULT_FPS); // a project keeps the rate it is made with

  const template = templates.find((t) => t.id === templateId) ?? null;
  const size = fitting(draft);
  const pixels = draftPixels(draft);

  function changeDraft(next: SizeDraft): FrameSize | null {
    setDraft(next);
    const fits = fitting(next);
    if (fits) setShown(fits);
    return fits;
  }

  // A typed or swapped size is the named size it equals, else a custom one.
  function changeSize(next: SizeDraft) {
    const fits = changeDraft(next);
    setFormat(fits ? formatFor(fits.width, fits.height) : "custom");
  }

  function pickFormat(next: FormatId) {
    setFormat(next);
    if (next !== "custom") changeDraft(draftFor(FORMAT_PRESETS[next], draft.units));
  }

  function pickUnits(units: Units) {
    changeDraft(convertDraft(draft, units));
    writeDialogUnits(localStore, units);
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!size && !template) || pending) return;
    const formData = new FormData();
    formData.set("name", name);
    if (template) {
      formData.set("templateId", template.id);
    } else if (size) {
      formData.set("format", format);
    }
    if (!template && size && format === "custom") {
      formData.set("width", String(size.width));
      formData.set("height", String(size.height));
    }
    if (!template) formData.set("fps", String(fps));
    formData.set("folderId", folder);
    startTransition(() => dispatch(formData));
  }

  const side = (label: string, key: keyof FrameSize) => (
    <Field label={label}>
      <span className="relative flex min-w-0">
        <TextInput
          inputMode="decimal"
          autoComplete="off"
          className="pr-7 tabular-nums"
          value={draft[key]}
          onChange={(event) => changeSize({ ...draft, [key]: event.target.value })}
        />
        <span aria-hidden className="pointer-events-none absolute top-1.5 right-2 text-xs text-ed-muted">
          {UNIT_SUFFIX[draft.units]}
        </span>
      </span>
    </Field>
  );

  return (
    <Dialog
      title="New project"
      size="lg"
      open={open}
      onClose={onClose}
      footer={
        <>
          {state.error && (
            <p role="alert" className="mr-auto min-w-0 text-xs text-ed-danger">
              {state.error}
            </p>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={(!size && !template) || pending}>
            Create project
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 md:grid md:h-full md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-6 md:overflow-hidden">
        <form id={formId} onSubmit={create} className="flex flex-col gap-5 md:overflow-y-auto md:px-1">
          <Field label="Name">
            <TextInput data-autofocus maxLength={LIMITS.projectNameChars} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>

          {templates.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className={CAPTION}>Start from</span>
              <TemplatePicker templates={templates} value={templateId} onChange={setTemplateId} />
            </div>
          )}

          {template ? (
            <div className="flex flex-col gap-1">
              <span className={CAPTION}>Format</span>
              <p className="text-[13px] text-ed-text tabular-nums">{templateFormatLine(template)}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className={CAPTION}>Format</span>
                <FormatCards value={format} onChange={pickFormat} />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={CAPTION}>Size</span>
                  <Segmented label="Units" value={draft.units} options={UNIT_OPTIONS} onChange={pickUnits} className="w-full sm:w-72" />
                </div>
                <p className={`${SMALL} text-ed-muted`}>Centimeters and inches count 96 pixels to the inch.</p>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
                  {side("Width", "width")}
                  <IconButton label="Swap width and height" onClick={() => changeSize(swapDraft(draft))}>
                    <ArrowLeftRight />
                  </IconButton>
                  {side("Height", "height")}
                </div>
                {draft.units !== "px" && pixels && <p className={`${SMALL} text-ed-muted tabular-nums`}>{pixelLine(pixels)}</p>}
                {!size && (
                  <p role="alert" className={`${SMALL} text-ed-danger`}>
                    {FRAME_SIZE_MESSAGE}
                  </p>
                )}
              </div>
            </>
          )}

          <Field label="Folder">
            <Select value={folder} onChange={(event) => setFolder(event.target.value)}>
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>

          {template ? (
            // A template brings its own frame rate.
            <div className="flex flex-col gap-1">
              <span className={CAPTION}>Frame rate</span>
              <p className="text-[13px] text-ed-text">Set by the template</p>
            </div>
          ) : (
            <Field label="Frame rate">
              <Select value={String(fps)} onChange={(event) => setFps(Number(event.target.value) as FrameRate)}>
                {FRAME_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {`${rate} fps`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form>

        <div className="flex h-56 flex-col gap-3 rounded-md bg-ed-raised p-6 md:h-full md:min-h-0">
          <BlankFrame width={template?.width ?? shown.width} height={template?.height ?? shown.height} className="min-h-0 flex-1" />
          <p className="shrink-0 text-center text-xs text-ed-muted tabular-nums">{template ? templateFormatLine(template) : sizeCaption(shown, draft.units)}</p>
        </div>
      </div>
    </Dialog>
  );
}
