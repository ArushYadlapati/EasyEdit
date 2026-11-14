"use client";

import { useId, useState, type ReactNode } from "react";
import { TextInput } from "@/components/ui/text-input";
import { PRIMARY_AGENT, type AgentKind } from "@/lib/connector/agents";
import { AgentSetup, TOKENS_ANCHOR } from "./agent-setup";
import { ConnectedAgents } from "./connected-agents";
import { CopyButton } from "./copy";
import { TokenForm, tokenAgentFor } from "./token-form";
import type { AgentActions, AgentConnection, AgentTokenSummary } from "./types";

export type AgentsViewProps = {
  serverUrl: string;
  connections: readonly AgentConnection[];
  tokens: readonly AgentTokenSummary[];
  nameLimit: number; // the longest token name
  now: Date;
  actions: AgentActions;
};

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="flex min-w-0 scroll-mt-4 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-sm font-semibold text-ed-text">
          {title}
        </h2>
        {description && <p className="text-[13px] leading-5 text-ed-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// The AI agents page below its heading: the server address, the setup steps for each agent (Claude picked first),
// what is connected now, and access tokens. The agent picked for setup is also the token form's agent when it takes one.
export function AgentsView({ serverUrl, connections, tokens, nameLimit, now, actions }: AgentsViewProps): ReactNode {
  const [picked, setPicked] = useState<AgentKind>(PRIMARY_AGENT);

  return (
    <>
      <Section title="Server address" description="Every agent connects to this address.">
        <div className="flex min-w-0 items-center gap-2">
          <TextInput
            readOnly
            aria-label="Server address"
            value={serverUrl}
            spellCheck={false}
            className="flex-1 font-mono"
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyButton text={serverUrl} label="Copy server address" />
        </div>
      </Section>
      <Section title="Set up an agent">
        <AgentSetup url={serverUrl} picked={picked} onPick={setPicked} />
      </Section>
      <Section title="Connected agents">
        <ConnectedAgents connections={connections} tokens={tokens} now={now} actions={actions} />
      </Section>
      <Section
        id={TOKENS_ANCHOR}
        title="Access tokens"
        description="For agents that send a header instead of signing in. A token acts as you until you revoke it, so keep it secret, like a password."
      >
        <TokenForm url={serverUrl} defaultAgent={tokenAgentFor(picked)} nameLimit={nameLimit} action={actions.createToken} />
      </Section>
    </>
  );
}
