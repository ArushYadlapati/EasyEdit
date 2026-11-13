"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useIsMac } from "@/components/editor/use-shortcuts";
import { FIELD_BOX, SCRUB_BOX, cx } from "./cx";

type Range = { min: number; max: number };
type Scrubbed = { scrubbed: true };

export type NumberInputProps = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "min" | "max" | "step" | "type" | "inputMode" | "aria-label"
> & {
  value: number;
  onCommit(value: number, how?: Scrubbed): void;
  // The typed number while it is valid, else null; a dragged value comes with { scrubbed: true }. false: the change
  // cannot be shown.
  onPreview?(value: number | null, how?: Scrubbed): boolean | void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string; // a unit shown inside the right edge, such as "%" or "s"
  ariaLabel?: string;
  scrub?: number; // the change per CSS px dragged sideways; with it the field also reads as a value
  scrubRange?: Range | (() => Range); // limits a drag only, read when the press starts; typing keeps min and max
  decimals?: number; // dragged and arrow values are rounded to this many places
};

// A press that travels further sideways is a drag, not a click.
export const SCRUB_SLOP_PX = 3;
const SCRUBBED: Scrubbed = { scrubbed: true };

// Up to four decimals, without the float noise of values such as 0.1 + 0.2.
function format(n: number): string {
  return String(Number(n.toFixed(4)));
}

