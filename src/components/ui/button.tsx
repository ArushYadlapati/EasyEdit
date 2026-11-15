"use client";

import type { ComponentProps } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button-class";

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

// The classes live in button-class.ts, which server-rendered files import directly (linkButtonClass for a link).
export function Button({ variant = "default", size = "md", type = "button", className, ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
