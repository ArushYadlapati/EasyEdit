"use client";

import { ExternalLink } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { linkButtonClass } from "@/components/ui/button-class";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { AGENT_WORDS } from "@/lib/connector/agent-words";
import { AGENTS, CONSUMER_AGENTS, type AgentKind, type ConsumerAgent } from "@/lib/connector/agents";
import { CopyButton } from "./copy";
import { StepText } from "./step-text";

const STEP = "[overflow-wrap:anywhere]";

// The requests to try once connected, each with its own Copy.
function Asks(): ReactNode {
  return (
    <ul aria-label={AGENT_WORDS.thenAsk} className="mt-1.5 flex flex-col gap-1.5">
      {AGENT_WORDS.asks.map((ask, index) => (
        <li key={ask} className="flex min-w-0 items-start gap-2">
          <q className="min-w-0 flex-1 rounded-md border border-ed-line bg-ed-raised px-3 py-[3px] text-[13px] leading-5 text-ed-text [overflow-wrap:anywhere] before:content-none after:content-none">
            {ask}
          </q>
          <CopyButton text={ask} label={AGENT_WORDS.copyAsk(index + 1)} />
        </li>
      ))}
    </ul>
  );
}

// Claude and ChatGPT as two large choices (tabs: the arrow keys move between them), Claude picked first, each marked
// Connected when the person already is. Below, the picked agent's steps: a link to its own connector settings in the
// first, the address with its own Copy where it is pasted, signing in with the person's Google account, then requests
// to try.
export function ConnectAgent({ url, connected = [] }: { url: string; connected?: readonly AgentKind[] }): ReactNode {
  const [picked, setPicked] = useState<ConsumerAgent>(CONSUMER_AGENTS[0]);
  const prefix = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const info = AGENTS[picked];
  const tabId = (kind: AgentKind) => `${prefix}-tab-${kind}`;
  const panelId = `${prefix}-panel`;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const n = CONSUMER_AGENTS.length;
    const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1 + n, ArrowUp: index - 1 + n, Home: 0, End: n - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const at = next % n;
    buttons.current[at]?.focus();
    setPicked(CONSUMER_AGENTS[at]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="tablist" aria-label={AGENT_WORDS.chooseLabel} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CONSUMER_AGENTS.map((kind, index) => {
          const isConnected = connected.includes(kind);
          return (
            <button
              key={kind}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              id={tabId(kind)}
              type="button"
              role="tab"
              aria-selected={kind === picked}
              aria-controls={panelId}
              tabIndex={kind === picked ? 0 : -1}
              className={cx(
                "flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-md border border-ed-line bg-ed-panel px-4 py-3 text-left select-none",
                "hover:border-ed-line-strong hover:bg-ed-hover",
                "aria-selected:border-ed-accent aria-selected:bg-ed-accent-weak aria-selected:hover:bg-ed-accent-weak",
                FOCUS_RING,
                FADE,
              )}
              onClick={() => setPicked(kind)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ed-text">
                {AGENTS[kind].name}
                {isConnected && (
                  <span className="shrink-0 rounded-[4px] border border-ed-line-strong px-1.5 text-[11px] leading-4 font-medium text-ed-text">
                    {AGENT_WORDS.connected}
                  </span>
                )}
              </span>
              <span className="text-xs text-ed-muted">{AGENTS[kind].vendor}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(picked)} className="flex min-w-0 flex-col gap-3 rounded-md border border-ed-line bg-ed-panel p-4">
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-[13px] leading-5 text-ed-text marker:text-ed-muted">
          {info.steps.map((step, index) => (
            <li key={step} className={STEP}>
              <StepText step={step} url={url} />
              {index === 0 && info.settings && (
                <a
                  href={info.settings.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkButtonClass("default", "mt-1.5 flex w-fit")}
                >
                  {info.settings.label}
                  <ExternalLink aria-hidden />
                  <span className="sr-only">{AGENT_WORDS.opensNewTab}</span>
                </a>
              )}
            </li>
          ))}
          <li className={STEP}>
            {AGENT_WORDS.thenAsk}
            <Asks />
          </li>
        </ol>
      </div>
    </div>
  );
}
