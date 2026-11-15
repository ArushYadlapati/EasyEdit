"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { readCookie, readKeymap, writeKeymap, writePrefsCookie } from "@/components/editor/browser-prefs";
import { SettingsProvider } from "@/components/editor/context";
import { GeneralFields, IN_THIS_BROWSER } from "@/components/editor/general-fields";
import { ShortcutsSection } from "@/components/editor/shortcuts-section";
import { Dialog } from "@/components/ui/dialog";
import { Tabs, tabIds } from "@/components/ui/tabs";
import { PREFS_COOKIE, createSettingsStore, formatPrefs, parsePrefs } from "@/lib/editor/settings";

type Section = "general" | "shortcuts";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "shortcuts", label: "Shortcuts" },
];

// The browser's local storage, looked up on each use; reaching it can throw where storage is blocked, which
// readKeymap and writeKeymap cope with.
const localStore = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

// The editor's own Settings, less its Project section, for the dashboard: the same preferences cookie and keymap that
// every editor page reads, so a change here shows in the next project opened. Rendered only while open, so each
// opening reads what the editor saved last. The cookie belongs to the space pages (/s), so the caller offers this only
// there.
export function DashboardSettingsDialog({ onClose }: { onClose(): void }): ReactNode {
  const idPrefix = useId();
  const [section, setSection] = useState<Section>("general");
  const ids = tabIds(idPrefix, section);

  // Snapping and the safe area and guide switches are the editor store's in a project; here they are kept beside the
  // settings store, and the cookie is written whole from both, as the editor does. Guides have no switch here; theirs
  // is carried through unchanged.
  const [{ initial, settings, saveSwitches }] = useState(() => {
    const initial = parsePrefs(readCookie(PREFS_COOKIE));
    const switches = { snapping: initial.snapping, safeZones: initial.safeZones, guides: initial.guides };
    const settings = createSettingsStore(
      { prefs: initial },
      {
        prefs: (chosen) => writePrefsCookie(formatPrefs({ ...chosen, ...switches })),
        keymap: (keymap) => writeKeymap(localStore, keymap),
      },
    );
    const saveSwitches = (patch: Partial<typeof switches>) => {
      Object.assign(switches, patch);
      const { units, boardZoom, stillSeconds, textSeconds } = settings.getState();
      writePrefsCookie(formatPrefs({ units, boardZoom, stillSeconds, textSeconds, ...switches }));
    };
    return { initial, settings, saveSwitches };
  });
  const [snapping, setSnappingState] = useState(initial.snapping);
  const [showSafeZones, setShowSafeZonesState] = useState(initial.safeZones);
  useEffect(() => settings.getState().loadKeymap(readKeymap(localStore)), [settings]);

  return (
    <SettingsProvider settings={settings}>
      <Dialog
        title="Settings"
        open
        onClose={onClose}
        className="h-[min(80vh,640px)]"
        bar={
          <Tabs
            label="Sections"
            value={section}
            tabs={SECTIONS}
            onChange={(id) => setSection(id as Section)}
            idPrefix={idPrefix}
            autoFocusSelected
          />
        }
      >
        <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} className="flex flex-col gap-4">
          <p className="text-[13px] leading-5 text-ed-muted">
            {IN_THIS_BROWSER} A project&apos;s format and safe area are in that project&apos;s Settings.
          </p>
          {section === "general" && (
            <GeneralFields
              switches={{
                snapping,
                setSnapping: (on) => {
                  setSnappingState(on);
                  saveSwitches({ snapping: on });
                },
                showSafeZones,
                setShowSafeZones: (on) => {
                  setShowSafeZonesState(on);
                  saveSwitches({ safeZones: on });
                },
              }}
            />
          )}
          {section === "shortcuts" && <ShortcutsSection />}
        </div>
      </Dialog>
    </SettingsProvider>
  );
}
