"use client";

import { useEffect, useId, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { Tabs, tabIds } from "@/components/ui/tabs";
import { addMedia, addText } from "@/lib/editor/actions";
import { presetMenu, rightClickEntries } from "@/lib/editor/menus";
import { cssFontFamily } from "@/lib/editor/fonts";
import { TEXT_PRESETS, presetFont, type TextPreset } from "@/lib/editor/text-presets";
import type { AssetView } from "@/lib/media/types";
import { useBrand } from "./brand/brand-context";
import { BrandTab } from "./brand/brand-tab";
import { useEditor, useEditorStore, useSettingsStore } from "./context";
import { useMediaDrop } from "./media/media-context";
import { MediaTab, type PanelProps } from "./media/media-tab";
import { useToMenuItems } from "./menu-items";
import { useIsMac } from "./use-shortcuts";

const TABS = [
  { id: "text", label: "Text" },
  { id: "media", label: "Media" },
  { id: "brand", label: "Brand kit" },
];

// Each preset adds itself at the playhead on a click, or from its right-click menu, in its brand kit font, which its
// button is drawn in. On a Mac a Ctrl+click is that right-click, so it adds nothing.
function TextTab({ panel }: { panel: PanelProps }) {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const canEdit = useEditor((s) => s.canEdit);
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  const isMac = useIsMac();
  const { fonts } = useBrand().kit;
  const add = (preset: TextPreset) => addText(store, preset, settings.getState().textSeconds, fonts);

  function onContextMenu(e: MouseEvent<HTMLButtonElement>, preset: TextPreset) {
    e.preventDefault();
    if (!menu) return;
    const entries = rightClickEntries(presetMenu(), store.getState().canEdit);
    if (entries.length === 0) return;
    menu({
      ...menuPoint(e),
      label: `More for ${preset.label}`,
      items: toItems(entries),
      returnFocus: e.currentTarget,
      onSelect: (id) => {
        if (id === "add") add(preset);
      },
    });
  }

  return (
    <div {...panel} className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2 p-3">
        {TEXT_PRESETS.map((preset) => {
          const font = presetFont(preset, fonts);
          return (
            <Button
              key={preset.id}
              data-edit-control
              disabled={!canEdit}
              aria-label={`Add ${preset.label.toLowerCase()}`}
              className="w-full justify-start"
              style={{ fontFamily: cssFontFamily(font.fontFamily), fontWeight: Math.min(font.fontWeight, 600) }}
              onClick={(e) => {
                if (!(isMac && e.ctrlKey)) add(preset);
              }}
              onContextMenu={(e) => onContextMenu(e, preset)}
            >
              {preset.label}
            </Button>
          );
        })}
        <p className="text-[13px] leading-5 text-ed-muted">Adds at the playhead.</p>
      </div>
    </div>
  );
}

export function LeftPanel() {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const addAsset = (asset: AssetView) => addMedia(store, asset, { stillSeconds: settings.getState().stillSeconds });
  const [tab, setTab] = useState("text");
  const drop = useMediaDrop();
  // A file from the computer over the window opens the Media tab, where it can be dropped. It stays there afterwards.
  useEffect(
    () =>
      drop?.state.subscribe((state, before) => {
        if (state.incoming === "files" && before.incoming !== "files") setTab("media");
      }),
    [drop],
  );
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const idPrefix = useId();
  const ids = tabIds(idPrefix, current.id);
  // Each tab draws the panel itself: the Media tab's panel is where files are dropped.
  const panel: PanelProps = { id: ids.panel, role: "tabpanel", "aria-labelledby": ids.tab };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-ed-line px-3">
        {/* Compact: the tool rail shares the column, and the three tabs must still read in full. */}
        <Tabs label="Add" value={current.id} tabs={TABS} onChange={setTab} idPrefix={idPrefix} compact />
      </div>
      {current.id === "text" ? (
        <TextTab panel={panel} />
      ) : current.id === "brand" ? (
        <BrandTab panel={panel} />
      ) : (
        <MediaTab panel={panel} onAdd={addAsset} />
      )}
    </div>
  );
}
