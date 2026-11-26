"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ConnectAgent } from "@/app/(dashboard)/agents/connect-agent";
import { useRefreshOnFocus } from "@/app/(dashboard)/agents/use-refresh-on-focus";
import { FOCUS_RING, cx } from "@/components/ui/cx";
import { AGENT_WORDS } from "@/lib/connector/agent-words";
import type { AgentKind } from "@/lib/connector/agents";

// Claude and ChatGPT with their steps, as /agents shows them, and the way to every other agent. The page is read again
// when the person comes back from the agent's app, so an agent they just connected is marked Connected.
export function WelcomeAgents({ url, connected = [] }: { url: string; connected?: readonly AgentKind[] }): ReactNode {
  useRefreshOnFocus();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ConnectAgent url={url} connected={connected} />
      <p className="text-[13px] leading-5 text-ed-muted">
        Using something else?{" "}
        <Link href="/agents" className={cx("rounded-sm text-ed-accent underline-offset-2 hover:underline", FOCUS_RING)}>
          {AGENT_WORDS.others}
        </Link>{" "}
        are on the AI agents page.
      </p>
    </div>
  );
}
