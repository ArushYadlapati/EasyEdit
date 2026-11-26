"use client";

import type { ReactNode } from "react";
import { AGENT_WORDS } from "@/lib/connector/agent-words";
import { CopyButton } from "./copy";

// The address shown whole (it wraps rather than being cut off on a phone), with a click selecting all of it, and its
// own Copy button beside it, inside the step that says where to paste it.
export function AddressToCopy({ url }: { url: string }): ReactNode {
  return (
    <span role="group" aria-label={AGENT_WORDS.addressLabel} className="mt-1.5 flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 rounded-md border border-ed-line bg-ed-raised px-3 py-[3px] font-mono text-xs leading-5 text-ed-text select-all [overflow-wrap:anywhere]">
        {url}
      </code>
      <CopyButton text={url} label={AGENT_WORDS.copyAddress} />
    </span>
  );
}

// A setup step, with "{url}" drawn as the address to copy. A step names the address once at most.
export function StepText({ step, url }: { step: string; url: string }): ReactNode {
  const at = step.indexOf("{url}");
  if (at === -1) return step;
  const before = step.slice(0, at).trimEnd();
  const after = step.slice(at + "{url}".length).trim();
  return (
    <>
      {before}
      <AddressToCopy url={url} />
      {after && <span className="mt-1.5 block">{after}</span>}
    </>
  );
}
