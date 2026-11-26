"use client";

import { Search } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { FADE, FOCUS_RING_INSET, cx } from "@/components/ui/cx";
import { searchFeatures, type SearchItem } from "@/lib/editor/search";
import { useShortcutLabel } from "./use-shortcuts";

type FeatureSearchProps = {
  items(): SearchItem[]; // read as the list opens and as the query changes, so it says what can run right then
  onRun(item: SearchItem): void;
  inputRef?: RefObject<HTMLInputElement | null>; // the search key focuses it
  className?: string;
};

// The top bar's search field. Focusing it opens a list of everything it can find, grouped; typing narrows it to the
// best matches. The arrow keys move through the results while focus stays in the field, Enter or a click runs one, and
// Escape closes the list and hands focus back to where it was, so the editor's keys work again. What cannot run right
// now is listed greyed and does nothing.
export function FeatureSearch({ items, onRun, inputRef, className }: FeatureSearchProps) {
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<SearchItem[]>([]);
  const [active, setActive] = useState(0);
  const returnTo = useRef<HTMLElement | null>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;
  const keyFor = useShortcutLabel();
  const results = useMemo(() => searchFeatures(all, query), [all, query]);
  const searchKey = keyFor("search");

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
    // optionId only joins listId, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function show(nextQuery: string) {
    setAll(items());
    setQuery(nextQuery);
    setActive(0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  // Focus goes back where it came from (or nowhere) before the action runs, so a dialog or field the action opens
  // keeps the focus it takes.
  function leave() {
    close();
    const back = returnTo.current;
    returnTo.current = null;
    input.current?.blur();
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  function run(item: SearchItem | undefined) {
    if (!item || item.disabled) return;
    leave();
    onRun(item);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const n = results.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return show(query);
      if (n > 0) setActive((at) => (event.key === "ArrowDown" ? (at + 1) % n : (at - 1 + n) % n));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open) run(results[active]);
      else show(query);
    } else if (event.key === "Escape") {
      event.preventDefault();
      leave();
    } else if (event.key === "Tab") {
      close();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      // The search key again: the field is already here, so its text is chosen for typing over.
      event.preventDefault();
      event.currentTarget.select();
    }
  }

  const grouped = query.trim() === "";

  return (
    <div className={cx("relative", className)}>
      <Search aria-hidden size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ed-muted" />
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label="Search tools and actions"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length > 0 ? optionId(active) : undefined}
        placeholder="Search tools and actions"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => show(e.target.value)}
        onFocus={(e) => {
          returnTo.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
          show("");
        }}
        onBlur={close}
        onKeyDown={onKeyDown}
        className={cx(
          "peer h-7 w-full min-w-0 rounded-md border border-ed-field-line bg-ed-bg pr-12 pl-7 text-xs leading-5 text-ed-text placeholder:text-ed-muted",
          "focus:bg-ed-raised",
          FOCUS_RING_INSET,
          FADE,
        )}
      />
      {searchKey && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[4px] border border-ed-line px-1 font-sans text-[11px] leading-4 text-ed-muted peer-focus:hidden"
        >
          {searchKey}
        </kbd>
      )}
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          className="absolute top-full left-1/2 z-50 mt-1 flex max-h-[min(24rem,calc(100dvh-4rem))] w-[max(100%,26rem)] -translate-x-1/2 flex-col overflow-y-auto rounded-md border border-ed-line bg-ed-raised py-1 shadow-lg"
          // A press in the list keeps focus in the field, so the list stays open until the click picks.
          onMouseDown={(e) => e.preventDefault()}
        >
          {results.length === 0 && <p className="px-3 py-2 text-xs text-ed-muted">No results for “{query.trim()}”</p>}
          {results.map((item, i) => {
            const heading = grouped && (i === 0 || results[i - 1].group !== item.group);
            const shortcut = item.command ? keyFor(item.command) : "";
            return (
              <Fragment key={item.id}>
                {heading && (
                  <div aria-hidden className={cx("px-3 pt-2 pb-1 text-[11px] leading-4 font-medium text-ed-muted", i > 0 && "mt-1 border-t border-ed-line")}>
                    {item.group}
                  </div>
                )}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={item.disabled || undefined}
                  className={cx(
                    "flex h-7 shrink-0 cursor-default items-center gap-2 px-3 text-xs whitespace-nowrap text-ed-text select-none",
                    i === active && "bg-ed-hover",
                    item.disabled && "cursor-not-allowed opacity-40",
                  )}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(item)}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.checked !== undefined && <span className="text-ed-muted">{item.checked ? "On" : "Off"}</span>}
                  <span className="ml-auto flex shrink-0 items-center gap-3 pl-4 text-ed-muted">
                    {item.disabled && item.note && <span>{item.note}</span>}
                    {!grouped && <span>{item.group}</span>}
                    {shortcut && <span aria-hidden>{shortcut}</span>}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
