"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { NumberInput } from "@/components/ui/number-input";
import { ZOOM_PRESETS, zoomLabel, zoomName } from "@/lib/editor/board";
import { clampPercent, type BoardZoom } from "@/lib/editor/settings";
import { useEditorStore, useSettings, useSettingsStore } from "./context";

const PRESETS: readonly number[] = ZOOM_PRESETS;

// One choice of several, the current one checked; a percentage that is not a preset checks "Custom…".
function zoomItems(zoom: BoardZoom): MenuItem[] {
  return [
    { id: "fill", label: "Fill to size", radio: true, checked: zoom === "fill" },
    ...PRESETS.map((percent, i) => ({ id: String(percent), label: `${percent}%`, radio: true, checked: zoom === percent, separatorBefore: i === 0 })),
    { id: "custom", label: "Custom…", radio: true, checked: zoom !== "fill" && !PRESETS.includes(zoom), separatorBefore: true },
  ];
}

// The preview's zoom, in the control row; its text says "Board" so it isn't taken for the timeline's zoom. It is this
// browser's own view, so viewers use it too. Custom… starts at the scale the preview is drawn at now.
export function ZoomMenu(): ReactNode {
  const settings = useSettingsStore();
  const zoom = useSettings((s) => s.boardZoom);
  const editor = useEditorStore();
  const [customFrom, setCustomFrom] = useState<number | null>(null); // the Custom zoom dialog's starting value, while open

  function onSelect(id: string) {
    if (id === "custom") setCustomFrom(Math.round(editor.getState().boardScale * 100));
    else settings.getState().set({ boardZoom: id === "fill" ? "fill" : clampPercent(Number(id)) });
  }

  return (
    <>
      <Menu
        label={zoomName(zoom)}
        title="Preview zoom"
        text={`Board: ${zoomLabel(zoom)}`}
        className="shrink-0 justify-between tabular-nums"
        items={() => zoomItems(settings.getState().boardZoom)}
        onSelect={onSelect}
      />
      <Dialog title="Custom zoom" open={customFrom !== null} onClose={() => setCustomFrom(null)}>
        {customFrom !== null && (
          <CustomZoomForm
            start={customFrom}
            onApply={(percent) => {
              settings.getState().set({ boardZoom: clampPercent(percent) });
              setCustomFrom(null);
            }}
            onCancel={() => setCustomFrom(null)}
          />
        )}
      </Dialog>
    </>
  );
}

// One whole-number field. Apply, or Enter in the field, takes what is typed even before the field commits it.
function CustomZoomForm({ start, onApply, onCancel }: { start: number; onApply(percent: number): void; onCancel(): void }) {
  const [value, setValue] = useState(start);
  const [typed, setTyped] = useState<number | null>(null);
  const apply = () => onApply(typed ?? value);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <Field label="Zoom" hint="From 10% to 400%.">
        <NumberInput
          data-autofocus
          suffix="%"
          value={value}
          onPreview={setTyped}
          onCommit={(n) => {
            setValue(clampPercent(n));
            setTyped(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            apply();
          }}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Apply
        </Button>
      </div>
    </form>
  );
}
