"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";

// One key, or one mouse action, as a small chip. Dim shows a key that does nothing right now.
export function Kbd({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-ed-line bg-ed-raised px-1.5 font-sans text-[11px] leading-4 font-medium text-ed-text",
        dim && "opacity-40",
      )}
    >
      {children}
    </kbd>
  );
}
