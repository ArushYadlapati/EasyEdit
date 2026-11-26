"use client";

import { Circle, Crop, Diamond, FoldHorizontal, Hexagon, MousePointer2, MoveUpRight, Pentagon, Scissors, Slash, Slice, SeparatorVertical, Square, Star, Trash2, Triangle, Type } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useContextMenu } from "@/components/ui/context-menu";
import { IconButton } from "@/components/ui/icon-button";
import { BOX_SHAPES, LINE_TOOLS, SHAPE_TOOL_NAME, type BoxShape, type LineTool, type ShapeTool } from "@/lib/timeline/shapes";
import { deleteSelection, splitAtPlayhead } from "@/lib/editor/actions";
import { addGuideInMiddle, addShapeInMiddle } from "@/lib/editor/add-centred";
import type { CommandId } from "@/lib/editor/shortcuts";
import { TOOLS, toolNeedsEdit, type Tool } from "@/lib/editor/tools";
import { useBrand } from "./brand/brand-context";
import { useEditor, useEditorStore, useSettingsStore } from "./context";
import { useShortcutLabel } from "./use-shortcuts";

export const RAIL_PX = 44;

type Lister = "shape" | "line" | "guide"; // the buttons with a list
const ADD = "add-in-middle";
const withArticle = (name: string) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name.toLowerCase()}`;

const TOOL_LOOK: Record<Tool, { label: string; command: CommandId; icon: ReactNode }> = {
  select: { label: "Selection", command: "tool-select", icon: <MousePointer2 /> },
  razor: { label: "Razor", command: "tool-razor", icon: <Slice /> },
  text: { label: "Text", command: "tool-text", icon: <Type /> },
  shape: { label: "Shape", command: "tool-shape", icon: <Square /> }, // shown with the current shape's icon instead
  line: { label: "Line", command: "tool-line", icon: <Slash /> }, // shown as a line or an arrow, whichever it draws
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
// Two of the tools draw more than one thing. Shape keeps a list of shapes; Line draws a line or an arrow. Each shows
// what it draws now, and a click on it while it is already the tool changes that: Shape opens its list, Line switches
// to the other of its two. Shape, Line and Guide each have a list (ArrowRight or a right-click; for Shape and Guide a
// second click too) that also adds one in the middle of the frame, for whoever does not drag (Enter does the same
// while the tool is chosen and focus is not on a button).
export function ToolRail() {
  const store = useEditorStore();
  const tool = useEditor((s) => s.tool);
  const canEdit = useEditor((s) => s.canEdit);
  const hasSelection = useEditor((s) => s.selection.clipIds.length > 0 || s.guideId !== null);
  const shapeTool = useEditor((s) => s.shapeTool);
  const lineTool = useEditor((s) => s.lineTool);
  const key = useShortcutLabel();
  const settings = useSettingsStore();
  const brandColor = useBrand().kit.colors[0];
  const menu = useContextMenu();
  const bar = useRef<HTMLDivElement>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);

  const buttons = () => [...(bar.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  // The tab stop: the button last moved to while it can still be used, else the current tool.
  const disabledAt = (index: number) => (index >= TOOLS.length ? !canEdit || (index > TOOLS.length && !hasSelection) : toolNeedsEdit(TOOLS[index]) && !canEdit);
  const stop = focusAt !== null && !disabledAt(focusAt) ? focusAt : TOOLS.indexOf(tool);

  // What the Shape or the Line button draws, as a list opened beside the rail, then a way to add one in the middle of
  // the frame. Picking a shape picks the tool with it. The Guide button's list adds a guide down or across the middle.
  function openList(button: HTMLElement, of: Lister) {
    if (!menu || !canEdit) return;
    const box = button.getBoundingClientRect();
    const place = { x: box.right + 4, y: box.top, returnFocus: button };
    if (of === "guide") {
      menu({
        ...place,
        label: "Guide",
        items: [
          { id: "x", label: "Add a guide down the middle", shortcut: key("add-in-middle"), edit: true },
          { id: "y", label: "Add a guide across the middle", shortcut: key("add-guide-across"), edit: true },
        ],
        onSelect: (id) => {
          if (store.getState().setTool("guide")) addGuideInMiddle(store, id === "y" ? "y" : "x");
        },
      });
      return;
    }
    const [kinds, current]: [readonly ShapeTool[], ShapeTool] = of === "shape" ? [BOX_SHAPES, shapeTool] : [LINE_TOOLS, lineTool];
    menu({
      ...place,
      label: of === "shape" ? "Shapes" : "Line or arrow",
      items: [
        ...kinds.map((s) => ({ id: s, label: SHAPE_TOOL_NAME[s], radio: true, checked: s === current })),
        { id: ADD, label: `Add ${withArticle(SHAPE_TOOL_NAME[current])} in the middle`, shortcut: key("add-in-middle"), separatorBefore: true, edit: true },
      ],
      onSelect: (id) => {
        const state = store.getState();
        if (!state.setTool(of)) return;
        if (id === ADD) addShapeInMiddle(store, { seconds: () => settings.getState().textSeconds, color: () => brandColor });
        else if (of === "shape") state.setShapeTool(id as BoxShape);
        else state.setLineTool(id as LineTool);
      },
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // ArrowRight on the Shape, Line or Guide button opens its list.
    const of = (e.target as HTMLElement).dataset.tool;
    if (e.key === "ArrowRight" && (of === "shape" || of === "line" || of === "guide")) {
      e.preventDefault();
      e.stopPropagation();
      openList(e.target as HTMLElement, of);
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
    <IconButton data-edit-control label={label} shortcut={shortcut} tipSide="right" disabled={disabled} tabIndex={stop === index ? 0 : -1} onClick={run}>
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
        // A button that draws more than one thing shows what it draws now and a corner mark, and a right-click or
        // ArrowRight opens its list.
        const of = t === "shape" || t === "line" || t === "guide" ? t : null;
        const other: LineTool = lineTool === "line" ? "arrow" : "line";
        const listProps = of && {
          "data-tool": of,
          "aria-haspopup": "menu" as const,
          className: "relative",
          onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
            e.preventDefault();
            openList(e.currentTarget, of);
          },
        };
        return (
          <IconButton
            key={t}
            {...(needsEdit && { "data-edit-control": true })}
            label={of === "shape" ? `Shape: ${SHAPE_TOOL_NAME[shapeTool]}` : of === "line" ? SHAPE_TOOL_NAME[lineTool] : look.label}
            shortcut={key(of === "line" && lineTool === "arrow" ? "tool-arrow" : look.command)}
            hint={
              of === "shape" ? "Drag on the preview; click again for more shapes"
              : of === "line" ? `Drag on the preview; click again for ${other === "line" ? "a line" : "an arrow"}`
              : of === "guide" ? "Drag on the preview; click again to add one in the middle"
              : undefined
            }
            tipSide="right"
            pressed={tool === t}
            disabled={needsEdit && !canEdit}
            tabIndex={stop === i ? 0 : -1}
            onClick={(e) => {
              const state = store.getState();
              if ((of === "shape" || of === "guide") && tool === of) openList(e.currentTarget, of);
              else if (of === "line" && tool === "line") state.setLineTool(other);
              else state.setTool(t);
            }}
            {...listProps}
          >
            {of === "shape" ? SHAPE_ICON[shapeTool] : of === "line" ? SHAPE_ICON[lineTool] : look.icon}
            {of && <span aria-hidden className="pointer-events-none absolute right-[3px] bottom-[3px] size-0 border-b-4 border-l-4 border-b-current border-l-transparent opacity-70" />}
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
