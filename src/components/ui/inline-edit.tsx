"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { TextInput } from "./text-input";

type InlineEditProps = {
  defaultValue: string;
  label: string;
  maxLength: number;
  // value is null when Escape cancelled; byKey says whether a key ended it, so the caller can put focus back
  onDone(value: string | null, byKey: boolean): void;
  // When given, a value it refuses keeps the field open on Enter (marked invalid) and is dropped on blur.
  accepts?(value: string): boolean;
  className?: string;
} & InputHTMLAttributes<HTMLInputElement>;

// A text field shown in place of a name while it is renamed: mounted only while editing, it opens
// focused with its text selected. Enter or blur saves, Escape cancels, and it ends only once.
// Extra props go on the input.
export function InlineEdit({ defaultValue, label, maxLength, onDone, accepts, className, onChange, ...rest }: InlineEditProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const ended = useRef(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function end(value: string | null, byKey: boolean) {
    if (ended.current) return;
    ended.current = true;
    onDone(value, byKey);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // A key that picks or cancels an input method's text belongs to the input method.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (accepts && !accepts(event.currentTarget.value)) setInvalid(true);
      else end(event.currentTarget.value, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      end(null, true);
    }
  }

  return (
    <TextInput
      {...rest}
      ref={input}
      aria-label={label}
      defaultValue={defaultValue}
      maxLength={maxLength}
      aria-invalid={invalid || undefined}
      className={cx("aria-invalid:border-ed-danger aria-invalid:focus-visible:outline-ed-danger", className)}
      onKeyDown={onKeyDown}
      onChange={(event) => {
        setInvalid(false);
        onChange?.(event);
      }}
      onBlur={(event) => {
        // Leaving the window is not a click away: the field is still open, and focused, on return.
        if (!document.hasFocus()) return;
        const value = event.currentTarget.value;
        end(accepts && !accepts(value) ? null : value, false);
      }}
    />
  );
}
