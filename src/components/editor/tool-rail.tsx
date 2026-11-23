"use client";

import { Circle, Crop, Diamond, FoldHorizontal, Hexagon, MousePointer2, MoveUpRight, Pentagon, Scissors, Slash, Slice, SeparatorVertical, Square, Star, Trash2, Triangle, Type } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useContextMenu } from "@/components/ui/context-menu";
import { IconButton } from "@/components/ui/icon-button";
import { BOX_SHAPES, SHAPE_TOOL_NAME, type BoxShape, type ShapeTool } from "@/lib/timeline/shapes";
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
  shape: { label: "Shape", command: "tool-shape", icon: <Square /> }, // shown with the current shape's icon instead
  line: { label: "Line", command: "tool-line", icon: <Slash /> },
  arrow: { label: "Arrow", command: "tool-arrow", icon: <MoveUpRight /> },
  guide: { label: "Guide", command: "tool-guide", icon: <SeparatorVertical /> },
  crop: { label: "Crop", command: "tool-crop", icon: <Crop /> },
};

export const SHAPE_ICON: Record<ShapeTool, ReactNode> = {
  rect: <Square />,
  ellipse: <Circle />,
  triangle: <Triangle />,
  diamond: <Diamond />,
  pentagon: <Pentagon />,
  hexagon: <Hexagon />,
  star: <Star />,
  line: <Slash />,
  arrow: <MoveUpRight />,
};

// The strip between the Add panel and the preview: the tools, one of them current, then the clip commands that act at
// once on the playhead or the selection. One tab stop; the arrow keys, Home and End move between its buttons. Someone
// who can't edit keeps Selection, and the rest is disabled. In a window too short for every button the strip scrolls.
export function ToolRail() {
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const canEdit = useEditor((s) => s.canEdit);
  const hasSelection = useEditor((s) => s.selection.clipIds.length > 0 || s.guideId !== null);
  const shapeTool = useEditor((s) => s.shapeTool);
  const key = useShortcutLabel();
  const menu = useContextMenu();
  const bar = useRef<HTMLDivElement>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);

  const buttons = () => [...(bar.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  // The tab stop: the button last moved to while it can still be used, else the current tool.
  const disabledAt = (index: number) => (index >= TOOLS.length ? !canEdit || (index > TOOLS.length && !hasSelection) : toolNeedsEdit(TOOLS[index]) && !canEdit);
  const stop = focusAt !== null && !disabledAt(focusAt) ? focusAt : TOOLS.indexOf(tool);

  // The Shape button's list of shapes, opened beside the rail. Picking one picks the Shape tool with it.
  function openShapes(button: HTMLElement) {
    if (!menu || !canEdit) return;
    const box = button.getBoundingClientRect();
    menu({
      x: box.right + 4,
      y: box.top,
      label: "Shapes",
      returnFocus: button,
      items: BOX_SHAPES.map((s) => ({ id: s, label: SHAPE_TOOL_NAME[s], radio: true, checked: s === shapeTool })),
      onSelect: (id) => {
        const state = store.getState();
        if (state.setTool("shape")) state.setShapeTool(id as BoxShape);
      },
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // ArrowRight on the Shape button opens its list.
    if (e.key === "ArrowRight" && (e.target as HTMLElement).dataset.tool === "shape") {
      e.preventDefault();
      e.stopPropagation();
      openShapes(e.target as HTMLElement);
      return;
    }
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
      className="flex h-full min-h-0 shrink-0 flex-col items-center gap-1 overflow-y-auto border-l border-ed-line bg-ed-panel py-2 [scrollbar-width:none]"
    >
      {TOOLS.map((t, i) => {
        const look = TOOL_LOOK[t];
        const needsEdit = toolNeedsEdit(t);
        const isShape = t === "shape";
        // The Shape button shows the shape it draws, a corner mark for its list, and opens the list when clicked
        // while it is already the tool, or right-clicked.
        const shapeProps = isShape && {
          "data-tool": "shape",
          "aria-haspopup": "menu" as const,
          className: "relative",
          onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            openShapes(e.currentTarget);
          },
        };
        return (
          <IconButton
            key={t}
            {...(needsEdit && { "data-edit-control": true })}
            label={isShape ? `Shape: ${SHAPE_TOOL_NAME[shapeTool]}` : look.label}
            shortcut={key(look.command)}
            pressed={tool === t}
            disabled={needsEdit && !canEdit}
            tabIndex={stop === i ? 0 : -1}
            onClick={(e) => {
              if (isShape && tool === "shape") openShapes(e.currentTarget);
              else store.getState().setTool(t);
            }}
            {...shapeProps}
          >
            {isShape ? SHAPE_ICON[shapeTool] : look.icon}
            {isShape && <span aria-hidden className="pointer-events-none absolute right-[3px] bottom-[3px] size-0 border-b-4 border-l-4 border-b-current border-l-transparent opacity-70" />}
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
