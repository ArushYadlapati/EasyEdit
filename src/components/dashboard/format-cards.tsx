"use client";

import { Ellipsis } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { DISABLED, FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { FORMAT_PRESETS, FORMAT_USES } from "@/lib/timeline/presets";
import { PresetId, type FormatId } from "@/lib/timeline/types";

const CHOICES: FormatId[] = [...PresetId.options, "custom"];

const NEXT_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

// The format of a new project, as a radio group of cards: one per named size, with a small outline in its
// shape, its label and where it is usually posted, then "Custom size". Keys and focus work as in Segmented: only the
// chosen card is in the tab order, and the arrow keys move the choice, wrapping at either end.
export function FormatCards({ value, onChange, disabled }: { value: FormatId; onChange(format: FormatId): void; disabled?: boolean }): ReactNode {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const by = NEXT_KEYS[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const next = (index + by + CHOICES.length) % CHOICES.length;
    cards.current[next]?.focus();
    onChange(CHOICES[next]);
  }

  return (
    <div role="radiogroup" aria-label="Format" aria-disabled={disabled || undefined} className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
      {CHOICES.map((format, index) => {
        const chosen = format === value;
        return (
          <button
            key={format}
            ref={(el) => {
              cards.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            disabled={disabled}
            className={cx(
              "flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2 text-left select-none",
              chosen ? "border-ed-accent bg-ed-accent-weak" : "border-ed-line bg-ed-raised enabled:hover:bg-ed-hover",
              FOCUS_RING,
              FADE,
              DISABLED,
            )}
            onClick={() => {
              if (!chosen) onChange(format);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span aria-hidden className={cx("flex size-5 shrink-0 items-center justify-center", chosen ? "text-ed-accent" : "text-ed-muted")}>
              {format === "custom" ? <Ellipsis aria-hidden size={16} strokeWidth={1.75} /> : <Shape {...FORMAT_PRESETS[format]} />}
            </span>
            {format === "custom" ? (
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium text-ed-text">Custom size</span>{" "}
                <span className="truncate text-[11px] text-ed-muted">Any size</span>
              </span>
            ) : (
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium text-ed-text">{FORMAT_PRESETS[format].label}</span>{" "}
                <span className="truncate text-[11px] text-ed-muted">{FORMAT_USES[format]}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// An outline in a size's shape, its longer side filling the icon's box.
function Shape({ width, height }: { width: number; height: number }) {
  return (
    <span
      data-format-shape
      className="rounded-[2px] border-[1.5px] border-current"
      style={{ aspectRatio: `${width} / ${height}`, [width >= height ? "width" : "height"]: "100%" }}
    />
  );
}
