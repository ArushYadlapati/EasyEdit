"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Puts an invite link on the clipboard and says so ("Copied", or "Couldn't copy") for a moment.
export function CopyLinkButton({ link, size }: { link: string; size?: "sm" }): ReactNode {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      next = "failed"; // no clipboard here, or it refused
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <Button size={size} onClick={copy}>
      {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy link"}
    </Button>
  );
}