function decimalPlaces(n: number): number {
  const text = String(n);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

const round = (n: number, places: number) => Number(n.toFixed(places));
const between = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// A press on the value, from pointerdown until it is let go, put back or dropped.
type Scrub = {
  input: HTMLInputElement;
  pointerId: number;
  x0: number;
  x: number;
  shift: boolean;
  fine: boolean; // Cmd or Ctrl
  perPx: number;
  origin: number; // the value at originX: the start, moved to where Shift or Cmd/Ctrl last changed
  originX: number;
  places: number;
  lo: number;
  hi: number;
  start: number;
  scrubbing: boolean; // the press has travelled further than SCRUB_SLOP_PX
  tried: number; // the value last worked out
  applied: number; // the value shown: the start, or the last one that applied
  frame: number | null;
  stop(): void; // removes the Escape listener and the pending frame, and lets the pointer go
};

// A text field for a number. What was typed is kept as a draft until Enter or blur commits it,
// so the field never fights the person typing. Without a draft it shows value.
// With scrub, it is also a value dragged sideways: Shift moves ten times as far, Cmd or Ctrl a tenth. A press that
// does not travel types instead, and Escape during a drag puts the value back.
export function NumberInput({
  value,
  onCommit,
  onPreview,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix,
  ariaLabel,
  scrub,
  scrubRange,
  decimals,
  className,
  disabled,
  onBlur,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onMouseDown,
  ...rest
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [scrubText, setScrubText] = useState<string | null>(null); // the dragged value, while a drag shows one
  const isMac = useIsMac();
  const press = useRef<Scrub | null>(null);
  // The callbacks of the latest render, for the animation frame and Escape, which run outside it.
  const latest = useRef({ onCommit, onPreview });
  useLayoutEffect(() => {
    latest.current = { onCommit, onPreview };
  });
  // Unmounted mid-drag: the frame and the Escape listener go with it.
  useEffect(() => () => press.current?.stop(), []);
  // Turned disabled mid-drag (editing taken away): dropped, as Escape does.
  if (disabled && scrubText !== null) setScrubText(null);
  useEffect(() => {
    const s = press.current;
    if (!disabled || !s) return;
    press.current = null;
    s.stop();
    latest.current.onPreview?.(null);
  }, [disabled]);

  function parse(text: string): number | null {
    let t = text.trim();
    if (suffix && t.endsWith(suffix)) t = t.slice(0, -suffix.length).trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  const clamp = (n: number) => between(n, min, max);

  function commit() {
    if (draft === null) return;
    setDraft(null);
    const n = parse(draft);
    const next = n === null ? value : clamp(n);
    if (next === value) onPreview?.(null);
    else onCommit(next);
  }

  function nudge(by: number) {
    const base = (draft === null ? null : parse(draft)) ?? value;
    const places = Math.min(10, Math.max(decimalPlaces(step), decimalPlaces(base)));
    const stepped = Number((base + by).toFixed(places));
    const next = clamp(decimals === undefined ? stepped : round(stepped, decimals));
    setDraft(null);
    if (next === value) onPreview?.(null);
    else onCommit(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      if (draft === null) return;
      event.preventDefault();
      setDraft(null);
      onPreview?.(null);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const steps = event.shiftKey ? 10 : 1;
      nudge((event.key === "ArrowUp" ? steps : -steps) * step);
    }
  }

  // Takes the press down. Returns it, or null when there was none.
  function end(): Scrub | null {
    const s = press.current;
    if (!s) return null;
    press.current = null;
    s.stop();
    return s;
  }

  // Escape, pointercancel or a lost capture: the value goes back to what it was.
  function cancel() {
    if (!end()) return;
    setScrubText(null);
    latest.current.onPreview?.(null);
  }

  // The value at the pointer, with the keys as they are now: each key scales only the movement after it.
  const at = (s: Scrub) => s.origin + (s.x - s.originX) * s.perPx * (s.shift ? 10 : s.fine ? 0.1 : 1);

  // The value at the pointer, at most once per animation frame. A value that cannot apply is not shown: the last one
  // that did stays, in the field and in what the change previews.
  function work(s: Scrub) {
    s.frame = null;
    const next = round(between(at(s), s.lo, s.hi), s.places);
    if (next === s.tried) return;
    s.tried = next;
    if (latest.current.onPreview?.(next, SCRUBBED) === false) {
      if (s.applied === s.start) latest.current.onPreview?.(null);
      else latest.current.onPreview?.(s.applied, SCRUBBED);
      return;
    }
    s.applied = next;
    setScrubText(format(next));
  }

  function handlePointerDown(event: PointerEvent<HTMLInputElement>) {
    onPointerDown?.(event);
    const input = event.currentTarget;
    if (scrub === undefined || event.button !== 0 || disabled || input.disabled || press.current) return;
    if (document.activeElement === input) return; // typing: the browser's own press
    if (isMac && event.ctrlKey) return; // a right-click: the field's own menu opens
    // Another field's draft is saved first, so its change is made before this one takes over.
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    event.preventDefault(); // no caret and no text selection
    input.setPointerCapture(event.pointerId);
    const range = typeof scrubRange === "function" ? scrubRange() : scrubRange;
    // Escape puts the value back before anything else hears it.
    const onKey = (key: globalThis.KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    const s: Scrub = {
      input,
      pointerId: event.pointerId,
      x0: event.clientX,
      x: event.clientX,
      shift: false,
      fine: false,
      perPx: scrub,
      origin: value,
      originX: event.clientX,
      places: decimals ?? 4,
      lo: Math.max(min, range?.min ?? -Infinity),
      hi: Math.min(max, range?.max ?? Infinity),
      start: value,
      scrubbing: false,
      tried: value,
      applied: value,
      frame: null,
      stop() {
        window.removeEventListener("keydown", onKey, true);
        if (s.frame !== null) cancelAnimationFrame(s.frame);
        s.frame = null;
        try {
          if (input.hasPointerCapture(s.pointerId)) input.releasePointerCapture(s.pointerId);
        } catch {
          // Already released.
        }
      },
    };
    press.current = s;
  }

  function handlePointerMove(event: PointerEvent<HTMLInputElement>) {
    onPointerMove?.(event);
    const s = press.current;
    if (!s || event.pointerId !== s.pointerId) return;
    const fine = event.metaKey || event.ctrlKey;
    if (event.shiftKey !== s.shift || fine !== s.fine) {
      // A key changed: the movement so far keeps the scale it had, from the value shown (an overshoot past the
      // limit is dropped, so the new scale moves the value at once).
      s.origin = between(at(s), s.lo, s.hi);
      s.originX = s.x;
    }
    s.x = event.clientX;
    s.shift = event.shiftKey;
    s.fine = fine;
    if (!s.scrubbing && Math.abs(s.x - s.x0) <= SCRUB_SLOP_PX) return;
    s.scrubbing = true;
    if (s.frame === null) s.frame = requestAnimationFrame(() => work(s));
  }

  function handlePointerUp(event: PointerEvent<HTMLInputElement>) {
    onPointerUp?.(event);
    const s = press.current;
    if (!s || event.pointerId !== s.pointerId) return;
    if (s.frame !== null) {
      // Let go before the frame ran: worked out now.
      cancelAnimationFrame(s.frame);
      work(s);
    }
    end();
    setScrubText(null);
    if (!s.scrubbing) {
      // A click: type in the field, its text selected.
      s.input.focus();
      s.input.select();
    } else if (s.applied !== s.start) latest.current.onCommit(s.applied, SCRUBBED);
    else latest.current.onPreview?.(null);
  }

  return (
    <span className={cx("relative flex min-w-0", className)}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        className={cx(scrub === undefined ? FIELD_BOX : SCRUB_BOX, "peer h-7 tabular-nums", suffix && "pr-7")}
        disabled={disabled}
        value={scrubText ?? draft ?? format(value)}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const n = parse(text);
          onPreview?.(n !== null && n >= min && n <= max ? n : null);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          commit();
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          if (press.current?.pointerId === event.pointerId) cancel();
        }}
        onLostPointerCapture={(event) => {
          onLostPointerCapture?.(event);
          if (press.current?.pointerId === event.pointerId) cancel();
        }}
        onMouseDown={(event: MouseEvent<HTMLInputElement>) => {
          onMouseDown?.(event);
          // Some browsers still focus on the mouse event that follows a held press.
          if (press.current) event.preventDefault();
        }}
        {...rest}
      />
      {suffix && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1.5 right-2 text-xs text-ed-muted peer-disabled:opacity-40"
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
