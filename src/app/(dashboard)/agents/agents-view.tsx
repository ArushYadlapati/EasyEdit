"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { TextInput } from "@/components/ui/text-input";
import { AGENT_WORDS } from "@/lib/connector/agent-words";
import { OTHER_AGENTS, agentName, type AgentKind } from "@/lib/connector/agents";
import { SKILL_WORDS } from "@/lib/skills/words";
import { AgentSetup, TOKENS_ANCHOR } from "./agent-setup";
import { ConnectAgent } from "./connect-agent";
import { ConnectedAgents } from "./connected-agents";
import { CopyButton } from "./copy";
import { TokenForm, tokenAgentFor } from "./token-form";
import type { AgentActions, AgentConnection, AgentTokenSummary } from "./types";
import { useRefreshOnFocus } from "./use-refresh-on-focus";
import { VideoSkills } from "./video-skills";

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

// What an agent can and can't do, from the connector's own tools.
function CanDo(): ReactNode {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 rounded-md border border-ed-line bg-ed-panel p-4">
      <h2 id={headingId} className="text-sm font-semibold text-ed-text">
        {AGENT_WORDS.canDoTitle}
      </h2>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-5 text-ed-text marker:text-ed-muted">
        {AGENT_WORDS.canDo.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

// Opens when the address names Access tokens (a link from the welcome, or a token hint), so what it points at is shown.
function useOpenForAnchor(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      if (window.location.hash === `#${TOKENS_ANCHOR}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  return [open, setOpen];
}

// The AI agents page below its heading: Claude and ChatGPT as the two ways in, with their steps and requests to try;
// what an agent can do here; what is connected now (read again whenever the person comes back to the tab, and an agent
// that is new since the page opened is said out loud); then, folded away, every other agent, the server address, the
// video skills and access tokens. A token counts as connected once something has used it.
export function AgentsView({ serverUrl, connections, tokens, nameLimit, now, actions }: AgentsViewProps): ReactNode {
  useRefreshOnFocus();
  const [picked, setPicked] = useState<AgentKind>(OTHER_AGENTS[0]);
  const [othersOpen, setOthersOpen] = useOpenForAnchor();
  // The connections there were when the page opened; any other one was made since, in the agent's own app.
  const [known] = useState(() => new Set(connections.map((c) => c.clientId)));
  const fresh = connections.filter((c) => !known.has(c.clientId));
  const used = tokens.filter((t) => t.lastUsedAt !== null);
  const unused = tokens.filter((t) => t.lastUsedAt === null);
  const connectedKinds = [...connections.map((c) => c.agent), ...used.map((t) => t.agent)];

  return (
    <>
      <Section title={AGENT_WORDS.choose}>
        <p role="status" className={cx("text-[13px] leading-5 text-ed-text", fresh.length === 0 && "sr-only")}>
          {fresh.length > 0 ? AGENT_WORDS.justConnected(agentName(fresh[0].agent)) : ""}
        </p>
        <ConnectAgent url={serverUrl} connected={connectedKinds} />
      </Section>
      <CanDo />
      <Section title={AGENT_WORDS.connectedTitle}>
        <ConnectedAgents connections={connections} tokens={used} now={now} actions={actions} label={AGENT_WORDS.connectedTitle} empty={AGENT_WORDS.noneConnected} />
      </Section>
      <details
        open={othersOpen}
        onToggle={(event) => setOthersOpen(event.currentTarget.open)}
        className="group min-w-0 border-t border-ed-line pt-4"
      >
        <summary
          className={cx(
            "-mx-2 flex h-7 w-fit cursor-pointer list-none items-center gap-1 rounded-md px-2 text-sm font-semibold text-ed-text select-none hover:bg-ed-hover [&::-webkit-details-marker]:hidden",
            FOCUS_RING,
            FADE,
          )}
        >
          <ChevronRight aria-hidden size={16} className="text-ed-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          {AGENT_WORDS.others}
        </summary>
        <div className="mt-3 flex min-w-0 flex-col gap-8">
          <p className="text-[13px] leading-5 text-ed-muted">{AGENT_WORDS.othersIntro}</p>
          <Section title={AGENT_WORDS.serverAddress}>
            <div className="flex min-w-0 items-center gap-2">
              <TextInput
                readOnly
                aria-label={AGENT_WORDS.serverAddress}
                value={serverUrl}
                spellCheck={false}
                className="flex-1 font-mono"
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton text={serverUrl} label="Copy server address" />
            </div>
          </Section>
          <Section title={AGENT_WORDS.setUpOther}>
            <AgentSetup url={serverUrl} picked={picked} onPick={setPicked} kinds={OTHER_AGENTS} />
          </Section>
          <Section title={SKILL_WORDS.title} description={SKILL_WORDS.intro}>
            <VideoSkills />
          </Section>
          <Section id={TOKENS_ANCHOR} title={AGENT_WORDS.tokensTitle} description={AGENT_WORDS.tokensIntro}>
            <TokenForm url={serverUrl} defaultAgent={tokenAgentFor(picked)} nameLimit={nameLimit} action={actions.createToken} />
            <ConnectedAgents connections={[]} tokens={unused} now={now} actions={actions} label={AGENT_WORDS.unusedTokens} empty={null} />
          </Section>
        </div>
      </details>
    </>
  );
}
