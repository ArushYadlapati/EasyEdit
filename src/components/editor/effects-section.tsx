"use client";

import { useEffect, useRef, useState } from "react";
import { SWATCH_BOX } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import {
  ANIMATION_IN,
  ANIMATION_OUT,
  DIRECTIONS,
  EMPHASIS,
  TRANSITION_KINDS,
  animationOps,
  clampEffectFrames,
  defaultEffectFrames,
  emphasisOps,
  pickEmphasis,
  pickTransition,
  transitionOps,
} from "@/lib/editor/effect-fields";
import type { EditorStore } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import { DEFAULT_DIP_COLOR, DEFAULT_HIGHLIGHT_COLOR } from "@/lib/render/effects";
import type { Emphasis, OpInput, TextAnimationIn, TextAnimationOut, TextClip, Transition } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";

// type: a shape has nothing to blend from, so it is offered no crossfade.
type Transitioned = Parameters<typeof transitionOps>[0] & { type?: string };

const HEX = /^#[0-9a-f]{6}$/i;
const CAPTION = "text-xs font-medium text-ed-muted";

function Heading({ children }: { children: string }) {
  return <h2 className="text-sm leading-5 font-semibold text-ed-text">{children}</h2>;
}

// The length is shown in seconds, like Timing, and kept in frames.
function LengthField({ label, frames, fps, canEdit, onCommit }: { label: string; frames: number; fps: number; canEdit: boolean; onCommit(frames: number): void }) {
  return (
    <Field label={label}>
      <NumberInput
        ariaLabel={label}
        data-edit-control
        disabled={!canEdit}
        value={Number((frames / fps).toFixed(2))}
        suffix="s"
        min={1 / fps}
        max={LIMITS.effectFramesMax / fps}
        step={0.1}
        scrub={1 / fps}
        decimals={2}
        onCommit={(seconds) => onCommit(clampEffectFrames(seconds * fps))}
      />
    </Field>
  );
}

// The swatch saves when the picker closes (its change event, not each input event); the hex box on Enter or blur.
export function EffectColor(props: { label: string; value: string; canEdit: boolean; onCommit(color: string): void }) {
  // Keyed by the saved value, so the boxes start over when it changes.
  return <EffectColorBoxes key={props.value} {...props} />;
}

function EffectColorBoxes({ label, value, canEdit, onCommit }: { label: string; value: string; canEdit: boolean; onCommit(color: string): void }) {
  const swatch = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(value);
  useEffect(() => {
    const input = swatch.current;
    if (!input) return;
    const onChange = () => onCommit(input.value);
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  });
  function save() {
    if (HEX.test(typed)) onCommit(typed.toLowerCase());
    else setTyped(value);
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={CAPTION}>{label}</span>
      <div className="flex min-w-0 gap-2">
        <input
          ref={swatch}
          type="color"
          aria-label={label}
          data-edit-control
          disabled={!canEdit}
          defaultValue={HEX.test(value) ? value : "#000000"}
          className={SWATCH_BOX}
        />
        <TextInput
          aria-label={`${label} hex`}
          data-edit-control
          disabled={!canEdit}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
      </div>
    </div>
  );
}

function send(store: EditorStore, ops: OpInput[], label: string) {
  if (ops.length > 0) store.getState().edit(ops, label);
}

