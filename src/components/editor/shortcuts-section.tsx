"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";
import { conflictFor, effectiveKeys, isDefaultKeys, recordKey, refusalFor, resetKeys, setKeys, setOff, type Keymap } from "@/lib/editor/keymap";
import { SHORTCUTS, keyLabel, type CommandId, type Shortcut } from "@/lib/editor/shortcuts";
import { useSettings, useSettingsStore } from "./context";
import { useIsMac } from "./use-shortcuts";

const GROUPS: Shortcut["group"][] = ["Tools", "Playback", "Editing", "Timeline", "General"];
const LABELS = new Map<CommandId, string>(SHORTCUTS.map((s) => [s.command, s.label]));

// What the mouse does on the preview with a key held. These are not shortcuts, so they cannot be changed. On a Mac Alt
// is written ⌥ and Ctrl ⌃.
type MouseRow = { label: string; keys: ("Shift" | "Alt" | "Ctrl")[]; action: string };
const PREVIEW_ROWS: MouseRow[] = [
  { label: "Move along one line", keys: ["Shift"], action: "drag a clip" },
  { label: "Resize freely (squash or stretch)", keys: ["Shift"], action: "drag a handle" },
  { label: "Resize from the middle", keys: ["Alt"], action: "drag a handle" },
  { label: "Crop instead of resizing", keys: ["Ctrl"], action: "drag a handle" },
  { label: "Turn in 15° steps", keys: ["Shift"], action: "drag the turn handle" },
  { label: "Type in place", keys: [], action: "double-click text" },
];

// The line under a row after recording: why the key was refused, or which command already has it.
type Line = { command: CommandId; refused: string } | { command: CommandId; combo: string; other: CommandId };

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

function MouseKey({ name, isMac }: { name: MouseRow["keys"][number]; isMac: boolean }) {
  return <Kbd>{isMac && name === "Alt" ? "⌥" : isMac && name === "Ctrl" ? "⌃" : name}</Kbd>;
}

function Keys({ keys, dim, isMac }: { keys: string[]; dim: boolean; isMac: boolean }) {
  if (keys.length === 0) return <span className="text-ed-muted">No key</span>;
  return keys.map((combo, i) => (
    <Fragment key={combo}>
      {i > 0 && <span className="text-ed-muted">or</span>}
      <Kbd dim={dim}>{keyLabel(combo, isMac)}</Kbd>
    </Fragment>
  ));
}

