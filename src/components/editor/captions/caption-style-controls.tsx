"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { DISABLED, FOCUS_RING, cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { nearestWeight } from "@/lib/brand/fonts";
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "@/lib/editor/inspector-fields";
import { captionStyleOf, type CaptionPreset, type CaptionStyle } from "@/lib/timeline";
import { useEditor, useEditorStore } from "../context";
import { EffectColor } from "../effects-section";
import { FontSelect } from "../font-select";

const LOOKS: { preset: CaptionPreset; label: string }[] = [
  { preset: "block", label: "Block" },
  { preset: "karaoke", label: "Karaoke" },
  { preset: "word", label: "One word" },
  { preset: "bar", label: "Bar" },
];

// The look of every caption in the project. Each change is one edit, of only the values that change.
export function CaptionStyleControls({ canEdit }: { canEdit: boolean }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const style = captionStyleOf(doc);

  function set(patch: Partial<CaptionStyle>) {
    const now = captionStyleOf(store.getState().doc);
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => now[key as keyof CaptionStyle] !== value));
    if (Object.keys(changed).length > 0) store.getState().edit([{ op: "set_caption_style", patch: changed }], "caption style");
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm leading-5 font-semibold text-ed-text">Style</h2>
      <div role="group" aria-label="Look" className="grid grid-cols-2 gap-1">
        {LOOKS.map(({ preset, label }) => (
          <Button key={preset} data-edit-control disabled={!canEdit} aria-pressed={style.preset === preset} className="aria-pressed:border-ed-accent aria-pressed:text-ed-accent" onClick={() => set({ preset })}>
            {label}
          </Button>
        ))}
      </div>
      <Field label="Font">
        <FontSelect
          data-edit-control
          disabled={!canEdit}
          family={style.fontFamily}
          onPick={(fontFamily) => set({ fontFamily, fontWeight: nearestWeight(fontFamily, style.fontWeight) })}
        />
      </Field>
      <Field label="Size">
        <NumberInput
          ariaLabel="Size"
          data-edit-control
          disabled={!canEdit}
          value={style.fontSize}
          suffix="px"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          scrub={1}
          decimals={0}
          onCommit={(fontSize) => set({ fontSize })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <EffectColor label="Text color" value={style.color} canEdit={canEdit} onCommit={(color) => set({ color })} />
        <EffectColor label="Highlight color" value={style.highlight} canEdit={canEdit} onCommit={(highlight) => set({ highlight })} />
      </div>
      <PositionSlider y={style.y} canEdit={canEdit} onCommit={(y) => set({ y })} />
      <label className={cx("flex min-h-7 items-center gap-2 text-xs text-ed-text", canEdit ? "cursor-pointer" : "cursor-not-allowed")}>
        <input
          type="checkbox"
          data-edit-control
          disabled={!canEdit}
          checked={style.uppercase}
          onChange={(event) => set({ uppercase: event.target.checked })}
          className={cx("size-3.5 accent-ed-accent", FOCUS_RING, DISABLED)}
        />
        Uppercase
      </label>
    </div>
  );
}

// Where the lines sit, from the top of the frame (0) to the bottom (100). It saves when the slider is let go (its
// change event), so a drag is one edit; keyed by the saved value, so it moves when someone else changes it.
function PositionSlider(props: { y: number; canEdit: boolean; onCommit(y: number): void }) {
  return <PositionInput key={props.y} {...props} />;
}

function PositionInput({ y, canEdit, onCommit }: { y: number; canEdit: boolean; onCommit(y: number): void }) {
  const slider = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = slider.current;
    if (!input) return;
    const onChange = () => onCommit(Number(input.value) / 100);
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  });
  return (
    <Field label="Position">
      <input
        ref={slider}
        type="range"
        data-edit-control
        disabled={!canEdit}
        min={0}
        max={100}
        step={1}
        defaultValue={Math.round(y * 100)}
        className={cx("h-7 w-full accent-ed-accent", FOCUS_RING, DISABLED)}
      />
    </Field>
  );
}
