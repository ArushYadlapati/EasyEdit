"use client";

import type { ReactNode } from "react";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { LENGTH_MAX_S, LENGTH_MIN_S, clampSeconds, type Units } from "@/lib/editor/settings";
import { useSettings, useSettingsStore } from "./context";

// Settings' General section, on its own so that the dashboard's Settings can show it without the editor.

const UNIT_OPTIONS: { value: Units; label: string }[] = [
  { value: "px", label: "Pixels" },
  { value: "cm", label: "Centimeters" },
  { value: "in", label: "Inches" },
];

export const IN_THIS_BROWSER = "Saved in this browser only.";
export const SMALL_HINT = "text-[11px] leading-4 text-ed-muted";
export const CAPTION = "text-xs font-medium text-ed-muted";

export function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm leading-5 font-semibold text-ed-text">{children}</h3>;
}

// Snapping and the safe area switch: the editor's store holds them while a project is open, and the dashboard's
// Settings holds them itself.
export type ViewSwitches = { snapping: boolean; setSnapping(on: boolean): void; showSafeZones: boolean; setShowSafeZones(on: boolean): void };

// How this browser shows the editor, and what a new clip starts with. Inside a SettingsProvider (or the editor's).
export function GeneralFields({ switches }: { switches: ViewSwitches }) {
  const settings = useSettingsStore();
  const units = useSettings((s) => s.units);
  const stillSeconds = useSettings((s) => s.stillSeconds);
  const textSeconds = useSettings((s) => s.textSeconds);
  const { snapping, setSnapping, showSafeZones, setShowSafeZones } = switches;
  const length = { suffix: "s", min: LENGTH_MIN_S, max: LENGTH_MAX_S, step: 0.5 };

  return (
    <>
      <section className="flex flex-col gap-2">
        <Heading>Display</Heading>
        <div className="flex flex-col gap-1">
          <span className={CAPTION}>Units</span>
          <Segmented<Units> label="Units" value={units} options={UNIT_OPTIONS} onChange={(next) => settings.getState().set({ units: next })} />
          <p className={SMALL_HINT}>Centimeters and inches count 96 pixels to the inch.</p>
        </div>
        <Toggle label="Show safe area" checked={showSafeZones} onChange={() => setShowSafeZones(!showSafeZones)} />
      </section>
      <section className="flex flex-col gap-2">
        <Heading>Timeline</Heading>
        <Toggle label="Snapping" checked={snapping} onChange={setSnapping} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Still image length">
            <NumberInput {...length} value={stillSeconds} onCommit={(n) => settings.getState().set({ stillSeconds: clampSeconds(n) })} />
          </Field>
          <Field label="Text clip length">
            <NumberInput {...length} value={textSeconds} onCommit={(n) => settings.getState().set({ textSeconds: clampSeconds(n) })} />
          </Field>
        </div>
        <p className={SMALL_HINT}>How long a new image or text clip lasts. Clips already on the timeline keep their length.</p>
      </section>
    </>
  );
}