// Every shortcut by group, with the keys chosen in this browser: a switch for each, and a button that
// records a new key. Then what the mouse does on the preview. A viewer changes their own keys here too.
export function ShortcutsSection() {
  const isMac = useIsMac();
  const settings = useSettingsStore();
  const keymap = useSettings((s) => s.keymap);
  const keys = useMemo(() => effectiveKeys(keymap), [keymap]);
  const [recording, setRecording] = useState<CommandId | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const keyButtons = useRef(new Map<CommandId, HTMLButtonElement>());
  const takeButton = useRef<HTMLButtonElement>(null);

  // The question about a key in use takes focus, so Enter answers it and Escape cancels it.
  useEffect(() => {
    if (line && "other" in line) takeButton.current?.focus();
  }, [line]);

  const change = (update: (km: Keymap) => Keymap) => {
    const store = settings.getState();
    store.setKeymap(update(store.keymap));
  };

  const endLine = (command: CommandId) => {
    setLine(null);
    keyButtons.current.get(command)?.focus();
  };

  const startRecording = (command: CommandId, event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus(); // Safari does not focus a clicked button, and the key comes to it
    setLine(null);
    setRecording(command);
  };

  const onRecordKey = (command: CommandId, event: KeyboardEvent<HTMLButtonElement>) => {
    if (recording !== command) return;
    // Tab ends recording and moves focus on as usual.
    if (event.key === "Tab") {
      setRecording(null);
      return;
    }
    // Nothing else reaches the browser or the button: not Mod+R or F5, not Space or Enter, and Escape
    // leaves Settings open.
    event.preventDefault();
    if (event.key === "Escape") {
      setRecording(null);
      return;
    }
    const { key, code, metaKey, ctrlKey, shiftKey, altKey, repeat } = event;
    const result = recordKey({ key, code, metaKey, ctrlKey, shiftKey, altKey, repeat, isComposing: event.nativeEvent.isComposing }, isMac);
    if (result === null) return;
    setRecording(null);
    if ("refused" in result) {
      setLine({ command, refused: result.refused });
      return;
    }
    const other = conflictFor(settings.getState().keymap, command, result.combo);
    if (other) setLine({ command, combo: result.combo, other });
    else change((km) => setKeys(km, command, result.combo));
  };

  // Escape while the question shows is Cancel, and Settings stays open.
  const onRowKey = (command: CommandId, event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || !line || !("other" in line) || line.command !== command) return;
    event.preventDefault();
    endLine(command);
  };

  const lineFor = (command: CommandId): ReactNode => {
    if (line?.command !== command) return null;
    if ("refused" in line) return <p className="pt-1 pb-1.5 text-xs text-ed-text">{line.refused}</p>;
    const { combo, other } = line;
    return (
      <div className="flex flex-wrap items-center gap-2 pt-1 pb-1.5 text-xs">
        <p className="text-ed-text">{`${keyLabel(combo, isMac)} is used by ${LABELS.get(other)}.`}</p>
        <Button
          ref={takeButton}
          size="sm"
          onClick={() => {
            change((km) => setKeys(km, command, combo, other));
            endLine(command);
          }}
        >
          Use it here
        </Button>
        <Button size="sm" variant="ghost" onClick={() => endLine(command)}>
          Cancel
        </Button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Toggle label="Use keyboard shortcuts" checked={keymap.on} onChange={(on) => change((km) => ({ ...km, on }))} />
        <Button size="sm" disabled={isDefaultKeys(keymap)} onClick={() => change(resetKeys)}>
          Restore default keys
        </Button>
      </div>
      {GROUPS.map((group) => (
        <Group key={group} title={group}>
          {SHORTCUTS.filter((s) => s.group === group).map(({ command, label, keys: defaults }) => {
            const off = keymap.off.includes(command);
            const dim = off || !keymap.on;
            // A row whose own key can't be recorded (Escape, for Clear the selection) can be switched
            // off but not changed, so that key is never lost.
            const fixed = defaults.some((k) => refusalFor(k, isMac) !== null);
            const isRecording = recording === command;
            return (
              <li key={command} className="flex flex-col" onKeyDown={(event) => onRowKey(command, event)}>
                <div className="flex min-h-7 items-center justify-between gap-4">
                  <Toggle
                    label={label}
                    aria-label={`Shortcut for ${label}`}
                    checked={!off}
                    disabled={!keymap.on}
                    onChange={(on) => change((km) => setOff(km, command, !on))}
                    className="min-w-0"
                  />
                  {fixed ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs">
                      <Keys keys={keys[command]} dim={dim} isMac={isMac} />
                    </span>
                  ) : (
                    <Button
                      ref={(el) => {
                        if (el) keyButtons.current.set(command, el);
                        return () => void keyButtons.current.delete(command);
                      }}
                      size="sm"
                      variant="ghost"
                      aria-label={isRecording ? `Press the new key for ${label}` : `Change the key for ${label}`}
                      onClick={(event) => startRecording(command, event)}
                      onKeyDown={(event) => onRecordKey(command, event)}
                      onBlur={() => setRecording((r) => (r === command ? null : r))}
                    >
                      {isRecording ? <span className="text-ed-accent">Press a key</span> : <Keys keys={keys[command]} dim={dim} isMac={isMac} />}
                    </Button>
                  )}
                </div>
                <div role="status">{lineFor(command)}</div>
              </li>
            );
          })}
        </Group>
      ))}
      <Group title="Preview">
        {PREVIEW_ROWS.map((row) => (
          <Row key={row.label} label={row.label}>
            {row.keys.map((key) => (
              <Fragment key={key}>
                <MouseKey name={key} isMac={isMac} />
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
