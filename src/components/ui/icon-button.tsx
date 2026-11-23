"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { DISABLED, FADE, FOCUS_RING, cx } from "./cx";
import { Tip, useTip, type TipSide } from "./tooltip";

export type IconButtonProps = Omit<ComponentProps<"button">, "children" | "aria-label" | "title"> & {
  label: string; // the accessible name and the tooltip
  shortcut?: string; // shown in the tooltip, in parentheses after the label
  hint?: string; // a second, quieter line in the tooltip: what else the button does
  tipSide?: TipSide; // where the tooltip goes: under the button, or to its right for a button in a vertical strip
  pressed?: boolean; // a toggle: sets aria-pressed and the selected look
  children: ReactNode; // the icon
};

// A 28 × 28 button with a 16 px icon. The icon itself is hidden from screen readers; the label names the button, and
// the shortcut and hint describe it, from a line of text nobody sees. Its tooltip is the app's own, so it shows
// quickly. A disabled button gets no pointer events in some browsers, so it keeps the browser's title tooltip.
export function IconButton({
  label, shortcut, hint, tipSide = "bottom", pressed, type = "button", className, children,
  disabled, onPointerEnter, onPointerLeave, onPointerDown, onFocus, onBlur, onKeyDown, ...rest
}: IconButtonProps) {
  const tip = useTip(!disabled);
  const id = useId();
  const named = shortcut ? `${label} (${shortcut})` : label;
  const described = hint ? `${named}. ${hint}` : named;
  const describes = described !== label && !disabled; // a disabled button's title already describes it
  return (
    <button
      type={type}
      aria-label={label}
      aria-describedby={describes ? id : undefined}
      title={disabled ? described : undefined}
      aria-pressed={pressed}
      disabled={disabled}
      onPointerEnter={(e) => {
        tip.enter(e.pointerType);
        onPointerEnter?.(e);
      }}
      onPointerLeave={(e) => {
        tip.hide();
        onPointerLeave?.(e);
      }}
      onPointerDown={(e) => {
        tip.hide();
        onPointerDown?.(e);
      }}
      onFocus={(e) => {
        tip.focus(e.currentTarget);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        tip.hide();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") tip.hide();
        onKeyDown?.(e);
      }}
      className={cx(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-ed-muted select-none",
        "enabled:hover:bg-ed-hover enabled:hover:text-ed-text",
        "aria-pressed:bg-ed-accent-weak aria-pressed:text-ed-accent enabled:aria-pressed:hover:bg-ed-accent-weak",
        "[&>svg]:pointer-events-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:stroke-[1.75]",
        FOCUS_RING,
        FADE,
        DISABLED,
        className,
      )}
      {...rest}
    >
      {children}
      {describes && (
        <span id={id} hidden>
          {described}
        </span>
      )}
      {tip.open && (
        <Tip side={tipSide}>
          {named}
          {hint && <span className="block font-normal text-ed-muted">{hint}</span>}
        </Tip>
      )}
    </button>
  );
}
