import { DISABLED, FADE, FOCUS_RING, cx } from "./cx";

// Button's classes, in a plain module (no "use client") so server-rendered files can use them too: a function from a
// "use client" module is only a reference on the server, and calling it there fails at request time.

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  default: "border border-ed-line bg-ed-raised text-ed-text enabled:hover:bg-ed-hover",
  primary: "border border-ed-accent bg-ed-accent text-ed-bg enabled:hover:bg-ed-accent/85",
  ghost: "border border-transparent text-ed-text enabled:hover:bg-ed-hover",
  danger: "border border-ed-line bg-ed-raised text-ed-danger enabled:hover:bg-ed-hover",
};

const SIZES: Record<ButtonSize, string> = { sm: "h-6 px-2", md: "h-7 px-3" };

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap select-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:stroke-[1.75]";

// A <button>'s look.
export function buttonClass(variant: ButtonVariant = "default", size: ButtonSize = "md", className?: string): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], FOCUS_RING, FADE, DISABLED, className);
}

// Button's look, for a link: its hover isn't kept for enabled controls, which a link never is.
export function linkButtonClass(variant: "default" | "primary" = "default", className?: string): string {
  return cx(BASE, VARIANTS[variant].replaceAll("enabled:hover:", "hover:"), SIZES.md, FOCUS_RING, FADE, className);
}
