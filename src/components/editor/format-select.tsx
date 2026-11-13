"use client";

import { useState, type ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { viewDoc } from "@/lib/editor/store";
import { UNIT_DECIMALS, UNIT_SUFFIX, toEvenPixels, toUnit } from "@/lib/editor/units";
import { LIMITS } from "@/lib/limits";
import { FORMAT_PRESETS, FRAME_SIZE_MESSAGE, formatFields, isFrameSize, type FrameSize, type PresetId } from "@/lib/timeline";
import { useEditor, useEditorStore, useSettings } from "./context";

const FORMATS = Object.entries(FORMAT_PRESETS) as [PresetId, (typeof FORMAT_PRESETS)[PresetId]][];
const CUSTOM = "custom";
const SMALL = "text-[11px] leading-4";

// The project's format: a named size, or Custom size with its Width and Height in the editor's units. Picking Custom
// size sends nothing until a side changes; each change is one undoable "format change" for everyone. A viewer, or a
// deleted project, sees them and cannot change them.
export function FormatFields(): ReactNode {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit && s.status !== "deleted");
  const format = useEditor((s) => viewDoc(s).format);
  const width = useEditor((s) => viewDoc(s).width);
  const height = useEditor((s) => viewDoc(s).height);
  const units = useSettings((s) => s.units);
  const [picked, setPicked] = useState(false); // Custom size picked on a named-size project, before a side changes
  const [refused, setRefused] = useState(false); // the last size typed is outside the limits
  const custom = format === CUSTOM || picked;

  function pick(value: string) {
    setRefused(false);
    if (value === CUSTOM) {
      setPicked(true);
      return;
    }
    setPicked(false);
    if (value === viewDoc(store.getState()).format) return; // back to the size it has
    store.getState().edit([{ op: "set_format", format: value as PresetId }], "format change");
  }

  // The typed side, as even pixels, with the other side as it is.
  function commit(side: keyof FrameSize, typed: number) {
    const doc = viewDoc(store.getState());
    const size: FrameSize = { width: doc.width, height: doc.height, [side]: toEvenPixels(typed, units) };
    if (!isFrameSize(size.width, size.height)) {
      setRefused(true);
      return;
    }
    setRefused(false);
    if (size.width === doc.width && size.height === doc.height) return;
    if (store.getState().edit([{ op: "set_format", ...formatFields(size) }], "format change").ok) setPicked(false);
  }

  const side = (label: string, key: keyof FrameSize, px: number) => (
    <Field label={label}>
      {/* The unit sits inside the label, so the field is named on its own. */}
      <NumberInput
        ariaLabel={label}
        data-edit-control
        disabled={!canEdit}
        value={Number(toUnit(px, units).toFixed(UNIT_DECIMALS[units]))}
        suffix={UNIT_SUFFIX[units]}
        decimals={UNIT_DECIMALS[units]}
        step={units === "px" ? 2 : 0.1}
        min={toUnit(LIMITS.frameSideMin, units)}
        max={toUnit(LIMITS.frameSideMax, units)}
        onCommit={(typed) => commit(key, typed)}
      />
    </Field>
  );

  return (
    <>
      <Field label="Format">
        <Select data-edit-control disabled={!canEdit} value={custom ? CUSTOM : format} onChange={(event) => pick(event.target.value)}>
          {FORMATS.map(([formatId, preset]) => (
            <option key={formatId} value={formatId}>
              {preset.label} ({preset.width} × {preset.height})
            </option>
          ))}
          <option value={CUSTOM}>Custom size</option>
        </Select>
      </Field>
      {custom && (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-2">
            {side("Width", "width", width)}
            {side("Height", "height", height)}
          </div>
          {units !== "px" && (
            <p className={`${SMALL} text-ed-muted`}>{`${width} × ${height} pixels`}</p>
          )}
          {refused && (
            <p role="alert" className={`${SMALL} text-ed-danger`}>
              {FRAME_SIZE_MESSAGE}
            </p>
          )}
        </div>
      )}
    </>
  );
}
