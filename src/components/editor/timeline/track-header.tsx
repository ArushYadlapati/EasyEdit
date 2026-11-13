"use client";

import { Ellipsis, Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX } from "lucide-react";
import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { menuPoint, useContextMenu } from "@/components/ui/context-menu";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Menu } from "@/components/ui/menu";
import { duplicateTrack, removeTrack, renameTrack, reorderTrack, toggleTrack } from "@/lib/editor/actions";
import { HEADER_WIDTH, trackToggles } from "@/lib/editor/geometry";
import { rightClickEntries, trackMenu } from "@/lib/editor/menus";
import { LIMITS } from "@/lib/limits";
import type { Track } from "@/lib/timeline";
import { useEditor, useEditorStore } from "../context";
import { useToMenuItems } from "../menu-items";
import { useIsMac } from "../use-shortcuts";
import { useClipDrag } from "./use-clip-drag";

// Each switch keeps one name, for what it turns on, and shows with aria-pressed whether it is on.
const SWITCHES = {
  hidden: { label: "Hide track", OnIcon: EyeOff, OffIcon: Eye },
  muted: { label: "Mute track", OnIcon: VolumeX, OffIcon: Volume2 },
} as const;

// The name of a track and its switches, stuck to the left of its row. The accent tint is a
// background image over the opaque fill, because the clips scroll underneath. While the options
// menu is open the header rises above the ruler, so a menu that opens upwards is not covered. An
// editor drags the track up and down by its header, locked or not. A right-click selects the track and
// opens the same options where it was clicked; on a Mac a Ctrl press is that right-click, so it neither
// drags nor opens the name.
export const TrackHeader = memo(function TrackHeader({ track, selected }: { track: Track; selected: boolean }) {
  const store = useEditorStore();
  const drag = useClipDrag();
  const selectTrack = useEditor((s) => s.selectTrack);
  const canEdit = useEditor((s) => s.canEdit);
  const toItems = useToMenuItems();
  const menu = useContextMenu();
  const isMac = useIsMac();
  const [editing, setEditing] = useState(false);
  const renaming = editing && canEdit;
  const nameButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false); // a key ended the rename, so focus goes back to the name

  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    nameButton.current?.focus();
  }, [renaming]);

  function startRename() {
    setEditing(true);
  }

  function endRename(value: string | null, byKey: boolean) {
    refocus.current = byKey;
    if (value !== null) renameTrack(store, track.id, value);
    setEditing(false);
  }

  // A click on the name selects the track and, for an editor, opens the name for typing.
  function onNameClick(event: MouseEvent<HTMLButtonElement>) {
    if (isMac && event.ctrlKey) return;
    selectTrack(track.id);
    if (canEdit) startRename();
  }

  // A click on the header's background selects the track. Its buttons do their own thing, and a
  // click in the rename field or on the options popup (drawn inside the header) is not the background.
  function onHeaderClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("button, input, [role='menu']")) return;
    selectTrack(track.id);
  }

  // A press on the name or the background can become a track drag; the switches, the options menu
  // and the rename field keep their presses.
  // The options popup is drawn inside the header, and a press on its padding is not a drag either.
  function onHeaderPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (isMac && event.ctrlKey) return;
    if (event.button !== 0 || !canEdit || !drag || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if ((button && button !== nameButton.current) || event.target.closest("input, [role='menu']")) return;
    drag.pressTrack(event, track.id);
  }

  // The rename field keeps the browser's own menu, and the options popup has handled its own right-click.
  function onHeaderContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest("input"))) return;
    event.preventDefault();
    if (!menu) return;
    selectTrack(track.id);
    const state = store.getState();
    const entries = rightClickEntries(trackMenu(state, track.id), state.canEdit);
    if (entries.length === 0) return;
    menu({ ...menuPoint(event), label: "Track options", items: toItems(entries), onSelect: onMenuSelect, returnFocus: nameButton.current });
  }

  function onMenuSelect(id: string) {
    if (id === "rename") startRename();
    else if (id === "duplicate") duplicateTrack(store, track.id);
    else if (id === "up" || id === "down") reorderTrack(store, track.id, id);
    else if (id === "remove") removeTrack(store, track.id);
  }

  return (
    <div
      className={cx(
        "sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-ed-line bg-ed-raised px-2 has-[[aria-expanded=true]]:z-40",
        selected && "bg-linear-to-r from-ed-accent-weak to-ed-accent-weak",
        canEdit && "cursor-grab",
        FADE,
      )}
      style={{ width: HEADER_WIDTH }}
      onClick={onHeaderClick}
      onPointerDown={onHeaderPointerDown}
      onContextMenu={onHeaderContextMenu}
    >
      {renaming ? (
        <InlineEdit
          data-edit-control
          label="Track name"
          defaultValue={track.name}
          maxLength={LIMITS.trackNameChars}
          onDone={endRename}
        />
      ) : (
        <>
          <button
            ref={nameButton}
            type="button"
            title={track.name}
            aria-current={selected ? "true" : undefined}
            onClick={onNameClick}
            className={cx(
              "h-7 w-fit max-w-full min-w-0 truncate rounded-md px-1.5 text-left text-xs leading-4 font-medium",
              selected ? "text-ed-accent" : "text-ed-text hover:bg-ed-hover",
              FOCUS_RING,
              FADE,
            )}
          >
            {track.name}
          </button>
          <div className="min-w-0 flex-1 self-stretch" />
          <IconButton
            data-edit-control
            disabled={!canEdit}
            label="Lock track"
            pressed={track.locked}
            onClick={() => toggleTrack(store, track.id, "locked")}
          >
            {track.locked ? <Lock /> : <LockOpen />}
          </IconButton>
          {trackToggles(track.kind).map((field) => {
            const { label, OnIcon, OffIcon } = SWITCHES[field];
            return (
              <IconButton
                key={field}
                data-edit-control
                disabled={!canEdit}
                label={label}
                pressed={track[field]}
                onClick={() => toggleTrack(store, track.id, field)}
              >
                {track[field] ? <OnIcon /> : <OffIcon />}
              </IconButton>
            );
          })}
          <Menu
            data-edit-control
            disabled={!canEdit}
            label="Track options"
            icon={<Ellipsis />}
            items={() => toItems(trackMenu(store.getState(), track.id))}
            onSelect={onMenuSelect}
          />
        </>
      )}
    </div>
  );
});
