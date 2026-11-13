"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { IconButton } from "./icon-button";

export type DialogProps = {
  title: string;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  className?: string;
  bar?: ReactNode; // between the header and the body, and does not scroll with the body, such as a row of tabs
  size?: "md" | "lg"; // lg takes most of the window, at a fixed height, so a footer sits at its bottom
  footer?: ReactNode; // after the body, and does not scroll with it, such as the dialog's buttons
};

const SIZES = {
  md: "max-h-[min(80vh,640px)] w-[min(32rem,calc(100vw-32px))]",
  // The last width term keeps a 16 px gutter on a phone.
  lg: "h-[min(92dvh,760px)] max-h-[min(92dvh,760px)] w-[min(92vw,1120px,calc(100vw-32px))]",
};

// A modal on the native <dialog>, so focus stays inside it and the page behind is inert. Escape and
// the Close button ask the caller to close it through onClose; open decides. On opening, focus goes to
// the first element marked data-autofocus, a field's text selected so typing replaces it; with none
// marked, the browser's choice stands. React's autoFocus cannot do this: the contents mount while the
// dialog is still closed.
export function Dialog({ title, open, onClose, children, className, bar, size = "md", footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const marked = dialog.querySelector<HTMLElement>("[data-autofocus]");
      marked?.focus();
      if (marked instanceof HTMLInputElement) marked.select();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cx(
        "m-auto",
        SIZES[size],
        "flex-col rounded-md border border-ed-line bg-ed-panel p-0 text-ed-text shadow-2xl open:flex backdrop:bg-ed-bg/70",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
      onCancel={(event) => {
        // Any other close request (such as a back gesture) also goes through the caller.
        event.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <header className="flex shrink-0 items-center gap-2 border-b border-ed-line py-2 pr-2 pl-4">
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose}>
              <X />
            </IconButton>
          </header>
          {bar && <div className="shrink-0 border-b border-ed-line px-3 py-2">{bar}</div>}
          <div className={cx("min-h-0 overflow-y-auto p-4 text-[13px] leading-5", size === "lg" && "flex-1")}>{children}</div>
          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ed-line px-4 py-3">{footer}</div>
          )}
        </>
      )}
    </dialog>
  );
}
