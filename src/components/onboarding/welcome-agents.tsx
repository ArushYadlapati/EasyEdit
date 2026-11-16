"use client";

import { useState, type ReactNode } from "react";
import { AgentSetup } from "@/app/(dashboard)/agents/agent-setup";
import { PRIMARY_AGENT, type AgentKind } from "@/lib/connector/agents";

// The agent picker and its steps, as /agents shows them, with the pick kept here.
export function WelcomeAgents({ url }: { url: string }): ReactNode {
  const [picked, setPicked] = useState<AgentKind>(PRIMARY_AGENT);
  return <AgentSetup url={url} picked={picked} onPick={setPicked} />;
}
