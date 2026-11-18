"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BlankFrame } from "@/components/dashboard/blank-frame";
import { FormatCards } from "@/components/dashboard/format-cards";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextInput } from "@/components/ui/text-input";
import { LIMITS } from "@/lib/limits";
import { DEFAULT_FPS, FORMAT_PRESETS, FRAME_SIZE_MESSAGE, isFrameSize, type FormatId, type FrameSize } from "@/lib/timeline";

// The dashboard's New project dialog (components/dashboard/new-project-dialog.tsx) made simpler for the home page:
// the same Name field, format cards and blank frame, with sizes in pixels only and no folder. Nothing is created
// here; Create project goes to sign in, where the real dialog waits on the dashboard.

const DEFAULT_FORMAT = "short_9x16" satisfies FormatId;

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("My first video");
  const [format, setFormat] = useState<FormatId>(DEFAULT_FORMAT);
  const [custom, setCustom] = useState({ width: "1080", height: "1080" });

  const typed = { width: Number(custom.width), height: Number(custom.height) };
  const customFits = Number.isInteger(typed.width) && Number.isInteger(typed.height) && isFrameSize(typed.width, typed.height);
  const size: FrameSize | null = format !== "custom" ? FORMAT_PRESETS[format] : customFits ? typed : null;
  const [shown, setShown] = useState<FrameSize>(FORMAT_PRESETS[DEFAULT_FORMAT]); // the last size that fits, drawn
  if (size && (size.width !== shown.width || size.height !== shown.height)) setShown(size);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (size) router.push("/login");
  }

  return (
    <form data-ui onSubmit={create} className="h-np ed-theme" aria-label="New project">
      <div className="h-npHead">
        <p className="h-npTitle">New project</p>
      </div>
      <div className="h-npBody">
        <div className="h-npFields">
          <Field label="Name">
            <TextInput maxLength={LIMITS.projectNameChars} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ed-muted">Format</span>
            <FormatCards value={format} onChange={setFormat} />
          </div>
          {format === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width (px)">
                <TextInput
                  inputMode="numeric"
                  className="tabular-nums"
                  value={custom.width}
                  onChange={(e) => setCustom({ ...custom, width: e.target.value })}
                />
              </Field>
              <Field label="Height (px)">
                <TextInput
                  inputMode="numeric"
                  className="tabular-nums"
                  value={custom.height}
                  onChange={(e) => setCustom({ ...custom, height: e.target.value })}
                />
              </Field>
            </div>
          )}
          {format === "custom" && !customFits && (
            <p role="alert" className="text-[11px] leading-4 text-ed-danger">
              {FRAME_SIZE_MESSAGE}
            </p>
          )}
        </div>
        <div className="h-npPreview">
          <BlankFrame width={shown.width} height={shown.height} className="min-h-0">
            <span className="h-npName" style={{ aspectRatio: `${shown.width} / ${shown.height}` }}>
              {name.trim() || "Untitled project"}
            </span>
          </BlankFrame>
          <p className="text-center text-xs text-ed-muted tabular-nums">
            {shown.width} × {shown.height} px · {DEFAULT_FPS} fps
          </p>
        </div>
      </div>
      <div className="h-npFoot">
        <Button variant="primary" type="submit" disabled={!size}>
          Create project
        </Button>
      </div>
    </form>
  );
}
