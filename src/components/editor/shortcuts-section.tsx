"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { Kbd } from "@/components/ui/kbd";
import { effectiveKeys } from "@/lib/editor/keymap";
import { SHORTCUTS, keyLabel, type Shortcut } from "@/lib/editor/shortcuts";
import { useSettings } from "./context";
import { useIsMac } from "./use-shortcuts";

const GROUPS: Shortcut["group"][] = ["Playback", "Editing", "Timeline", "General"];

// What the mouse does on the preview with a key held. These are not shortcuts, so they cannot be changed.
type MouseRow = { label: string; keys: ("Shift" | "Alt")[]; action: string };
const PREVIEW_ROWS: MouseRow[] = [
  { label: "Move along one line", keys: ["Shift"], action: "drag a clip" },
  { label: "Keep the shape while resizing", keys: ["Shift"], action: "drag a handle" },
  { label: "Crop instead of resizing", keys: ["Alt"], action: "drag a handle" },
  { label: "Turn in 15° steps", keys: ["Shift"], action: "drag the turn handle" },
  { label: "Type in place", keys: [], action: "double-click text" },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm leading-5 font-semibold text-ed-text">{title}</h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex min-h-7 items-center justify-between gap-4">
      <span className="min-w-0 text-ed-text">{label}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-ed-muted">{children}</span>
    </li>
  );
}

// Every shortcut by group, with the keys chosen in this browser, then what the mouse does on the preview.
export function ShortcutsSection() {
  const isMac = useIsMac();
  const keymap = useSettings((s) => s.keymap);
  const keys = useMemo(() => effectiveKeys(keymap), [keymap]);

  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((group) => (
        <Group key={group} title={group}>
          {SHORTCUTS.filter((s) => s.group === group).map((shortcut) => (
            <Row key={shortcut.command} label={shortcut.label}>
              {keys[shortcut.command].length === 0
                ? "No key"
                : keys[shortcut.command].map((combo, i) => (
                    <Fragment key={combo}>
                      {i > 0 && <span>or</span>}
                      <Kbd>{keyLabel(combo, isMac)}</Kbd>
                    </Fragment>
                  ))}
            </Row>
          ))}
        </Group>
      ))}
      <Group title="Preview">
        {PREVIEW_ROWS.map((row) => (
          <Row key={row.label} label={row.label}>
            {row.keys.map((key) => (
              <Fragment key={key}>
                <Kbd>{key === "Alt" && isMac ? "⌥" : key}</Kbd>
                <span aria-hidden>+</span>
              </Fragment>
            ))}
            <Kbd>{row.action}</Kbd>
          </Row>
        ))}
      </Group>
    </div>
  );
}
