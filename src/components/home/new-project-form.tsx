"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BlankFrame } from "@/components/dashboard/blank-frame";
import { FormatCards } from "@/components/dashboard/format-cards";
import { Field } from "@/components/ui/field";
import { TextInput } from "@/components/ui/text-input";
import { LIMITS } from "@/lib/limits";
import { DEFAULT_FPS, FORMAT_PRESETS, FRAME_SIZE_MESSAGE, isFrameSize, type FormatId, type FrameSize } from "@/lib/timeline";

// The dashboard's New project dialog (components/dashboard/new-project-dialog.tsx) made simpler for the home page:
// the same Name field, format cards and blank frame, with sizes in pixels only and no folder, set at the page's own
// sizes (home.css). The frame shows a still of real footage in the chosen shape, with the name on it as the project's
// title: a text clip with your selection round it, as the editor draws it. Nothing is created here; Create project
// goes to sign in, where the real dialog waits on the dashboard.

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

  // The fields come first for the keyboard and on a phone; on a computer the picture sits on the left and the fields,
  // then Create project, on the right.
  return (
    <form data-ui onSubmit={create} className="h-np ed-theme" aria-label="New project">
      <div className="h-npFields">
        <Field label="Name">
          <TextInput maxLength={LIMITS.projectNameChars} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="h-npLabel">Format</span>
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
          {/* A still from Pexels footage (free to use, no credit required), cropped to the frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed still inside a drawn frame */}
          <img
            className="h-npStill"
            src="/home/still-misty.webp"
            alt=""
            width={960}
            height={540}
            loading="lazy"
            decoding="async"
          />
          <span className="h-npName">
            <span className="h-npNameText">{name.trim() || "Untitled project"}</span>
            <span className="h-npSel">
              <span className="h-edPeerTag">You</span>
              <span className="h-edHandle" data-at="tl" />
              <span className="h-edHandle" data-at="tr" />
              <span className="h-edHandle" data-at="bl" />
              <span className="h-edHandle" data-at="br" />
            </span>
          </span>
        </BlankFrame>
        <p className="h-npSize">
          {shown.width} × {shown.height} px · {DEFAULT_FPS} fps
        </p>
      </div>
      <div className="h-npActions">
        <button type="submit" className="h-btn" disabled={!size}>
          Create project
        </button>
        <p className="h-npNote">You&apos;ll sign in with Google first.</p>
      </div>
    </form>
  );
}
