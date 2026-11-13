"use client";

import { Select } from "@/components/ui/select";
import { viewDoc } from "@/lib/editor/store";
import { FORMAT_PRESETS, type FormatId } from "@/lib/timeline";
import { useEditor, useEditorStore } from "./context";

const FORMATS = Object.entries(FORMAT_PRESETS) as [FormatId, (typeof FORMAT_PRESETS)[FormatId]][];

// The project's format, from the presets. A change is one undoable "format change" for everyone; a
// viewer, or a deleted project, sees it and cannot change it.
export function FormatSelect({ id, className }: { id?: string; className?: string }) {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit && s.status !== "deleted");
  const format = useEditor((s) => viewDoc(s).format);

  return (
    <Select
      id={id}
      className={className}
      data-edit-control
      disabled={!canEdit}
      value={format}
      onChange={(event) => store.getState().edit([{ op: "set_format", format: event.target.value as FormatId }], "format change")}
    >
      {FORMATS.map(([formatId, preset]) => (
        <option key={formatId} value={formatId}>
          {preset.label} ({preset.width} × {preset.height})
        </option>
      ))}
    </Select>
  );
}
