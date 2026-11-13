"use client";

import { Ellipsis, Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX } from "lucide-react";
import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { IconButton } from "@/components/ui/icon-button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { removeTrack, renameTrack, reorderTrack, toggleTrack } from "@/lib/editor/actions";
import { reorderTrackOps } from "@/lib/editor/commands";
import { HEADER_WIDTH, trackToggles } from "@/lib/editor/geometry";
import { LIMITS } from "@/lib/limits";
import type { Track } from "@/lib/timeline";
import { useEditor, useEditorStore } from "../context";
import { useClipDrag } from "./use-clip-drag";

// Each switch keeps one name, for what it turns on, and shows with aria-pressed whether it is on.
const SWITCHES = {
  hidden: { label: "Hide track", OnIcon: EyeOff, OffIcon: Eye },
  muted: { label: "Mute track", OnIcon: VolumeX, OffIcon: Volume2 },
} as const;

// The name of a track and its switches, stuck to the left of its row. The accent tint is a
// background image over the opaque fill, because the clips scroll underneath. While the options
// menu is open the header rises above the ruler, so a menu that opens upwards is not covered. An
// editor drags the track up and down by its header, locked or not.
export const TrackHeader = memo(function TrackHeader({ track, selected }: { track: Track; selected: boolean }) {
  const store = useEditorStore();
  const drag = useClipDrag();
  const selectTrack = useEditor((s) => s.selectTrack);
  const canEdit = useEditor((s) => s.canEdit);
  const canMoveUp = useEditor((s) => reorderTrackOps(s.doc, track.id, "up").length > 0);
  const canMoveDown = useEditor((s) => reorderTrackOps(s.doc, track.id, "down").length > 0);
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
  function onNameClick() {
    selectTrack(track.id);
    if (canEdit) startRename();
  }

  // A click on the header's background selects the track; its buttons do their own thing.
  function onHeaderClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("button")) return;
    selectTrack(track.id);
  }

  // A press on the name or the background can become a track drag; the switches, the options menu
  // and the rename field keep their presses.
  function onHeaderPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !canEdit || !drag || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if ((button && button !== nameButton.current) || event.target.closest("input")) return;
    drag.pressTrack(event, track.id);
  }

  const items: MenuItem[] = [
    { id: "rename", label: "Rename" },
    { id: "up", label: "Move up", disabled: !canMoveUp },
    { id: "down", label: "Move down", disabled: !canMoveDown },
    track.locked
      ? { id: "remove", label: "Remove track (unlock first)", danger: true, disabled: true }
      : { id: "remove", label: "Remove track", danger: true },
  ];

  function onMenuSelect(id: string) {
    if (id === "rename") startRename();
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
            items={items}
            onSelect={onMenuSelect}
          />
        </>
      )}
    </div>
  );
});
