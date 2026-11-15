"use client";

import { ChevronDown } from "lucide-react";
import { useId, useSyncExternalStore, type ReactNode } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { SECTIONS_KEY, readCollapsed, withToggled, writeCollapsed, type SectionId } from "@/lib/dashboard/sidebar-sections";

// A section of the dashboard's sidebar that its heading hides and shows, remembered in this browser.

// Sent on this page when a section is toggled, so every section reads the new list; other tabs get "storage".
const TOGGLED = "easyedit:sidebar-sections";
// The list when the browser's storage refuses reads or writes, for this page only.
let fallback = "";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(TOGGLED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(TOGGLED, onChange);
  };
}

function saved(): string {
  try {
    return window.localStorage.getItem(SECTIONS_KEY) ?? fallback;
  } catch {
    return fallback;
  }
}

// The server and the page's first render draw every section open; a saved choice applies right after.
const nothingSaved = () => "";

const listIn = (raw: string) => readCollapsed({ getItem: () => (raw === "" ? null : raw) });

export function useCollapsed(id: SectionId): [collapsed: boolean, toggle: () => void] {
  const raw = useSyncExternalStore(subscribe, saved, nothingSaved);
  function toggle() {
    const next = withToggled(listIn(saved()), id);
    fallback = JSON.stringify(next);
    writeCollapsed({ setItem: (key, value) => window.localStorage.setItem(key, value) }, next);
    window.dispatchEvent(new Event(TOGGLED));
  }
  return [listIn(raw).has(id), toggle];
}

// A heading of the sidebar: small capitals beside the list on a wide window, and kept for screen readers only on a
// narrow one, where the sidebar is a single row.
const HEADING = "sr-only text-[11px] font-semibold tracking-wide text-ed-muted uppercase md:not-sr-only md:pl-2";

// The heading, with a chevron that hides or shows the items, and any action (such as New folder) at the row's end. On
// a narrow window the sidebar is one row with its headings for screen readers only, so the items always show there and
// the row's box is not drawn (its heading and action are items of the row).
export function SidebarSection({ id, label, action, className, children }: {
  id: SectionId;
  label: string;
  action?: ReactNode;
  className?: string; // for the heading's row on a wide window, such as the space above it
  children: ReactNode;
}): ReactNode {
  const [collapsed, toggle] = useCollapsed(id);
  const headingId = useId();
  const itemsId = useId();
  return (
    <>
      <div className={cx("contents md:flex md:items-center md:gap-1 md:pb-1", className)}>
        {/* The heading's text hides and shows the items too, for a pointer; the chevron is the control for keys. */}
        <h2 id={headingId} className={cx(HEADING, "md:cursor-pointer md:select-none")} onClick={toggle}>
          {label}
        </h2>
        <button
          type="button"
          aria-labelledby={headingId}
          aria-expanded={!collapsed}
          aria-controls={itemsId}
          onClick={toggle}
          className={cx("hidden size-4 items-center justify-center rounded text-ed-muted hover:text-ed-text md:mr-auto md:flex", FOCUS_RING, FADE)}
        >
          <ChevronDown aria-hidden className={cx("size-3 transition-transform motion-reduce:transition-none", collapsed && "-rotate-90")} />
        </button>
        {action}
      </div>
      <div id={itemsId} className={cx("contents", collapsed && "md:hidden")}>
        {children}
      </div>
    </>
  );
}
