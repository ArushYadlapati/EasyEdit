"use client";

import { ChevronDown } from "lucide-react";
import { createContext, useContext, useId, useSyncExternalStore, type ReactNode } from "react";
import { readCookie } from "@/components/editor/browser-prefs";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { SECTIONS_COOKIE, formatCollapsed, parseCollapsed, withToggled, type SectionId } from "@/lib/dashboard/sidebar-sections";

// A section of the dashboard's sidebar that its heading hides and shows, remembered in this browser's cookie.

const YEAR_SECONDS = 31_536_000;

// The cookie as the server read it for this page, so the first paint and hydration draw the folded sections folded.
const ServerCollapsedContext = createContext<string | undefined>(undefined);

export function CollapsedSectionsProvider({ value, children }: { value: string | undefined; children: ReactNode }): ReactNode {
  return <ServerCollapsedContext value={value}>{children}</ServerCollapsedContext>;
}

// Sent on this page when a section is toggled, so every section reads the new list.
const TOGGLED = "easyedit:sidebar-sections";

// The list this page shows when the browser refused or ignored a write: it holds while the cookie still reads as it
// did then, and gives way once the cookie changes.
let unsaved: { cookieWas: string | null; value: string } | null = null;

function subscribe(onChange: () => void): () => void {
  window.addEventListener(TOGGLED, onChange);
  return () => window.removeEventListener(TOGGLED, onChange);
}

function current(): string {
  const cookie = readCookie(SECTIONS_COOKIE);
  if (unsaved && unsaved.cookieWas === cookie) return unsaved.value;
  return cookie ?? "";
}

function save(value: string): void {
  try {
    document.cookie = `${SECTIONS_COOKIE}=${value}; path=/s; max-age=${YEAR_SECONDS}; samesite=lax`;
  } catch {
    // Cookies are blocked here.
  }
  const after = readCookie(SECTIONS_COOKIE);
  unsaved = after === value ? null : { cookieWas: after, value };
}

export function useCollapsed(id: SectionId): [collapsed: boolean, toggle: () => void] {
  const server = useContext(ServerCollapsedContext) ?? "";
  const value = useSyncExternalStore(subscribe, current, () => server);
  function toggle() {
    save(formatCollapsed(withToggled(parseCollapsed(current()), id)));
    window.dispatchEvent(new Event(TOGGLED));
  }
  return [parseCollapsed(value).has(id), toggle];
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
          className={cx(
            // 24px to hit, its negative margins keeping the 16px it takes in the row (and the chevron where it was).
            "-my-1 -ml-1 hidden size-6 items-center justify-center rounded text-ed-muted hover:text-ed-text md:mr-auto md:flex",
            FOCUS_RING,
            FADE,
          )}
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