function TransitionSide({ clip, side, canEdit, fps }: { clip: Transitioned; side: "in" | "out"; canEdit: boolean; fps: number }) {
  const store = useEditorStore();
  const current = (side === "in" ? clip.transitionIn : clip.transitionOut) ?? null;
  const title = side === "in" ? "In" : "Out";
  const set = (next: Transition | null) => send(store, transitionOps(clip, side, next), "transition");
  return (
    <div className="flex flex-col gap-2">
      <Field label={title}>
        <Select
          aria-label={`Transition ${side}`}
          data-edit-control
          disabled={!canEdit}
          value={current?.kind ?? ""}
          onChange={(event) => {
            const kind = event.target.value;
            set(kind === "" ? null : pickTransition(current, kind as Transition["kind"], fps));
          }}
        >
          <option value="">None</option>
          {TRANSITION_KINDS.filter((k) => (side === "in" ? k.in : k.out) && (k.value !== "crossfade" || clip.type !== "shape")).map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      {current && (
        <div className="grid grid-cols-2 gap-2">
          <LengthField label={`${title} length`} frames={current.frames} fps={fps} canEdit={canEdit} onCommit={(frames) => set({ ...current, frames })} />
          {(current.kind === "slide" || current.kind === "whip") && (
            <Field label={`${title} direction`}>
              <Select
                data-edit-control
                disabled={!canEdit}
                value={current.direction ?? "left"}
                onChange={(event) => set({ ...current, direction: event.target.value as NonNullable<Transition["direction"]> })}
              >
                {DIRECTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {current.kind === "dip" && (
            <EffectColor label={`${title} color`} value={current.color ?? DEFAULT_DIP_COLOR} canEdit={canEdit} onCommit={(color) => set({ ...current, color })} />
          )}
        </div>
      )}
    </div>
  );
}

// Video and image clips, and visual slots (the clip that fills one keeps its transitions).
export function TransitionsSection({ clip }: { clip: Transitioned }) {
  const canEdit = useEditor((s) => s.canEdit);
  const fps = useEditor((s) => s.doc.fps);
  return (
    <div className="flex flex-col gap-2">
      <Heading>Transitions</Heading>
      <TransitionSide clip={clip} side="in" canEdit={canEdit} fps={fps} />
      <TransitionSide clip={clip} side="out" canEdit={canEdit} fps={fps} />
    </div>
  );
}

function AnimationSide({ clip, side, canEdit, fps }: { clip: TextClip; side: "in" | "out"; canEdit: boolean; fps: number }) {
  const store = useEditorStore();
  const current = (side === "in" ? clip.animationIn : clip.animationOut) ?? null;
  const options = side === "in" ? ANIMATION_IN : ANIMATION_OUT;
  const title = side === "in" ? "In" : "Out";
  return (
    <div className="flex flex-col gap-2">
      <Field label={title}>
        <Select
          aria-label={`Transition ${side}`}
          data-edit-control
          disabled={!canEdit}
          value={current?.preset ?? ""}
          onChange={(event) => {
            const preset = event.target.value;
            const next = preset === "" ? null : { preset, frames: current?.frames ?? defaultEffectFrames(fps) };
            send(store, animationOps(clip, side, next as TextAnimationIn | TextAnimationOut | null), "text animation");
          }}
        >
          <option value="">None</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      {current && (
        <LengthField
          label={`${title} length`}
          frames={current.frames}
          fps={fps}
          canEdit={canEdit}
          onCommit={(frames) => send(store, animationOps(clip, side, { ...current, frames } as TextAnimationIn | TextAnimationOut), "text animation")}
        />
      )}
    </div>
  );
}

// Text clips.
export function AnimationSection({ clip }: { clip: TextClip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const fps = useEditor((s) => s.doc.fps);
  const emphasis = clip.emphasis ?? null;
  const setEmphasis = (next: Emphasis | null) => send(store, emphasisOps(clip, next), "text animation");
  return (
    <div className="flex flex-col gap-2">
      <Heading>Transitions</Heading>
      <AnimationSide clip={clip} side="in" canEdit={canEdit} fps={fps} />
      <AnimationSide clip={clip} side="out" canEdit={canEdit} fps={fps} />
      <Field label="Emphasis">
        <Select
          data-edit-control
          disabled={!canEdit}
          value={emphasis?.preset ?? ""}
          onChange={(event) => {
            const preset = event.target.value;
            setEmphasis(preset === "" ? null : pickEmphasis(emphasis, preset as Emphasis["preset"]));
          }}
        >
          <option value="">None</option>
          {EMPHASIS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      {emphasis?.preset === "highlight_word" && (
        <EffectColor label="Highlight color" value={emphasis.color ?? DEFAULT_HIGHLIGHT_COLOR} canEdit={canEdit} onCommit={(color) => setEmphasis({ ...emphasis, color })} />
      )}
    </div>
  );
}
