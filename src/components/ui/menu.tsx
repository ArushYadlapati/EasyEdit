"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  Fragment, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject,
} from "react";
import { DISABLED, FADE, FOCUS_RING, cx } from "./cx";
import { IconButton, type IconButtonProps } from "./icon-button";

// shortcut: a key hint drawn at the right, not part of the item's name. checked: a switch, drawn
// with a check mark. radio: one choice of several, drawn the same way (checked marks the current one).
// separatorBefore: a rule above the item. edit: it changes the project, so its button is marked as an
// edit control.
export type MenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  checked?: boolean;
  radio?: boolean;
  separatorBefore?: boolean;
  edit?: boolean;
};

export type MenuProps = Omit<IconButtonProps, "label" | "children" | "pressed" | "onSelect"> & {
  label: string;
  icon?: ReactNode; // without one, the button shows the label as text
  text?: string; // a text button's visible text, with a chevron after it, when it differs from the label (which still names it)
  title?: string; // a text button's tooltip; an icon button's is its label
  lead?: ReactNode; // a text button only: drawn before its text, such as the person's picture
  items: MenuItem[] | (() => MenuItem[]); // a function is called each time the menu opens
  onSelect(id: string): void;
};

const GAP = 4; // between the button and the list
const EDGE = 8; // the list keeps this far from the window's edges

