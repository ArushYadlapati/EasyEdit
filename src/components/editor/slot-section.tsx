"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { TextInput } from "@/components/ui/text-input";
import { LIMITS } from "@/lib/limits";
import { Slot, type Clip, type TimelineDoc } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";

export const SLOT_NAME_ERROR = "Use lowercase letters, numbers and _, starting with a letter";

// slot_1, slot_2, ...: the first not used by any clip in the document.
export function nextSlotName(doc: TimelineDoc): string {
  const used = new Set(doc.tracks.flatMap((t) => t.clips.flatMap((c) => (c.slot ? [c.slot.name] : []))));
  let n = 1;
  while (used.has(`slot_${n}`)) n++;
  return `slot_${n}`;
}

// What this clip is in a template: nothing, or a slot that gets filled in later. Every change is one update_clip.
export function SlotSection({ clip }: { clip: Clip }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit);
  const locked = useEditor((s) => s.doc.tracks.some((t) => t.locked && t.clips.some((c) => c.id === clip.id)));
  const [name, setName] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const off = !canEdit || locked;
  const slot = clip.slot;

  function write(next: Slot | null, label: string) {
    store.getState().edit([{ op: "update_clip", clipId: clip.id, patch: { slot: next } }], label);
  }

  function saveName() {
    if (name === null || !slot) return;
    const value = name;
    if (value === slot.name) {
      setName(null);
      setError(false);
      return;
    }
    const next: Slot = { ...slot, name: value };
    if (!Slot.safeParse(next).success) {
      setError(true);
      return;
    }
    setName(null);
    setError(false);
    write(next, "slot change");
  }

  function saveHint() {
    if (hint === null || !slot) return;
    const value = hint;
    setHint(null);
    if (value === (slot.hint ?? "")) return;
    write(value === "" ? { name: slot.name } : { ...slot, hint: value }, "slot change");
  }

  const onKey = (save: () => void, cancel: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm leading-5 font-semibold text-ed-text">Template slot</h2>
      <p className="text-[13px] leading-5 text-ed-muted">A slot is a part of the template that gets filled in later.</p>
      {!slot ? (
        <div className="flex flex-col items-start">
          <Button data-edit-control disabled={off} onClick={() => write({ name: nextSlotName(store.getState().doc) }, "make slot")}>
            Make this a slot
          </Button>
        </div>
      ) : (
        <>
          <Field label="Name">
            <TextInput
              data-edit-control
              disabled={off}
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={error || undefined}
              value={name ?? slot.name}
              onChange={(event) => {
                setName(event.target.value);
                setError(false);
              }}
              onBlur={saveName}
              onKeyDown={onKey(saveName, () => {
                setName(null);
                setError(false);
              })}
            />
          </Field>
          {error && (
            <p role="alert" className={cx("text-xs text-ed-danger")}>
              {SLOT_NAME_ERROR}
            </p>
          )}
          <Field label="Hint">
            <TextInput
              data-edit-control
              disabled={off}
              maxLength={LIMITS.slotHintChars}
              value={hint ?? slot.hint ?? ""}
              onChange={(event) => setHint(event.target.value)}
              onBlur={saveHint}
              onKeyDown={onKey(saveHint, () => setHint(null))}
            />
          </Field>
          {clip.type !== "placeholder" && (
            <div className="flex flex-col items-start">
              <Button data-edit-control disabled={off} onClick={() => write(null, "remove slot")}>
                Remove slot
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
