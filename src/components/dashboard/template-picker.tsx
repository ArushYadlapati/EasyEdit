"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { BlankFrame } from "@/components/dashboard/blank-frame";
import { DISABLED, FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import type { TemplateSummary } from "@/lib/templates/types";
import { FORMAT_PRESETS } from "@/lib/timeline/presets";

const NEXT_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

// "Vertical 9:16 · 1080×1920", or "Custom size · 1000×700" for a size with no name.
export function templateFormatLine(template: Pick<TemplateSummary, "format" | "width" | "height">): string {
  const label = template.format === "custom" ? "Custom size" : FORMAT_PRESETS[template.format].label;
  return `${label} · ${template.width}×${template.height}`;
}

export const slotCount = (n: number) => `${n} ${n === 1 ? "slot" : "slots"}`;

// What a new project starts from, as a radio group of cards: Blank first, then each template. Keys and focus work
// as in FormatCards: only the chosen card is in the tab order, and the arrow keys move the choice, wrapping.
export function TemplatePicker({
  templates,
  value,
  onChange,
}: {
  templates: readonly TemplateSummary[];
  value: string | null; // the chosen template's id, or null for Blank
  onChange(id: string | null): void;
}): ReactNode {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const choices: (TemplateSummary | null)[] = [null, ...templates];

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const by = NEXT_KEYS[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const next = (index + by + choices.length) % choices.length;
    cards.current[next]?.focus();
    onChange(choices[next]?.id ?? null);
  }

  return (
    <div role="radiogroup" aria-label="Start from" className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
      {choices.map((template, index) => {
        const chosen = (template?.id ?? null) === value;
        return (
          <button
            key={template?.id ?? "blank"}
            ref={(el) => {
              cards.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            className={cx(
              "flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2 text-left select-none",
              chosen ? "border-ed-accent bg-ed-accent-weak" : "border-ed-line bg-ed-raised hover:bg-ed-hover",
              FOCUS_RING,
              FADE,
              DISABLED,
            )}
            onClick={() => {
              if (!chosen) onChange(template?.id ?? null);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span aria-hidden className="size-8 shrink-0">
              <BlankFrame width={template?.width ?? 1} height={template?.height ?? 1} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium text-ed-text">{template ? template.name : "Blank"}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ed-muted">
                <span className="truncate">{template ? slotCount(template.slots.length) : "Pick a format"}</span>
                {template?.builtIn && <span className="shrink-0 rounded-sm border border-ed-line px-1 text-[10px] leading-4">Starter</span>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
