"use client";

import { Crop, FoldHorizontal, MousePointer2, Scissors, Slice, SeparatorVertical, Trash2, Type } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { deleteSelection, splitAtPlayhead } from "@/lib/editor/actions";
import type { CommandId } from "@/lib/editor/shortcuts";
import { TOOLS, toolNeedsEdit, type Tool } from "@/lib/editor/tools";
import { useEditor, useEditorStore } from "./context";
import { useShortcutLabel } from "./use-shortcuts";

export const RAIL_PX = 44;

const TOOL_LOOK: Record<Tool, { label: string; command: CommandId; icon: ReactNode }> = {
  select: { label: "Selection", command: "tool-select", icon: <MousePointer2 /> },
  razor: { label: "Razor", command: "tool-razor", icon: <Slice /> },
  text: { label: "Text", command: "tool-text", icon: <Type /> },
  guide: { label: "Guide", command: "tool-guide", icon: <SeparatorVertical /> },
  crop: { label: "Crop", command: "tool-crop", icon: <Crop /> },
};

// The strip between the Add panel and the preview: the tools, one of them current, then the clip commands that act at
// once on the playhead or the selection. One tab stop; the arrow keys, Home and End move between its buttons. Someone
// who can't edit keeps Selection, and the rest is disabled.
export function ToolRail() {
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const canEdit = useEditor((s) => s.canEdit);
  const hasSelection = useEditor((s) => s.selection.clipIds.length > 0 || s.guideId !== null);
  const key = useShortcutLabel();
  const bar = useRef<HTMLDivElement>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);

  const buttons = () => [...(bar.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  // The tab stop: the button last moved to while it can still be used, else the current tool.
  const disabledAt = (index: number) => (index >= TOOLS.length ? !canEdit || (index > TOOLS.length && !hasSelection) : toolNeedsEdit(TOOLS[index]) && !canEdit);
  const stop = focusAt !== null && !disabledAt(focusAt) ? focusAt : TOOLS.indexOf(tool);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const all = buttons();
    const enabled = all.filter((b) => !b.disabled);
    const from = enabled.indexOf(e.target as HTMLButtonElement);
    if (from < 0) return;
    const to =
      e.key === "ArrowDown" ? (from + 1) % enabled.length
      : e.key === "ArrowUp" ? (from - 1 + enabled.length) % enabled.length
      : e.key === "Home" ? 0
      : e.key === "End" ? enabled.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation(); // the arrows also step the playhead; here they only move focus
    setFocusAt(all.indexOf(enabled[to]));
    enabled[to].focus();
  }

  const command = (index: number, label: string, shortcut: string, disabled: boolean, run: () => void, icon: ReactNode) => (
    <IconButton data-edit-control label={label} shortcut={shortcut} disabled={disabled} tabIndex={stop === index ? 0 : -1} onClick={run}>
      {icon}
    </IconButton>
  );

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      style={{ width: RAIL_PX }}
      className="flex h-full shrink-0 flex-col items-center gap-1 border-l border-ed-line bg-ed-panel py-2"
    >
      {TOOLS.map((t, i) => {
        const look = TOOL_LOOK[t];
        const needsEdit = toolNeedsEdit(t);
        return (
          <IconButton
            key={t}
            {...(needsEdit && { "data-edit-control": true })}
            label={look.label}
            shortcut={key(look.command)}
            pressed={tool === t}
            disabled={needsEdit && !canEdit}
            tabIndex={stop === i ? 0 : -1}
            onClick={() => store.getState().setTool(t)}
          >
            {look.icon}
          </IconButton>
        );
      })}
      <span aria-hidden className="my-1 h-px w-5 shrink-0 bg-ed-line" />
      {command(TOOLS.length, "Split", key("split"), !canEdit, () => splitAtPlayhead(store), <Scissors />)}
      {command(TOOLS.length + 1, "Delete", key("delete"), !canEdit || !hasSelection, () => deleteSelection(store, false), <Trash2 />)}
      {command(TOOLS.length + 2, "Ripple delete", key("ripple-delete"), !canEdit || !hasSelection, () => deleteSelection(store, true), <FoldHorizontal />)}
    </div>
  );
}
