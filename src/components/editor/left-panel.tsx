"use client";

import { Captions, Clapperboard, Palette, Type } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { Tabs, tabIds } from "@/components/ui/tabs";
import { DISABLED, FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { addMedia, addSticker, addText } from "@/lib/editor/actions";
import { STICKER_GROUPS } from "@/lib/editor/stickers";
import { presetMenu, rightClickEntries } from "@/lib/editor/menus";
import { cssFontFamily } from "@/lib/editor/fonts";
import { TEXT_PRESETS, presetFont, type TextPreset } from "@/lib/editor/text-presets";
import type { AssetView } from "@/lib/media/types";
import { useBrand } from "./brand/brand-context";
import { BrandTab } from "./brand/brand-tab";
import { CaptionsTab } from "./captions/captions-tab";
import { useEditor, useEditorStore, useSettingsStore } from "./context";
import { useMediaDrop } from "./media/media-context";
import { MediaTab, type PanelProps } from "./media/media-tab";
import { useToMenuItems } from "./menu-items";
import { useIsMac } from "./use-shortcuts";

// Exported for the top bar's search, which opens them by name.
export const LEFT_TABS = [
  { id: "text", label: "Text" },
  { id: "media", label: "Media" },
  { id: "captions", label: "Captions" },
  { id: "brand", label: "Brand kit" },
];
const TAB_ICON: Record<string, ReactNode> = { text: <Type />, media: <Clapperboard />, captions: <Captions />, brand: <Palette /> };
const TABS = LEFT_TABS.map((tab) => ({ ...tab, icon: TAB_ICON[tab.id] }));
// The four tabs' names need about 205 px in one row. Where the row is narrower they show as icons, sharing the row,
// each still named for a screen reader; the row never wraps or cuts a name off.
const TAB_ROW = cx(
  "w-full [&_[role=tab]]:flex [&_[role=tab]]:min-w-7 [&_[role=tab]]:flex-1 [&_[role=tab]]:items-center [&_[role=tab]]:justify-center [&_[data-tab-label]]:hidden",
  "@min-[13.5rem]:[&_[role=tab]]:flex-none @min-[13.5rem]:[&_[data-tab-icon]]:hidden @min-[13.5rem]:[&_[data-tab-label]]:inline",
);

// The stickers, one tab stop: the arrow keys move between them (up and down by a row, as they are laid out), Home and
// End to the first and last. Four a row, eight where the panel has room, each at least 28 px square.
function Stickers({ canEdit, onAdd }: { canEdit: boolean; onAdd(sticker: (typeof STICKER_GROUPS)[number]["stickers"][number]): void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const headingId = useId();
  const buttons = () => [...(box.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];

  // The nearest sticker in the next row up or down, by where they are drawn; none past the first or last row.
  function vertical(all: HTMLButtonElement[], from: number, down: boolean): number {
    const here = all[from].getBoundingClientRect();
    let best = from;
    let bestDy = Infinity;
    let bestDx = Infinity;
    all.forEach((button, i) => {
      const r = button.getBoundingClientRect();
      const dy = down ? r.top - here.top : here.top - r.top;
      if (dy < 1) return;
      const dx = Math.abs(r.left - here.left);
      if (dy < bestDy - 1 || (Math.abs(dy - bestDy) <= 1 && dx < bestDx)) [best, bestDy, bestDx] = [i, dy, dx];
    });
    return best;
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const all = buttons();
    const from = all.indexOf(e.target as HTMLButtonElement);
    if (from < 0) return;
    const last = all.length - 1;
    const to =
      e.key === "ArrowRight" ? Math.min(last, from + 1)
      : e.key === "ArrowLeft" ? Math.max(0, from - 1)
      : e.key === "ArrowDown" ? vertical(all, from, true)
      : e.key === "ArrowUp" ? vertical(all, from, false)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation(); // the arrows also step the playhead; here they only move between stickers
    setAt(to);
    all[to].focus();
  }

  let index = 0;
  return (
    <>
      <h2 id={headingId} className="mt-2 text-xs font-medium text-ed-muted">
        Stickers
      </h2>
      <div ref={box} role="toolbar" aria-labelledby={headingId} onKeyDown={onKeyDown} className="@container flex flex-col gap-2">
        {STICKER_GROUPS.map((group) => (
          <div
            key={group.name}
            role="group"
            aria-label={`${group.name} stickers`}
            className="grid grid-cols-[repeat(4,minmax(1.75rem,2.5rem))] gap-1 @min-[15.75rem]:grid-cols-[repeat(8,minmax(1.75rem,2.5rem))]"
          >
            {group.stickers.map((sticker) => {
              const i = index++;
              return (
                <button
                  key={sticker.name}
                  type="button"
                  data-edit-control
                  disabled={!canEdit}
                  tabIndex={i === at ? 0 : -1}
                  aria-label={`Add the ${sticker.name} sticker`}
                  title={sticker.name}
                  className={cx("flex aspect-square min-h-7 items-center justify-center rounded-md text-xl leading-none enabled:hover:bg-ed-hover", FOCUS_RING, FADE, DISABLED)}
                  onFocus={() => setAt(i)}
                  onClick={() => onAdd(sticker)}
                >
                  <span aria-hidden>{sticker.emoji}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

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
        {/* Stickers: one picture character each, added large as a text clip that pops in. */}
        <Stickers canEdit={canEdit} onAdd={(sticker) => addSticker(store, sticker, settings.getState().textSeconds)} />
      </div>
    </div>
  );
}

// tab and onTab, when given, hold the open tab outside, so the top bar's search can open one; without them the panel
// keeps its own.
export function LeftPanel({ tab: heldTab, onTab }: { tab?: string; onTab?(tab: string): void } = {}) {
  const store = useEditorStore();
  const settings = useSettingsStore();
  const addAsset = (asset: AssetView) => addMedia(store, asset, { stillSeconds: settings.getState().stillSeconds });
  const [ownTab, setOwnTab] = useState("text");
  const tab = heldTab ?? ownTab;
  const setTab = onTab ?? setOwnTab;
  const drop = useMediaDrop();
  // A file from the computer over the window opens the Media tab, where it can be dropped. It stays there afterwards.
  useEffect(
    () =>
      drop?.state.subscribe((state, before) => {
        if (state.incoming === "files" && before.incoming !== "files") setTab("media");
      }),
    [drop, setTab], // both setters are stable, so this subscribes once
  );
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const idPrefix = useId();
  const ids = tabIds(idPrefix, current.id);
  // Each tab draws the panel itself: the Media tab's panel is where files are dropped.
  const panel: PanelProps = { id: ids.panel, role: "tabpanel", "aria-labelledby": ids.tab };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="@container flex min-h-11 shrink-0 items-center border-b border-ed-line px-2 py-1.5">
        <Tabs label="Add" value={current.id} tabs={TABS} onChange={setTab} idPrefix={idPrefix} dense className={TAB_ROW} />
      </div>
      {current.id === "text" ? (
        <TextTab panel={panel} />
      ) : current.id === "captions" ? (
        <CaptionsTab panel={panel} />
      ) : current.id === "brand" ? (
        <BrandTab panel={panel} />
      ) : (
        <MediaTab panel={panel} onAdd={addAsset} />
      )}
    </div>
  );
}