function enabledItems(list: HTMLElement | null): HTMLButtonElement[] {
  return [...(list?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
}

// A button that opens a list of actions under it: an icon button, or a text button showing its label (or its
// own text and a chevron, still named by the label), after its lead when it has one.
// The arrow keys, Home and End move between the items. Escape, a click outside or picking an item
// closes it, and focus goes back to the button. Items given as a function are read as the menu opens
// and kept while it is open. Extra props go on the button.
export function Menu({ label, icon, text, title, lead, items, onSelect, disabled, shortcut, className, onClick, onKeyDown, ...rest }: MenuProps) {
  const [openAt, setOpenAt] = useState<"first" | "last" | null>(null);
  const [opened, setOpened] = useState<MenuItem[]>([]);
  // Turning disabled closes the menu for good, so enabling it again does not reopen it.
  if (disabled && openAt !== null) setOpenAt(null);
  const open = openAt !== null && !disabled;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const shown = typeof items === "function" ? opened : items;

  function openList(at: "first" | "last") {
    if (!open && typeof items === "function") setOpened(items());
    setOpenAt(at);
  }

  function close(refocus: boolean) {
    setOpenAt(null);
    if (refocus) trigger.current?.focus();
  }

  // Placed under the button, or above it when there is no room below, inside the window.
  function place(size: DOMRect) {
    const anchor = trigger.current!.getBoundingClientRect();
    let top = anchor.bottom + GAP;
    if (top + size.height > window.innerHeight - EDGE) top = Math.max(EDGE, anchor.top - GAP - size.height);
    let left = anchor.left;
    if (left + size.width > window.innerWidth - EDGE) left = Math.max(EDGE, anchor.right - size.width);
    return { top, left };
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (list.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpenAt(null);
      // A click on something that takes focus keeps it; otherwise focus comes back to the button.
      setTimeout(() => {
        if (document.activeElement === document.body && trigger.current?.isConnected) trigger.current.focus();
      }, 0);
    }
    function onScroll(event: Event) {
      if (!list.current?.contains(event.target as Node)) setOpenAt(null);
    }
    function onResize() {
      setOpenAt(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openList(event.key === "ArrowDown" ? "first" : "last");
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close(false);
    }
  }

  const triggerProps = {
    ref: trigger,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    disabled,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (open) setOpenAt(null);
      else openList("first");
    },
    onKeyDown: handleTriggerKeyDown,
    ...rest,
  } as const;

  return (
    <span className="relative inline-flex">
      {icon ? (
        <IconButton
          label={label}
          shortcut={shortcut}
          className={cx("aria-expanded:bg-ed-hover aria-expanded:text-ed-text", className)}
          {...triggerProps}
        >
          {icon}
        </IconButton>
      ) : (
        <button
          type="button"
          aria-label={text === undefined ? undefined : label}
          title={title ?? (shortcut ? `${label} (${shortcut})` : undefined)}
          className={cx(
            "inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-medium text-ed-muted select-none",
            lead !== undefined && "gap-1.5",
            "enabled:hover:bg-ed-hover enabled:hover:text-ed-text aria-expanded:bg-ed-hover aria-expanded:text-ed-text",
            FOCUS_RING,
            FADE,
            DISABLED,
            className,
          )}
          {...triggerProps}
        >
          {lead}
          {text === undefined ? (
            label
          ) : (
            <>
              {text}
              <ChevronDown aria-hidden size={12} />
            </>
          )}
        </button>
      )}
      {open && openAt && (
        <MenuList
          ref={list}
          id={menuId}
          label={label}
          items={shown}
          openAt={openAt}
          place={place}
          onPick={(id) => {
            close(true);
            onSelect(id);
          }}
          onDismiss={close}
        />
      )}
    </span>
  );
}

export type MenuListProps = {
  label: string;
  items: MenuItem[];
  openAt: "first" | "last"; // the enabled item that takes focus
  place(size: DOMRect): { top: number; left: number }; // where the list goes, given its size
  onPick(id: string): void;
  onDismiss(refocus: boolean): void; // Escape (true) or Tab (false)
  id?: string;
  ref?: RefObject<HTMLDivElement | null>; // for a host that needs the list, as for a press outside it
};

// The list of a menu, fixed on screen where place puts it, so panels that clip their overflow do not cut it.
// It focuses its first or last enabled item, or itself when nothing is enabled, so Escape still reaches it.
// The arrow keys, Home and End move between the enabled items. Its host decides what a pick or a dismissal does.
export function MenuList({ label, items, openAt, place, onPick, onDismiss, id, ref }: MenuListProps): ReactNode {
  const own = useRef<HTMLDivElement>(null);
  const list = ref ?? own;
  // When any item is a switch or a choice, every item keeps a column for the check, so the labels line up.
  const checkable = items.some((item) => item.checked !== undefined);
  const placeNow = useEffectEvent(place);

  useLayoutEffect(() => {
    const menu = list.current!;
    const { top, left } = placeNow(menu.getBoundingClientRect());
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.visibility = "visible";
    const choices = enabledItems(menu);
    const first = openAt === "last" ? choices.at(-1) : choices[0];
    if (first) first.focus();
    else menu.focus();
  }, [list, openAt]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const choices = enabledItems(list.current);
    const at = choices.indexOf(document.activeElement as HTMLButtonElement);
    const n = choices.length;
    const moves: Record<string, () => number> = {
      ArrowDown: () => (at + 1) % n,
      ArrowUp: () => (at <= 0 ? n - 1 : at - 1),
      Home: () => 0,
      End: () => n - 1,
    };
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss(true);
    } else if (event.key === "Tab") {
      onDismiss(false);
    } else if (moves[event.key]) {
      event.preventDefault();
      if (n > 0) choices[moves[event.key]()].focus();
    }
  }

  return (
    <div
      ref={list}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ visibility: "hidden" }}
      className="fixed z-50 flex max-h-[min(24rem,calc(100dvh-1rem))] min-w-40 flex-col overflow-y-auto rounded-md border border-ed-line bg-ed-raised py-1 shadow-lg outline-none"
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore && <div role="separator" className="my-1 h-px shrink-0 bg-ed-line" />}
          <button
            type="button"
            role={item.radio ? "menuitemradio" : item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            aria-checked={item.radio ? !!item.checked : item.checked}
            data-edit-control={item.edit || undefined}
            tabIndex={-1}
            disabled={item.disabled}
            className={cx(
              "flex h-7 shrink-0 items-center gap-2 px-3 text-left text-xs whitespace-nowrap select-none",
              item.danger ? "text-ed-danger" : "text-ed-text",
              "enabled:hover:bg-ed-hover focus-visible:bg-ed-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ed-accent",
              "disabled:cursor-not-allowed disabled:opacity-40",
              FADE,
            )}
            onClick={() => onPick(item.id)}
          >
            {checkable && (
              <span data-check aria-hidden className="flex w-4 shrink-0 justify-center">
                {item.checked && <Check size={14} strokeWidth={2} />}
              </span>
            )}
            {item.label}
            {item.shortcut && (
              <span data-shortcut aria-hidden className="ml-auto pl-6 text-ed-muted">
                {item.shortcut}
              </span>
            )}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
