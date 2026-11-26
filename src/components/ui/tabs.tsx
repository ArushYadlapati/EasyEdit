"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { FADE, FOCUS_RING, cx } from "./cx";

export type TabsProps = {
  label: string;
  value: string;
  // icon: drawn before the name in data-tab-icon, the name in data-tab-label, so a narrow row can show one or the other
  // (the tab is named by its label either way).
  tabs: { id: string; label: string; icon?: ReactNode }[];
  onChange(id: string): void;
  idPrefix?: string; // given: each tab controls the panel with id tabIds(idPrefix, id).panel
  autoFocusSelected?: boolean; // marks the selected tab data-autofocus, so a Dialog focuses it on opening
  className?: string;
  compact?: boolean; // tighter padding, for a narrow panel
  dense?: boolean; // tighter still, and closer together: four tabs in the editor's narrowest side panel
  wrap?: boolean; // tabs that don't fit go onto another row, each read in full, rather than being cut off
};

// The ids that link a tab and the one panel the caller renders under the tabs. Every tab controls
// that panel; the panel takes its name from the tab that is showing.
export function tabIds(idPrefix: string, tabId: string): { tab: string; panel: string } {
  return { tab: `${idPrefix}-tab-${tabId}`, panel: `${idPrefix}-panel` };
}

const KEY_MOVES: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

// A row of tabs. The arrow keys, Home and End move to a tab and show it. The caller renders the
// panel: role="tabpanel", with id and aria-labelledby from tabIds(idPrefix, value).
export function Tabs({ label, value, tabs, onChange, idPrefix, autoFocusSelected = false, className, compact = false, dense = false, wrap = false }: TabsProps) {
  const ownPrefix = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = tabs.findIndex((t) => t.id === value);
  const tabStop = current === -1 ? 0 : current;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = KEY_MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    const next = move(index, tabs.length);
    buttons.current[next]?.focus();
    if (tabs[next].id !== value) onChange(tabs[next].id);
  }

  return (
    <div role="tablist" aria-label={label} className={cx("flex min-w-0 items-center", dense ? "gap-0.5" : "gap-1", wrap && "flex-wrap", className)}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          id={tabIds(idPrefix ?? ownPrefix, tab.id).tab}
          type="button"
          role="tab"
          aria-controls={idPrefix === undefined ? undefined : tabIds(idPrefix, tab.id).panel}
          aria-selected={tab.id === value}
          aria-label={tab.icon ? tab.label : undefined}
          data-autofocus={autoFocusSelected && tab.id === value ? "" : undefined}
          tabIndex={index === tabStop ? 0 : -1}
          className={cx(
            "h-7 rounded-md text-xs font-medium text-ed-muted select-none hover:bg-ed-hover hover:text-ed-text",
            wrap ? "whitespace-nowrap" : "truncate",
            dense ? "px-1.5" : compact ? "px-2" : "px-3",
            "aria-selected:bg-ed-accent-weak aria-selected:text-ed-accent aria-selected:hover:bg-ed-accent-weak aria-selected:hover:text-ed-accent",
            FOCUS_RING,
            FADE,
          )}
          onClick={() => {
            if (tab.id !== value) onChange(tab.id);
          }}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {tab.icon ? (
            <>
              <span aria-hidden data-tab-icon className="flex items-center justify-center [&_svg]:size-4">
                {tab.icon}
              </span>
              <span data-tab-label>{tab.label}</span>
            </>
          ) : (
            tab.label
          )}
        </button>
      ))}
    </div>
  );
}
