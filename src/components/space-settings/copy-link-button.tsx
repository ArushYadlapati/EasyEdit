"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Puts an invite link on the clipboard and says so ("Copied") for a moment.
export function CopyLinkButton({ link, size }: { link: string; size?: "sm" }): ReactNode {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      return; // no clipboard here: the link is shown to select by hand
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button size={size} onClick={copy}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
