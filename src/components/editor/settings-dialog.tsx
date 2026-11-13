"use client";

import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, tabIds } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { LENGTH_MAX_S, LENGTH_MIN_S, clampSeconds, type Units } from "@/lib/editor/settings";
import { viewDoc } from "@/lib/editor/store";
import { FORMAT_PRESETS, SAFE_AREA_DEFAULTS, maxSafeAreaHeight, safeAreaOf, type SafeArea } from "@/lib/timeline";
import { useEditor, useEditorStore, useSettings, useSettingsStore } from "./context";
import { FormatSelect } from "./format-select";
import { ShortcutsSection } from "./shortcuts-section";

export type SettingsSection = "project" | "general" | "shortcuts";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "project", label: "Project" },
  { id: "general", label: "General" },
  { id: "shortcuts", label: "Shortcuts" },
];

const UNIT_OPTIONS: { value: Units; label: string }[] = [
  { value: "px", label: "Pixels" },
  { value: "cm", label: "Centimeters" },
  { value: "in", label: "Inches" },
];

const IN_THIS_BROWSER = "Saved in this browser only.";
const SMALL_HINT = "text-[11px] leading-4 text-ed-muted";
const CAPTION = "text-xs font-medium text-ed-muted";

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm leading-5 font-semibold text-ed-text">{children}</h3>;
}

// The project's own settings, the same for everyone who works on it.
function ProjectSection() {
  const fps = useEditor((s) => viewDoc(s).fps);
  return (
    <>
      <Field label="Format">
        <FormatSelect />
      </Field>
      <div className="flex flex-col gap-1">
        <span className={CAPTION}>Frame rate</span>
        <p className="text-ed-text">{fps} fps</p>
      </div>
      <SafeAreaFields />
    </>
  );
}

const toPercent = (fraction: number) => Number((fraction * 100).toFixed(1));
const fromPercent = (percent: number) => Number((percent / 100).toFixed(4));

// The safe area's size for the project's current format, kept with the project. Each format has its own; the box
// stays centred sideways and keeps its top, so a new height grows downward.
function SafeAreaFields() {
  const store = useEditorStore();
  const canEdit = useEditor((s) => s.canEdit && s.status !== "deleted");
  const format = useEditor((s) => viewDoc(s).format);
  const safeAreas = useEditor((s) => viewDoc(s).safeAreas);
  const safe = safeAreaOf({ format, safeAreas });
  const fallback = SAFE_AREA_DEFAULTS[format];
  const percent = { suffix: "%", step: 1, min: 5, disabled: !canEdit };

  function resize(patch: Partial<SafeArea>) {
    const size = { width: safe.width, height: safe.height, ...patch };
    store.getState().edit([{ op: "set_safe_area", format, size }], "safe area change");
  }

  return (
    <section className="flex flex-col gap-2">
      <Heading>Safe area</Heading>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Width">
          <NumberInput {...percent} data-edit-control max={100} value={toPercent(safe.width)} onCommit={(n) => resize({ width: fromPercent(n) })} />
        </Field>
        <Field label="Height">
          <NumberInput
            {...percent}
            data-edit-control
            max={toPercent(maxSafeAreaHeight(format))}
            value={toPercent(safe.height)}
            onCommit={(n) => resize({ height: fromPercent(n) })}
          />
        </Field>
      </div>
      <p className={SMALL_HINT}>
        For {FORMAT_PRESETS[format].label}; each format keeps its own. Centred sideways, from {toPercent(safe.top)}% down.
        {safe.custom ? "" : ` The default${format === "short_9x16" ? " follows Instagram's Reels guidance" : ""}: ${toPercent(fallback.width)}% × ${toPercent(fallback.height)}%.`}
      </p>
      {safe.custom && canEdit && (
        <Button
          size="sm"
          variant="ghost"
          data-edit-control
          className="self-start"
          onClick={() => store.getState().edit([{ op: "set_safe_area", format, size: null }], "safe area change")}
        >
          Reset to default ({toPercent(fallback.width)}% × {toPercent(fallback.height)}%)
        </Button>
      )}
    </section>
  );
}

// How this browser shows the editor, and what a new clip starts with.
function GeneralSection() {
  const settings = useSettingsStore();
  const units = useSettings((s) => s.units);
  const stillSeconds = useSettings((s) => s.stillSeconds);
  const textSeconds = useSettings((s) => s.textSeconds);
  const showSafeZones = useEditor((s) => s.showSafeZones);
  const toggleSafeZones = useEditor((s) => s.toggleSafeZones);
  const snapping = useEditor((s) => s.snapping);
  const setSnapping = useEditor((s) => s.setSnapping);
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
        <Toggle label="Show safe area" checked={showSafeZones} onChange={() => toggleSafeZones()} />
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

// Settings, in three sections: the project (for everyone), then this browser's own display, timeline and keys. `at`
// is the section shown, or null when closed.
export function SettingsDialog({ at, onSection, onClose }: { at: SettingsSection | null; onSection(section: SettingsSection): void; onClose(): void }) {
  const idPrefix = useId();
  const editable = useEditor((s) => s.canEdit && s.status !== "deleted");
  const shown = at ?? "project";
  const ids = tabIds(idPrefix, shown);
  const lead =
    shown !== "project"
      ? IN_THIS_BROWSER
      : editable
        ? "Changes this project for everyone who works on it."
        : "Only editors can change the format and the safe area.";

  return (
    <Dialog
      title="Settings"
      open={at !== null}
      onClose={onClose}
      className="h-[min(80vh,640px)]"
      bar={
        <Tabs
          label="Sections"
          value={shown}
          tabs={SECTIONS}
          onChange={(id) => onSection(id as SettingsSection)}
          idPrefix={idPrefix}
          autoFocusSelected
        />
      }
    >
      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} className="flex flex-col gap-4">
        <p className="text-[13px] leading-5 text-ed-muted">{lead}</p>
        {shown === "project" && <ProjectSection />}
        {shown === "general" && <GeneralSection />}
        {shown === "shortcuts" && <ShortcutsSection />}
      </div>
    </Dialog>
  );
}
