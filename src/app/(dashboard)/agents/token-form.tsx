"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { AGENT_KINDS, AGENTS, fillTemplate, type AgentKind } from "@/lib/connector/agents";
import { CodeBlock, CopyButton } from "./copy";
import { DEFAULT_TOKEN_LIFETIME, TOKEN_LIFETIMES, type TokenLifetime } from "./token-lifetimes";
import type { AgentActions } from "./types";
import { useCall } from "./use-call";

// The agents that can take a token, in the setup list's order.
export const TOKEN_AGENTS: readonly AgentKind[] = AGENT_KINDS.filter((kind) => AGENTS[kind].methods.includes("token"));

// The form's agent for the one picked in Set up an agent: that one when it takes a token, else the OpenAI API.
export function tokenAgentFor(picked: AgentKind): AgentKind {
  return TOKEN_AGENTS.includes(picked) ? picked : "openai-api";
}

// The token just made, shown once with its agent's snippet. Leaving the page, or Done, drops it for good.
function MadeToken({ token, agent, url, onDone }: { token: string; agent: AgentKind; url: string; onDone(): void }): ReactNode {
  const info = AGENTS[agent];
  // The agent's setup with the token in it, when the registry has one; otherwise its usual snippet plus the header.
  const snippet = info.tokenSnippet ?? info.snippet;
  const snippetTakesToken = snippet?.code.includes("{token}") ?? false;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-md border border-ed-line-strong bg-ed-raised p-3">
      <p role="status" className="text-xs font-medium text-ed-warn">
        Copy it now — you won&apos;t see it again.
      </p>
      <div className="flex min-w-0 items-end gap-2">
        <Field label={`Access token for ${info.name}`} className="flex-1">
          <TextInput
            readOnly
            value={token}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            onFocus={(event) => event.currentTarget.select()}
          />
        </Field>
        <CopyButton text={token} label="Copy token" />
      </div>
      {snippet && (
        <CodeBlock label={snippet.label} code={fillTemplate(snippet.code, { url, token })} copyLabel="Copy snippet with token" />
      )}
      {!snippetTakesToken && (
        <>
          <p className="text-xs text-ed-muted">{info.name} sends the token as this header to the easyedit server:</p>
          <CodeBlock label="Header" code={`Authorization: Bearer ${token}`} copyLabel="Copy header" />
        </>
      )}
      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

// Makes an access token for an agent that sends a header instead of signing in. The agent follows the one picked
// in Set up an agent until changed here.
export function TokenForm({ url, defaultAgent, nameLimit, action }: {
  url: string;
  defaultAgent: AgentKind;
  nameLimit: number;
  action: AgentActions["createToken"];
}): ReactNode {
  const formId = useId();
  const [name, setName] = useState("");
  const [agent, setAgent] = useState<AgentKind>(defaultAgent);
  const [following, setFollowing] = useState(defaultAgent);
  if (defaultAgent !== following) {
    setFollowing(defaultAgent);
    setAgent(defaultAgent);
  }
  const [lifetime, setLifetime] = useState<TokenLifetime>(DEFAULT_TOKEN_LIFETIME);
  const [made, setMade] = useState<{ token: string; agent: AgentKind } | null>(null);
  const create = useCall(action);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.pending) return;
    const forAgent = agent;
    create.run([{ name, agent: forAgent, expiresInDays: lifetime }], {
      onSuccess: (result) => {
        if (result.token === undefined) return;
        setMade({ token: result.token, agent: forAgent });
        setName("");
      },
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-md border border-ed-line bg-ed-panel p-3">
      <form id={formId} aria-label="Make an access token" className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={send}>
        <Field label="Name" className="min-w-40 flex-1">
          <TextInput
            maxLength={nameLimit}
            placeholder="Cursor on my laptop"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Agent" className="w-48">
          <Select value={agent} onChange={(event) => setAgent(event.target.value as AgentKind)}>
            {TOKEN_AGENTS.map((kind) => (
              <option key={kind} value={kind}>
                {AGENTS[kind].name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lasts" className="w-36">
          <Select
            value={lifetime === null ? "never" : String(lifetime)}
            onChange={(event) => setLifetime(event.target.value === "never" ? null : (Number(event.target.value) as TokenLifetime))}
          >
            {TOKEN_LIFETIMES.map((choice) => (
              <option key={choice.label} value={choice.days === null ? "never" : String(choice.days)}>
                {choice.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" type="submit" disabled={create.pending}>
          Make token
        </Button>
      </form>
      {create.error && (
        <p role="alert" className="text-xs text-ed-danger">
          {create.error}
        </p>
      )}
      {made && <MadeToken token={made.token} agent={made.agent} url={url} onDone={() => setMade(null)} />}
    </div>
  );
}
