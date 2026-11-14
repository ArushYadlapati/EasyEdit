"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const SHOWN_MS = 2000;

// Copies text to the clipboard, saying "Copied" on the button (and to screen readers) for a moment. Where the
// browser refuses (an insecure page, a denied permission), it says so and the text can still be selected by hand.
export function CopyButton({ text, label, size = "md" }: { text: string; label: string; size?: "sm" | "md" }): ReactNode {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let next: "copied" | "failed";
    try {
      await navigator.clipboard.writeText(text);
      next = "copied";
    } catch {
      next = "failed";
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), SHOWN_MS);
  }

  return (
    <>
      <Button size={size} aria-label={label} onClick={() => void copy()}>
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
      </Button>
      <span role="status" className="sr-only">
        {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy. Select the text and copy it yourself." : ""}
      </span>
    </>
  );
}

// A config file or command, with what it is above it and a Copy button.
export function CodeBlock({ label, code, copyLabel }: { label: string; code: string; copyLabel: string }): ReactNode {
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-md border border-ed-line bg-ed-raised">
      <figcaption className="flex min-w-0 items-center gap-2 border-b border-ed-line py-1 pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-4 text-ed-muted">{label}</span>
        <CopyButton size="sm" text={code} label={copyLabel} />
      </figcaption>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-5 text-ed-text">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
