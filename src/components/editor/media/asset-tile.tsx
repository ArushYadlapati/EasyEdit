"use client";

import { Ellipsis, Music } from "lucide-react";
import { memo, useEffect, useId, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { FADE, FOCUS_RING, DISABLED, cx } from "@/components/ui/cx";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ASSET_DRAG_TYPE } from "@/lib/editor/media-drop";
import { assetMenu, rightClickEntries } from "@/lib/editor/menus";
import { MEDIA_MESSAGES, formatLength } from "@/lib/media/messages";
import { PLACEHOLDER_LABELS, playbackFileFor } from "@/lib/media/playback";
import type { AssetView } from "@/lib/media/types";
import { useToMenuItems } from "../menu-items";
import { useIsMac } from "../use-shortcuts";
import { useMediaDrop } from "./media-context";
import { usePoster } from "./use-poster";

export type AssetAction = "monitor" | "rename" | "event" | "remove";

const ACTIONS: MenuItem[] = [
  { id: "monitor", label: "Open in source monitor" },
  { id: "rename", label: "Rename" },
  { id: "event", label: "Set event" },
  { id: "remove", label: "Remove", danger: true },
];

// Tells `onChange` whether the element is in view, from now until the returned function is called.
export type WatchView = (element: Element, onChange: (inView: boolean) => void) => () => void;

// "Ada" of "Ada Lovelace". The name of an account that is gone is a phrase, and is shown whole.
function firstName(name: string): string {
  if (name === MEDIA_MESSAGES.formerMember) return name;
  return name.trim().split(/\s+/)[0] ?? name;
}

// Why a video cannot be played in the editor yet, if it cannot.
function previewNote(asset: AssetView): string | null {
  const file = playbackFileFor(asset);
  if (file.fileId !== null) return null;
  if (file.why === "preparing") return PLACEHOLDER_LABELS.preparing;
  if (file.why === "no-preview") return PLACEHOLDER_LABELS["no-preview"];
  return null;
}

type AssetTileProps = {
  asset: AssetView;
  canEdit: boolean;
  watch: WatchView;
  onAdd?: (asset: AssetView) => void;
  onAction(action: AssetAction, asset: AssetView): void;
};

// One asset of the library: its still picture, name, length (or "Image") and who uploaded it. Clicking it adds it to
// the timeline, and an editor can drag it there; More renames it, sets its event or removes it. A right-click offers
// both; on a Mac a Ctrl+click is that right-click, so it adds nothing.
export const AssetTile = memo(function AssetTile({ asset, canEdit, watch, onAdd, onAction }: AssetTileProps) {
  const box = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useContextMenu();
  const toItems = useToMenuItems();
  const isMac = useIsMac();
  const drop = useMediaDrop();
  const [inView, setInView] = useState(false);
  useEffect(() => (box.current ? watch(box.current, setInView) : undefined), [watch]);
  const poster = usePoster(asset, inView);
  const note = previewNote(asset);
  const length = asset.kind === "image" ? "Image" : asset.durationMs === null ? null : formatLength(asset.durationMs);
  const details = [length, firstName(asset.uploadedByName)].filter(Boolean).join(" · ");
  // The button's name is what it does; its length, uploader and note are read as its description.
  const detailsId = useId();
  const noteId = useId();

  // The More menu's own list has handled a right-click on it.
  function onContextMenu(e: MouseEvent<HTMLLIElement>) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (!menu) return;
    const entries = rightClickEntries(assetMenu(), canEdit);
    if (entries.length === 0) return;
    menu({
      ...menuPoint(e),
      label: `More for ${asset.name}`,
      items: toItems(entries),
      returnFocus: button.current,
      onSelect: (id) => {
        if (id === "add") onAdd?.(asset);
        else onAction(id as AssetAction, asset);
      },
    });
  }

  // The drag carries only the asset's id, under this page's own type: nothing another app would take.
  function onDragStart(e: DragEvent<HTMLButtonElement>) {
    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
    e.dataTransfer.effectAllowed = "copy";
    drop?.startAssetDrag(asset);
  }

  return (
    <li ref={box} className="flex min-w-0 items-center gap-1" onContextMenu={onContextMenu}>
      <button
        ref={button}
        type="button"
        data-edit-control
        data-asset-id={asset.id}
        disabled={!canEdit}
        draggable={canEdit}
        onDragStart={onDragStart}
        aria-label={`Add ${asset.name} to the timeline`}
        aria-describedby={note ? `${detailsId} ${noteId}` : detailsId}
        className={cx("flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left enabled:hover:bg-ed-hover", FOCUS_RING, FADE, DISABLED)}
        onClick={(e) => {
          if (!(isMac && e.ctrlKey)) onAdd?.(asset);
        }}
      >
        <span className="flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-ed-raised text-ed-muted [&>svg]:size-4 [&>svg]:stroke-[1.75]">
          {asset.kind === "audio" ? (
            <Music aria-hidden />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a blob address made in this page; next/image cannot load one.
            poster && <img src={poster} alt="" draggable={false} className="size-full object-cover" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-5 text-ed-text">{asset.name}</span>
          <span id={detailsId} className="truncate text-[11px] leading-4 text-ed-muted">
            {details}
          </span>
          {note && (
            <span id={noteId} className="truncate text-[11px] leading-4 text-ed-muted">
              {note}
            </span>
          )}
        </span>
      </button>
      <Menu
        data-edit-control
        disabled={!canEdit}
        label={`More for ${asset.name}`}
        icon={<Ellipsis />}
        items={ACTIONS}
        onSelect={(id) => onAction(id as AssetAction, asset)}
      />
    </li>
  );
});
