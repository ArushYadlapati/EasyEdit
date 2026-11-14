"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { FADE, FOCUS_RING, cx } from "@/components/ui/cx";
import { AGENT_KINDS, AGENTS, PRIMARY_AGENT, fillTemplate, type AgentKind } from "@/lib/connector/agents";
import { CodeBlock } from "./copy";

export const TOKENS_ANCHOR = "access-tokens";

const KEY_MOVES: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

const LINK = cx("rounded-sm text-ed-accent underline-offset-2 hover:underline", FOCUS_RING);

function TokenHint({ kind }: { kind: AgentKind }): ReactNode {
  const { methods } = AGENTS[kind];
  if (!methods.includes("token")) return null;
  if (!methods.includes("oauth")) {
    return (
      <p className="text-xs text-ed-muted">
        This agent needs an access token. <a href={`#${TOKENS_ANCHOR}`} className={LINK}>Make one under Access tokens</a>,
        then put it in place of &lt;your access token&gt;.
      </p>
    );
  }
  return (
    <p className="text-xs text-ed-muted">
      Or use an access token instead of signing in: <a href={`#${TOKENS_ANCHOR}`} className={LINK}>make one under Access tokens</a>.
    </p>
  );
}

// Every agent EasyEdit knows, Claude first and marked Recommended, as tabs: a column beside the steps on a wide
// window, rows above them on a narrow one. The picked agent's steps show with the server address filled in, and its
// config snippet when it has one. The arrow keys, Home and End move between agents.
export function AgentSetup({ url, picked, onPick }: { url: string; picked: AgentKind; onPick(kind: AgentKind): void }): ReactNode {
  const prefix = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const info = AGENTS[picked];
  const tabId = (kind: AgentKind) => `${prefix}-tab-${kind}`;
  const panelId = `${prefix}-panel`;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = KEY_MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    const next = move(index, AGENT_KINDS.length);
    buttons.current[next]?.focus();
    onPick(AGENT_KINDS[next]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-md border border-ed-line bg-ed-panel p-3 md:flex-row">
      <div
        role="tablist"
        aria-label="Agent"
        className="flex min-w-0 flex-wrap gap-1 md:w-52 md:shrink-0 md:flex-col md:flex-nowrap md:border-r md:border-ed-line md:pr-3"
      >
        {AGENT_KINDS.map((kind, index) => (
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
              "flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs font-medium whitespace-nowrap text-ed-muted select-none md:justify-between",
              "hover:bg-ed-hover hover:text-ed-text",
              "aria-selected:bg-ed-accent-weak aria-selected:text-ed-accent aria-selected:hover:bg-ed-accent-weak aria-selected:hover:text-ed-accent",
              FOCUS_RING,
              FADE,
            )}
            onClick={() => onPick(kind)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="truncate">{AGENTS[kind].name}</span>
            {kind === PRIMARY_AGENT && (
              <>
                {" "}
                <span className="shrink-0 rounded-[4px] border border-ed-accent/40 px-1.5 text-[11px] leading-4 font-medium text-ed-accent">
                  Recommended
                </span>
              </>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(picked)} className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ed-text">{info.name}</h3>
          <p className="text-xs text-ed-muted">{info.vendor}</p>
        </div>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-5 text-ed-text marker:text-ed-muted">
          {info.steps.map((step) => (
            <li key={step} className="[overflow-wrap:anywhere]">
              {fillTemplate(step, { url })}
            </li>
          ))}
        </ol>
        {info.snippet && (
          <CodeBlock label={info.snippet.label} code={fillTemplate(info.snippet.code, { url })} copyLabel="Copy setup snippet" />
        )}
        <TokenHint kind={picked} />
      </div>
    </div>
  );
}
